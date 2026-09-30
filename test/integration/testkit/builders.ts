import { User, Account, Product, Order } from '../../../src/entities';
import { randomUUID } from 'node:crypto';

let counter = 1;

export function aUser(overrides: Partial<User> = {}): Partial<User> {
  const c = counter++;
  return {
    email: `trader-${Date.now()}-${c}@example.com`,
    passwordHash: '$2b$10$e8wF5qD1nN.1Y3o.vV79eOM0YgqE0GkJrJz/Jb7vG7wK.Q2W1gQe',
    role: 'INVESTOR',
    isVerified: true,
    ...overrides,
  };
}

export function anAccount(userId: string, overrides: Partial<Account> = {}): Partial<Account> {
  const c = counter++;
  return {
    userId,
    accountNumber: `ACC-${Date.now()}-${c}`,
    cashBalance: '1000000', // 10,000.00 USD
    lockedBalance: '0',
    currency: 'USD',
    ...overrides,
  };
}

export function aProduct(overrides: Partial<Product> = {}): Partial<Product> {
  const c = counter++;
  return {
    symbol: `TK${(c % 900) + 100}`,
    name: `Test Instrument ${c}`,
    description: `Description for instrument ${c}`,
    sector: 'Technology',
    currentPrice: '15000', // $150.00
    tradingStatus: 'ACTIVE',
    stock: 50,
    logoUrl: null,
    ...overrides,
  };
}

export function anOrder(
  accountId: string,
  productId: string,
  overrides: Partial<Order> = {},
): Partial<Order> {
  const c = counter++;
  return {
    accountId,
    productId,
    side: 'BUY',
    type: 'MARKET',
    status: 'FILLED',
    quantity: 10,
    limitPrice: null,
    executionPrice: '15000',
    fee: '150',
    totalAmount: '150150',
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}
