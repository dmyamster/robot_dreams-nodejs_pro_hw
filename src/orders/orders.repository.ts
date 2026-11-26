import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { createLayerLogger } from '../observability/logger';
import type { CreateOrderDto, Order } from './orders.service';

export const SIMULATED_500_ORDER_ID = '00000000-0000-0000-0000-000000000500';

@Injectable()
export class OrdersRepository {
  private readonly logger = createLayerLogger('orders.repo');
  private readonly tracer = trace.getTracer('orders.repo');

  private orders: Order[] = [
    {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      account_id: 'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      symbol: 'AAPL',
      side: 'BUY',
      type: 'MARKET',
      quantity: 10,
      limit_price_cents: null,
      execution_price_cents: 22050,
      fee_cents: 150,
      total_cents: 220650,
      status: 'FILLED',
      created_at: '2026-09-16T10:00:00Z',
    },
    {
      id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      account_id: 'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      symbol: 'GOOGL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 5,
      limit_price_cents: 17500,
      execution_price_cents: 17500,
      fee_cents: 150,
      total_cents: 87650,
      status: 'FILLED',
      created_at: '2026-09-16T10:05:00Z',
    },
    {
      id: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
      account_id: 'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      symbol: 'MSFT',
      side: 'SELL',
      type: 'MARKET',
      quantity: 2,
      limit_price_cents: null,
      execution_price_cents: 43000,
      fee_cents: 150,
      total_cents: 86150,
      status: 'FILLED',
      created_at: '2026-09-16T10:10:00Z',
    },
  ];

  private idempotencyStore = new Map<
    string,
    { body: CreateOrderDto; response: Order }
  >();
  private orderOwners = new Map<string, string>();

  async findById(id: string, delayMs?: number): Promise<Order | undefined> {
    return this.tracer.startActiveSpan('orders.repo.findById', async (span) => {
      try {
        span.setAttribute('order.id', id);
        if (delayMs && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          await Promise.resolve();
        }

        if (id === SIMULATED_500_ORDER_ID) {
          const err = new InternalServerErrorException(
            'Simulated repository failure',
          );
          span.recordException(err);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          });
          this.logger.error({ orderId: id }, 'repository findById failed');
          throw err;
        }

        const order = this.orders.find((o) => o.id === id);
        this.logger.info(
          { orderId: id, found: Boolean(order) },
          'repository findById completed',
        );
        return order;
      } finally {
        span.end();
      }
    });
  }

  findAll(): Order[] {
    this.logger.info({ count: this.orders.length }, 'repository findAll');
    return this.orders;
  }

  async save(
    order: Order,
    idempotencyKey: string,
    dto: CreateOrderDto,
    ownerUserId?: string,
  ): Promise<Order> {
    return this.tracer.startActiveSpan('orders.repo.save', async (span) => {
      try {
        span.setAttribute('order.id', order.id);
        await Promise.resolve();

        this.orders.push(order);
        if (ownerUserId) {
          this.orderOwners.set(order.id, ownerUserId);
        }
        this.idempotencyStore.set(idempotencyKey, { body: dto, response: order });
        this.logger.info({ orderId: order.id }, 'repository save completed');
        return order;
      } finally {
        span.end();
      }
    });
  }

  upsertStatus(id: string, status: string): Order {
    let order = this.orders.find((o) => o.id === id);
    if (!order) {
      order = {
        id,
        account_id: 'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        symbol: 'AAPL',
        side: 'BUY',
        type: 'MARKET',
        quantity: 1,
        limit_price_cents: null,
        execution_price_cents: 10000,
        fee_cents: 150,
        total_cents: 10150,
        status: status as any,
        created_at: new Date().toISOString(),
      };
      this.orders.push(order);
    } else {
      order.status = status as any;
    }
    this.logger.info({ orderId: id, status }, 'repository upsertStatus');
    return order;
  }

  findIdempotency(
    key: string,
  ): { body: CreateOrderDto; response: Order } | undefined {
    return this.idempotencyStore.get(key);
  }

  getOwner(orderId: string): string | undefined {
    return this.orderOwners.get(orderId);
  }
}
