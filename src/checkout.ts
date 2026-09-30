import { DataSource } from 'typeorm';
import { Product, Order, OrderTask } from './entities';

export interface CheckoutInput {
  accountId: string;
  productId: string;
  quantity: number;
  idempotencyKey?: string;
  usePessimisticLock?: boolean;
}

export interface CheckoutResult {
  order: Order;
  task: OrderTask;
  remainingStock: number;
  remainingBalance: string;
}

/**
 * Transactional checkout:
 * - Checks & atomically decrements product stock (protecting against oversell)
 * - Checks & atomically decrements buyer account balance (protecting against overdraft)
 * - Inserts the filled Order record
 * - Inserts the post-processing task for async worker handling (e.g. receipt/confirmation)
 *
 * All operations execute within a single database transaction.
 * If any check fails, the transaction is rolled back completely: no orphan orders or inconsistent stock.
 */
export async function checkout(
  dataSource: DataSource,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const { accountId, productId, quantity, idempotencyKey, usePessimisticLock = false } = input;

  if (!quantity || quantity <= 0) {
    throw new Error(`Invalid checkout quantity: ${quantity}. Must be greater than 0.`);
  }

  return await dataSource.transaction(async (manager) => {
    let remainingStock: number;

    if (usePessimisticLock) {
      // Alternative approach: SELECT ... FOR UPDATE (pessimistic_write lock)
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
      // Primary recommended approach: Atomic UPDATE ... WHERE stock >= $n RETURNING stock
      // Row is locked exclusively by PostgreSQL only for the duration of the UPDATE statement.
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

    // Atomic debit buyer balance with overdraft protection:
    // UPDATE accounts SET cash_balance = cash_balance - $1 WHERE id = $2 AND cash_balance >= $1 RETURNING cash_balance
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

    // INSERT post-processing task in the same transaction
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

    return {
      order: savedOrder,
      task: savedTask,
      remainingStock,
      remainingBalance,
    };
  });
}
