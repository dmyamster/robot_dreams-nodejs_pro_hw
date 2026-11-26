import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InstrumentsService } from '../instruments/instruments.service';
import { OrderEventsService } from './order-events.service';
import { AccessTokenPayload } from '../auth/jwt.service';
import { OrdersRepository } from './orders.repository';
import { createLayerLogger } from '../observability/logger';

export interface Order {
  id: string;
  account_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: number;
  limit_price_cents: number | null;
  execution_price_cents: number | null;
  fee_cents: number | null;
  total_cents: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  created_at: string;
}

export interface CreateOrderDto {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: number;
  limit_price_cents?: number;
}

@Injectable()
export class OrdersService {
  private readonly logger = createLayerLogger('orders.service');

  constructor(
    private readonly instrumentsService: InstrumentsService,
    private readonly orderEventsService: OrderEventsService,
    private readonly ordersRepository: OrdersRepository,
  ) {}

  updateStatus(id: string, status: string): Order {
    this.logger.info({ orderId: id, status }, 'service updateStatus');
    const order = this.ordersRepository.upsertStatus(id, status);
    this.orderEventsService.emitOrderStatus(id, status, { order });
    return order;
  }

  async create(
    idempotencyKey: string,
    dto: CreateOrderDto,
    ownerUserId?: string,
  ): Promise<{ order: Order; isReplay: boolean }> {
    this.logger.info({ symbol: dto.symbol }, 'service create order');
    const cached = this.ordersRepository.findIdempotency(idempotencyKey);
    if (cached) {
      if (JSON.stringify(cached.body) === JSON.stringify(dto)) {
        return { order: cached.response, isReplay: true };
      }
      throw new UnprocessableEntityException(
        'Idempotency key was already used with a different request payload',
      );
    }

    let instrumentPrice = 10000;
    try {
      const instrument = this.instrumentsService.findBySymbol(dto.symbol);
      instrumentPrice = instrument.current_price_cents;
    } catch {
      instrumentPrice = dto.limit_price_cents ?? 10000;
    }

    const feeCents = 150;
    const totalCents = instrumentPrice * dto.quantity + feeCents;
    const orderId = randomUUID();

    const newOrder: Order = {
      id: orderId,
      account_id: ownerUserId ?? 'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      symbol: dto.symbol,
      side: dto.side,
      type: dto.type,
      quantity: dto.quantity,
      limit_price_cents: dto.limit_price_cents ?? null,
      execution_price_cents: instrumentPrice,
      fee_cents: feeCents,
      total_cents: totalCents,
      status: 'FILLED',
      created_at: new Date().toISOString(),
    };

    await this.ordersRepository.save(newOrder, idempotencyKey, dto, ownerUserId);
    return { order: newOrder, isReplay: false };
  }

  findAll(limit: number = 20, cursor?: string, user?: AccessTokenPayload) {
    this.logger.info({ limit }, 'service findAll');
    let startIndex = 0;
    if (cursor) {
      const decoded = parseInt(Buffer.from(cursor, 'base64').toString('utf-8'), 10);
      if (!Number.isNaN(decoded)) {
        startIndex = decoded;
      }
    }

    const allOrders = this.ordersRepository.findAll();
    const visibleOrders =
      user && user.role !== 'ADMIN'
        ? allOrders.filter(
            (o) =>
              (this.ordersRepository.getOwner(o.id) ?? o.account_id) === user.sub,
          )
        : allOrders;

    const items = visibleOrders.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + limit;
    const next_cursor =
      nextIndex < visibleOrders.length
        ? Buffer.from(String(nextIndex)).toString('base64')
        : null;

    return { items, next_cursor };
  }

  async findById(
    id: string,
    user?: AccessTokenPayload,
    delayMs?: number,
  ): Promise<Order> {
    this.logger.info({ orderId: id }, 'service findById');
    const order = await this.ordersRepository.findById(id, delayMs);
    if (!order) {
      throw new NotFoundException(`Order with id '${id}' not found`);
    }
    // Ownership check lives in the service after loading the resource, not in the auth guard
    const ownerId = this.ordersRepository.getOwner(order.id) ?? order.account_id;
    if (user && user.role !== 'ADMIN' && ownerId !== user.sub) {
      throw new ForbiddenException('You do not have permission to access this order');
    }
    return order;
  }
}
