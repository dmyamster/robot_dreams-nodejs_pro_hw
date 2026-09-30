import 'reflect-metadata';
import AppDataSource from './data-source';
import { User, Account, Product, Order, Position } from './entities';

export async function runSeed(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  console.log('🌱 Starting idempotent database seed...');

  const userRepo = dataSource.getRepository(User);
  const accountRepo = dataSource.getRepository(Account);
  const productRepo = dataSource.getRepository(Product);
  const orderRepo = dataSource.getRepository(Order);
  const positionRepo = dataSource.getRepository(Position);

  // 1. Seed Users (10 deterministic users)
  const usersData: Partial<User>[] = [
    {
      id: '00000000-0000-0000-0001-000000000001',
      email: 'admin@broker.example.com',
      passwordHash: '$2b$10$wT8K5s2yqC.7o1/8yH3Q0eYnFqYtP0p9X0e4vXb5qK8f1m2n3o4p5',
      role: 'ADMIN',
      isVerified: true,
    },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `00000000-0000-0000-0001-${String(i + 2).padStart(12, '0')}`,
      email: `investor_${i + 1}@broker.example.com`,
      passwordHash: '$2b$10$wT8K5s2yqC.7o1/8yH3Q0eYnFqYtP0p9X0e4vXb5qK8f1m2n3o4p5',
      role: 'INVESTOR',
      isVerified: true,
    })),
  ];

  await userRepo.upsert(usersData, ['id']);

  // 2. Seed Accounts (10 deterministic accounts, 1 per user)
  const accountsData: Partial<Account>[] = Array.from({ length: 10 }, (_, i) => ({
    id: `00000000-0000-0000-0002-${String(i + 1).padStart(12, '0')}`,
    userId: `00000000-0000-0000-0001-${String(i + 1).padStart(12, '0')}`,
    accountNumber: `ACC-${String(i + 1).padStart(8, '0')}`,
    cashBalance: String(1000000 + i * 500000), // $10,000.00 + i * $5,000.00 in cents
    lockedBalance: String(i * 10000), // in cents
    currency: 'USD',
  }));

  await accountRepo.upsert(accountsData, ['id']);

  // 3. Seed Products (10 deterministic products across different sectors)
  const productsData: Partial<Product>[] = [
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      description: 'Consumer Electronics and Software Services',
      sector: 'Technology',
      currentPrice: '18500', // $185.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/aapl.png',
    },
    {
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      description: 'Semiconductor and AI Hardware',
      sector: 'Technology',
      currentPrice: '12500', // $125.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/nvda.png',
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      description: 'Cloud Computing and Enterprise Software',
      sector: 'Technology',
      currentPrice: '42000', // $420.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/msft.png',
    },
    {
      symbol: 'JPM',
      name: 'JPMorgan Chase & Co.',
      description: 'Investment Banking and Financial Services',
      sector: 'Financial',
      currentPrice: '19800', // $198.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/jpm.png',
    },
    {
      symbol: 'V',
      name: 'Visa Inc.',
      description: 'Global Payments Technology',
      sector: 'Financial',
      currentPrice: '27500', // $275.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/v.png',
    },
    {
      symbol: 'XOM',
      name: 'Exxon Mobil Corporation',
      description: 'Energy and Petrochemicals',
      sector: 'Energy',
      currentPrice: '11500', // $115.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/xom.png',
    },
    {
      symbol: 'CVX',
      name: 'Chevron Corporation',
      description: 'Integrated Energy Operations',
      sector: 'Energy',
      currentPrice: '15500', // $155.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/cvx.png',
    },
    {
      symbol: 'JNJ',
      name: 'Johnson & Johnson',
      description: 'Pharmaceuticals and Medical Technologies',
      sector: 'Healthcare',
      currentPrice: '16000', // $160.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/jnj.png',
    },
    {
      symbol: 'AMZN',
      name: 'Amazon.com Inc.',
      description: 'E-commerce and Cloud Infrastructure',
      sector: 'Consumer',
      currentPrice: '18000', // $180.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/amzn.png',
    },
    {
      symbol: 'TSLA',
      name: 'Tesla Inc.',
      description: 'Electric Vehicles and Clean Energy',
      sector: 'Consumer',
      currentPrice: '25000', // $250.00
      stock: 100,
      tradingStatus: 'ACTIVE',
      logoUrl: 'https://cdn.example.com/tsla.png',
    },
  ];

  await productRepo.upsert(productsData, ['symbol']);

  const allProducts = await productRepo.find();
  const productMap = new Map(allProducts.map((p) => [p.symbol, p.id]));
  const symbols = ['AAPL', 'NVDA', 'MSFT', 'JPM', 'V', 'XOM', 'CVX', 'JNJ', 'AMZN', 'TSLA'];

  // 4. Seed Orders (20 deterministic orders)
  const ordersData: Partial<Order>[] = Array.from({ length: 20 }, (_, i) => {
    const accountIndex = (i % 10) + 1;
    const sym = symbols[i % symbols.length];
    const prodId = productMap.get(sym)!;
    const isBuy = i % 2 === 0;
    const status = i === 18 ? 'PENDING' : i === 19 ? 'CANCELLED' : 'FILLED';
    const quantity = (i + 1) * 10;
    const priceCents = 10000 + (i * 1500);
    const feeCents = 150; // $1.50
    const totalAmount = quantity * priceCents + feeCents;

    return {
      id: `00000000-0000-0000-0003-${String(i + 1).padStart(12, '0')}`,
      accountId: `00000000-0000-0000-0002-${String(accountIndex).padStart(12, '0')}`,
      productId: prodId,
      side: isBuy ? 'BUY' : 'SELL',
      type: i % 3 === 0 ? 'LIMIT' : 'MARKET',
      status,
      quantity,
      limitPrice: i % 3 === 0 ? String(priceCents) : null,
      executionPrice: status === 'FILLED' ? String(priceCents) : null,
      fee: String(feeCents),
      totalAmount: String(totalAmount),
      idempotencyKey: `idemp-key-seed-${i + 1}`,
    };
  });

  await orderRepo.upsert(ordersData, ['id']);

  // 5. Seed Positions (10 deterministic portfolio positions)
  const positionsData: Partial<Position>[] = Array.from({ length: 10 }, (_, i) => {
    const sym = symbols[i];
    const prodId = productMap.get(sym)!;
    return {
      id: `00000000-0000-0000-0004-${String(i + 1).padStart(12, '0')}`,
      accountId: `00000000-0000-0000-0002-${String(i + 1).padStart(12, '0')}`,
      productId: prodId,
      sharesCount: (i + 1) * 25,
      averageBuyPrice: String(12000 + i * 1000), // in cents
    };
  });

  await positionRepo.upsert(positionsData, ['accountId', 'productId']);

  // Summary counts
  const usersCount = await userRepo.count();
  const accountsCount = await accountRepo.count();
  const productsCount = await productRepo.count();
  const ordersCount = await orderRepo.count();
  const positionsCount = await positionRepo.count();

  console.log('✅ Seed completed successfully:');
  console.log(`   - Users:     ${usersCount}`);
  console.log(`   - Accounts:  ${accountsCount}`);
  console.log(`   - Products:  ${productsCount}`);
  console.log(`   - Orders:    ${ordersCount}`);
  console.log(`   - Positions: ${positionsCount}`);
}

if (require.main === module) {
  runSeed()
    .then(async () => {
      await AppDataSource.destroy();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('❌ Seed failed:', error);
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(1);
    });
}
