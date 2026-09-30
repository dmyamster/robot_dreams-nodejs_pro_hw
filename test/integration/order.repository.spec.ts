import { DataSource } from 'typeorm';
import {
  startPostgresContainer,
  stopPostgresContainer,
  truncateAllTables,
} from './testkit/postgres-container';
import { OrderRepository } from '../../src/database/repositories/order.repository';
import { User, Account, Product } from '../../src/entities';
import { aUser, anAccount, aProduct, anOrder } from './testkit/builders';

describe('OrderRepository (Integration with PostgreSQL Testcontainer)', () => {
  let dataSource: DataSource;
  let orderRepo: OrderRepository;
  let testUser: User;
  let testAccount: Account;
  let testProduct: Product;

  beforeAll(async () => {
    const setup = await startPostgresContainer();
    dataSource = setup.dataSource;
    orderRepo = new OrderRepository(dataSource);
  });

  afterAll(async () => {
    await stopPostgresContainer();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);

    // Seed baseline relational parents for orders
    const userRepo = dataSource.getRepository(User);
    const accountRepo = dataSource.getRepository(Account);
    const productRepo = dataSource.getRepository(Product);

    testUser = await userRepo.save(userRepo.create(aUser()));
    testAccount = await accountRepo.save(accountRepo.create(anAccount(testUser.id)));
    testProduct = await productRepo.save(
      productRepo.create(aProduct({ symbol: 'AAPL', currentPrice: '20000', sector: 'Technology' })),
    );
  });

  it('1. should create and load an order with joined account and product relations', async () => {
    const orderData = anOrder(testAccount.id, testProduct.id, {
      quantity: 5,
      totalAmount: '100150',
      status: 'FILLED',
    });
    const created = await orderRepo.create(orderData);

    expect(created.id).toBeDefined();

    const loaded = await orderRepo.findById(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.account).toBeDefined();
    expect(loaded?.account.id).toBe(testAccount.id);
    expect(loaded?.product).toBeDefined();
    expect(loaded?.product.symbol).toBe('AAPL');
  });

  it('2. should enforce foreign key constraint when account_id or product_id is invalid (violates foreign key 23503)', async () => {
    // Attempting to insert an order referencing a non-existent account ID
    const orphanOrder = anOrder(
      '00000000-0000-0000-0000-000000000000', // Non-existent foreign key
      testProduct.id,
    );

    let error: any;
    try {
      await orderRepo.create(orphanOrder);
    } catch (err: any) {
      error = err;
    }

    expect(error).toBeDefined();
    // PostgreSQL error code 23503: foreign_key_violation
    expect(error.code).toBe('23503');
    expect(error.message).toMatch(/foreign key|constraint/i);
  });

  it('3. should enforce unique constraint on idempotency_key (violates unique / duplicate key 23505)', async () => {
    const fixedKey = '11111111-2222-3333-4444-555555555555';

    const order1 = anOrder(testAccount.id, testProduct.id, { idempotencyKey: fixedKey });
    await orderRepo.create(order1);

    // Second order with identical idempotencyKey
    const order2 = anOrder(testAccount.id, testProduct.id, { idempotencyKey: fixedKey });

    let error: any;
    try {
      await orderRepo.create(order2);
    } catch (err: any) {
      error = err;
    }

    expect(error).toBeDefined();
    // PostgreSQL error code 23505: unique_violation (duplicate key value violates unique constraint)
    expect(error.code).toBe('23505');
    expect(error.message).toMatch(/duplicate key|unique constraint/i);
  });

  it('4. should execute SQL JOIN + aggregation across orders and products (getVolumeBySector)', async () => {
    const productRepo = dataSource.getRepository(Product);
    const healthProduct = await productRepo.save(
      productRepo.create(aProduct({ symbol: 'JNJ', sector: 'Healthcare', currentPrice: '16000' })),
    );

    // Create 2 filled orders for Tech ($100.00 and $200.00)
    await orderRepo.create(
      anOrder(testAccount.id, testProduct.id, {
        status: 'FILLED',
        quantity: 1,
        totalAmount: '10000',
      }),
    );
    await orderRepo.create(
      anOrder(testAccount.id, testProduct.id, {
        status: 'FILLED',
        quantity: 2,
        totalAmount: '20000',
      }),
    );

    // Create 1 filled order for Healthcare ($160.00)
    await orderRepo.create(
      anOrder(testAccount.id, healthProduct.id, {
        status: 'FILLED',
        quantity: 1,
        totalAmount: '16000',
      }),
    );

    // Create 1 cancelled order for Tech (must be excluded from filled volume)
    await orderRepo.create(
      anOrder(testAccount.id, testProduct.id, {
        status: 'CANCELLED',
        quantity: 1,
        totalAmount: '10000',
      }),
    );

    const report = await orderRepo.getVolumeBySector();
    const techRow = report.find((r) => r.sector === 'Technology');
    const healthRow = report.find((r) => r.sector === 'Healthcare');

    expect(techRow).toBeDefined();
    expect(techRow?.total_orders).toBe(2);
    expect(techRow?.total_volume_cents).toBe('30000');

    expect(healthRow).toBeDefined();
    expect(healthRow?.total_orders).toBe(1);
    expect(healthRow?.total_volume_cents).toBe('16000');
  });

  it('5. should find pending orders utilizing partial index (idx_orders_pending)', async () => {
    await orderRepo.create(
      anOrder(testAccount.id, testProduct.id, { status: 'PENDING', quantity: 3 }),
    );
    await orderRepo.create(
      anOrder(testAccount.id, testProduct.id, { status: 'FILLED', quantity: 5 }),
    );

    const pending = await orderRepo.findPendingOrders();
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('PENDING');
  });
});
