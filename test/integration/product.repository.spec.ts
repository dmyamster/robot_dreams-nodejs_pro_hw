import { DataSource } from 'typeorm';
import {
  startPostgresContainer,
  stopPostgresContainer,
  truncateAllTables,
} from './testkit/postgres-container';
import { ProductRepository } from '../../src/database/repositories/product.repository';
import { aProduct } from './testkit/builders';

describe('ProductRepository (Integration with PostgreSQL Testcontainer)', () => {
  let dataSource: DataSource;
  let productRepo: ProductRepository;

  beforeAll(async () => {
    const setup = await startPostgresContainer();
    dataSource = setup.dataSource;
    productRepo = new ProductRepository(dataSource);
  });

  afterAll(async () => {
    await stopPostgresContainer();
  });

  beforeEach(async () => {
    // Strategy: TRUNCATE between tests guarantees isolation without container restart overhead
    await truncateAllTables(dataSource);
  });

  it('1. should create and find a product by symbol', async () => {
    const input = aProduct({ symbol: 'AAPL', name: 'Apple Inc.', currentPrice: '22050' });
    const created = await productRepo.create(input);

    expect(created.id).toBeDefined();
    expect(created.symbol).toBe('AAPL');

    const found = await productRepo.findBySymbol('AAPL');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Apple Inc.');
    expect(found?.currentPrice).toBe('22050');
  });

  it('2. should enforce unique constraint on product symbol (violates unique / duplicate key 23505)', async () => {
    const first = aProduct({ symbol: 'TSLA', name: 'Tesla Inc.' });
    await productRepo.create(first);

    // Attempting to insert a duplicate symbol must fail at PostgreSQL constraint level
    const duplicate = aProduct({ symbol: 'TSLA', name: 'Duplicate Tesla' });
    let error: any;
    try {
      await productRepo.create(duplicate);
    } catch (err: any) {
      error = err;
    }

    expect(error).toBeDefined();
    // PostgreSQL error code 23505: unique_violation (duplicate key value violates unique constraint)
    expect(error.code).toBe('23505');
    expect(error.message).toMatch(/duplicate key|unique constraint/i);
  });

  it('3. should atomically decrement product stock using SQL UPDATE ... WHERE stock >= $1 RETURNING', async () => {
    const product = await productRepo.create(aProduct({ symbol: 'MSFT', stock: 10 }));

    // Decrement 4 units
    const result = await productRepo.decrementStock(product.id, 4);
    expect(result.stock).toBe(6);

    // Verify persisted state in PostgreSQL
    const reloaded = await productRepo.findById(product.id);
    expect(reloaded?.stock).toBe(6);

    // Attempting to decrement more than remaining stock (e.g. 10 units when 6 available) must fail
    await expect(productRepo.decrementStock(product.id, 10)).rejects.toThrow(
      /Insufficient stock/,
    );
  });

  it('4. should execute SQL ON CONFLICT DO UPDATE upsert', async () => {
    await productRepo.upsertBySymbol({
      symbol: 'NVDA',
      name: 'Nvidia Corp',
      currentPrice: '12000',
    });

    const initial = await productRepo.findBySymbol('NVDA');
    expect(initial?.currentPrice).toBe('12000');

    // Upsert with new price
    await productRepo.upsertBySymbol({
      symbol: 'NVDA',
      name: 'Nvidia Corp',
      currentPrice: '14500',
    });

    const updated = await productRepo.findBySymbol('NVDA');
    expect(updated?.currentPrice).toBe('14500');
  });

  it('5. should execute SQL GROUP BY aggregation for sector counts', async () => {
    await productRepo.create(aProduct({ symbol: 'P1', sector: 'Technology' }));
    await productRepo.create(aProduct({ symbol: 'P2', sector: 'Technology' }));
    await productRepo.create(aProduct({ symbol: 'P3', sector: 'Automotive' }));

    const sectors = await productRepo.countBySector();
    const tech = sectors.find((s) => s.sector === 'Technology');
    const auto = sectors.find((s) => s.sector === 'Automotive');

    expect(tech?.count).toBe(2);
    expect(auto?.count).toBe(1);
  });
});
