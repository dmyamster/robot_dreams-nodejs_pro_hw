import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as amqp from 'amqplib';
import { Product, Order, OrderTask, Outbox } from './entities';
import { OrderPlacedEvent, OrderEventPublisher, createConnection } from './rabbitmq';

export interface CheckoutInput {
  accountId: string;
  productId: string;
  quantity: number;
  idempotencyKey?: string;
  usePessimisticLock?: boolean;
  publishEvent?: boolean;
  amqpConnection?: amqp.ChannelModel;
  simulateCrashAfterOutbox?: boolean;
}

export interface CheckoutResult {
  order: Order;
  task: OrderTask;
  remainingStock: number;
  remainingBalance: string;
  event?: OrderPlacedEvent;
  outbox?: Outbox;
  isReplay?: boolean;
}

/**
 * Explicitly designed event contract: converts business entity into external message contract.
 * Prevents internal DB schema leaks and decouples consumers from internal column definitions.
 */
export function toOrderPlacedEvent(order: Order, product: Product): OrderPlacedEvent {
  return {
    eventId: order.id || crypto.randomUUID(),
    type: 'order.placed',
    occurredAt: (order.createdAt || new Date()).toISOString(),
    data: {
      orderId: order.id,
      accountId: order.accountId,
      productId: order.productId,
      symbol: product.symbol,
      quantity: order.quantity,
      price: order.executionPrice || product.currentPrice,
      totalAmount: order.totalAmount,
    },
  };
}

/**
 * Transactional checkout with Transactional Outbox:
 * - Checks & atomically decrements product stock (protecting against oversell)
 * - Checks & atomically decrements buyer account balance (protecting against overdraft)
 * - Checks idempotency key: returns existing order on identical key, rejects mismatched payloads
 * - Inserts the filled Order record
 * - Inserts the post-processing task
 * - Inserts the Outbox record with explicit event payload
 *
 * All operations execute within a single database transaction (single COMMIT).
 * NO broker publish takes place inside the transaction.
 * If any error or crash occurs, the entire state rolls back cleanly.
 */
export async function checkout(
  dataSource: DataSource,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const { accountId, productId, quantity, idempotencyKey, usePessimisticLock = false } = input;

  if (!quantity || quantity <= 0) {
    throw new Error(`Invalid checkout quantity: ${quantity}. Must be greater than 0.`);
  }

  const result = await dataSource.transaction(async (manager) => {
    // Level 3 Idempotency at API edge: check if idempotencyKey has already been used
    if (idempotencyKey) {
      const existingOrder = await manager.findOne(Order, {
        where: { idempotencyKey },
        relations: { product: true },
      });

      if (existingOrder) {
        if (
          existingOrder.accountId !== accountId ||
          existingOrder.productId !== productId ||
          existingOrder.quantity !== quantity
        ) {
          throw new Error(
            'Idempotency key was already used with a different request payload',
          );
        }

        return {
          order: existingOrder,
          task: null as any,
          remainingStock: Number(existingOrder.product?.stock ?? 0),
          remainingBalance: '0',
          event: undefined,
          isReplay: true,
        };
      }
    }

    let remainingStock: number;

    if (usePessimisticLock) {
      const product = await manager
        .createQueryBuilder(Product, 'product')
        .setLock('pessimistic_write')
        .where('product.id = :id', { id: productId })
        .getOne();

      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }
      if (product.tradingStatus !== 'ACTIVE') {
        throw new Error(`Product trading is not active: ${product.tradingStatus}`);
      }
      if (product.stock < quantity) {
        throw new Error(
          `Insufficient stock for product ${productId}: requested ${quantity}, available ${product.stock}`,
        );
      }

      product.stock -= quantity;
      await manager.save(product);
      remainingStock = product.stock;
    } else {
      const updateStockResult = await manager.query(
        `UPDATE "products" 
         SET "stock" = "stock" - $1, "updated_at" = NOW() 
         WHERE "id" = $2 AND "stock" >= $1 
         RETURNING "id", "stock", "current_price", "trading_status"`,
        [quantity, productId],
      );

      const stockRows = Array.isArray(updateStockResult[0])
        ? updateStockResult[0]
        : updateStockResult;

      if (!stockRows || stockRows.length === 0) {
        const checkProduct = await manager.findOne(Product, { where: { id: productId } });
        if (!checkProduct) {
          throw new Error(`Product not found: ${productId}`);
        }
        throw new Error(
          `Insufficient stock for product ${productId}: requested ${quantity}, available ${checkProduct.stock}`,
        );
      }

      const stockRow = stockRows[0];
      if (stockRow.trading_status !== 'ACTIVE') {
        throw new Error(`Product trading is not active: ${stockRow.trading_status}`);
      }

      remainingStock = Number(stockRow.stock);
    }

    // Determine price and fee
    const product = await manager.findOneOrFail(Product, { where: { id: productId } });
    const price = BigInt(product.currentPrice);
    const fee = 150n; // 150 cents = $1.50
    const totalAmount = price * BigInt(quantity) + fee;

    // Atomic debit buyer balance with overdraft protection
    const updateBalanceResult = await manager.query(
      `UPDATE "accounts" 
       SET "cash_balance" = "cash_balance" - $1, "updated_at" = NOW() 
       WHERE "id" = $2 AND "cash_balance" >= $1 
       RETURNING "id", "cash_balance"`,
      [totalAmount.toString(), accountId],
    );

    const balanceRows = Array.isArray(updateBalanceResult[0])
      ? updateBalanceResult[0]
      : updateBalanceResult;

    if (!balanceRows || balanceRows.length === 0) {
      throw new Error(`Insufficient funds on account ${accountId}: required ${totalAmount}`);
    }

    const remainingBalance = balanceRows[0].cash_balance;

    // INSERT Order
    const orderRepo = manager.getRepository(Order);
    const order = orderRepo.create({
      accountId,
      productId,
      side: 'BUY',
      type: 'MARKET',
      status: 'FILLED',
      quantity,
      limitPrice: null,
      executionPrice: product.currentPrice,
      fee: fee.toString(),
      totalAmount: totalAmount.toString(),
      idempotencyKey: idempotencyKey || null,
    });
    const savedOrder = await orderRepo.save(order);

    // INSERT post-processing task
    const taskRepo = manager.getRepository(OrderTask);
    const task = taskRepo.create({
      orderId: savedOrder.id,
      type: 'SEND_RECEIPT',
      payload: {
        orderId: savedOrder.id,
        accountId,
        productId,
        quantity,
        totalAmount: totalAmount.toString(),
      },
      status: 'PENDING',
      processed: 0,
    });
    const savedTask = await taskRepo.save(task);

    // Build explicitly designed event contract
    const event = toOrderPlacedEvent(savedOrder, product);

    // INSERT row into outbox table in the SAME transaction
    const outboxRepo = manager.getRepository(Outbox);
    const outboxRecord = outboxRepo.create({
      aggregateType: 'order',
      aggregateId: savedOrder.id,
      type: 'order.placed',
      payload: event,
      attempts: 0,
    });
    const savedOutbox = await outboxRepo.save(outboxRecord);

    // Simulated crash after outbox insert (for demo:crash-write)
    if (input.simulateCrashAfterOutbox) {
      throw new Error('Simulated write failure after outbox insert (demo:crash-write)');
    }

    return {
      order: savedOrder,
      task: savedTask,
      remainingStock,
      remainingBalance,
      event,
      outbox: savedOutbox,
      isReplay: false,
    };
  });

  // Optional async publishing fallback (if requested by older tests)
  if (input.publishEvent && result.event) {
    let localConn: amqp.ChannelModel | null = null;
    try {
      const conn = input.amqpConnection || (localConn = await createConnection());
      const publisher = new OrderEventPublisher(conn);
      await publisher.publishOrderPlaced(result.event);
      await publisher.close();
    } finally {
      if (localConn) {
        const c: amqp.ChannelModel = localConn;
        await c.close();
      }
    }
  }

  return result;
}
