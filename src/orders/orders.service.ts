import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InstrumentsService } from '../instruments/instruments.service';

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

  constructor(private readonly instrumentsService: InstrumentsService) {}

  create(idempotencyKey: string, dto: CreateOrderDto): { order: Order; isReplay: boolean } {
    if (this.idempotencyStore.has(idempotencyKey)) {
      const cached = this.idempotencyStore.get(idempotencyKey)!;
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

    const newOrder: Order = {
      id: 'e4eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
      account_id: 'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22',
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

    this.orders.push(newOrder);
    this.idempotencyStore.set(idempotencyKey, { body: dto, response: newOrder });

    return { order: newOrder, isReplay: false };
  }

  findAll(limit: number = 20, cursor?: string) {
    let startIndex = 0;
    if (cursor) {
      const decoded = parseInt(Buffer.from(cursor, 'base64').toString('utf-8'), 10);
      if (!Number.isNaN(decoded)) {
        startIndex = decoded;
      }
    }

    const items = this.orders.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + limit;
    const next_cursor =
      nextIndex < this.orders.length
        ? Buffer.from(String(nextIndex)).toString('base64')
        : null;

    return { items, next_cursor };
  }

  findById(id: string): Order {
    const order = this.orders.find((o) => o.id === id);
    if (!order) {
      throw new NotFoundException(`Order with id '${id}' not found`);
    }
    return order;
  }
}
