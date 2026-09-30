import 'reflect-metadata';
import AppDataSource from './data-source';
import { Product, Account } from './entities';
import { checkout } from './checkout';

export async function runRaceDemo(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  console.log('🏁 Підготовка до тесту конкурентного навантаження (demo:race)...');

  // 1. Pick target product (AAPL) and reset stock to exactly 10
  const productRepo = dataSource.getRepository(Product);
  let targetProduct = await productRepo.findOne({ where: { symbol: 'AAPL' } });
  if (!targetProduct) {
    targetProduct = await productRepo.findOneOrFail({ where: { tradingStatus: 'ACTIVE' } });
  }

  const INITIAL_STOCK = 10;
  await dataSource.query(
    `UPDATE "products" SET "stock" = $1, "trading_status" = 'ACTIVE' WHERE "id" = $2`,
    [INITIAL_STOCK, targetProduct.id],
  );

  // 2. Fetch available accounts (balances in seed are plentiful: $10,000.00+)
  const accountRepo = dataSource.getRepository(Account);
  const accounts = await accountRepo.find({ take: 10 });
  if (accounts.length === 0) {
    throw new Error('No accounts found in database. Please run npm run seed first.');
  }

  const TOTAL_ATTEMPTS = 50;
  console.log(`🚀 Запуск ${TOTAL_ATTEMPTS} одночасних запитів checkout на товар [${targetProduct.symbol}] (stock: ${INITIAL_STOCK})...`);

  const startTime = Date.now();

  // 3. Fire at least 50 parallel checkout calls via Promise.all (no in-app queue)
  const promises = Array.from({ length: TOTAL_ATTEMPTS }, (_, index) => {
    const account = accounts[index % accounts.length];
    return checkout(dataSource, {
      accountId: account.id,
      productId: targetProduct.id,
      quantity: 1,
      idempotencyKey: `race-test-${Date.now()}-${index}`,
    });
  });

  const settledResults = await Promise.allSettled(promises);
  const elapsedMs = Date.now() - startTime;

  // 4. Calculate outcomes
  const attempts = settledResults.length;
  const successful = settledResults.filter((r) => r.status === 'fulfilled').length;
  const failed = settledResults.filter((r) => r.status === 'rejected').length;

  // 5. Query final state directly from PostgreSQL
  const [{ stock: currentStock }] = await dataSource.query(
    `SELECT "stock" FROM "products" WHERE "id" = $1`,
    [targetProduct.id],
  );
  const finalStock = Number(currentStock);

  const [{ count: negativeCount }] = await dataSource.query(
    `SELECT COUNT(*) AS count FROM "products" WHERE "stock" < 0`,
  );
  const negativeStockRows = Number(negativeCount);

  // 6. Print required metrics
  console.log('\n======================================================');
  console.log('              РЕЗУЛЬТАТИ DEMO:RACE                    ');
  console.log('======================================================');
  console.log(`Кількість спроб: ${attempts}`);
  console.log(`Кількість успішних: ${successful}`);
  console.log(`Кількість відхилених: ${failed}`);
  console.log(`Фінальний stock: ${finalStock}`);
  console.log(`Кількість рядків із відʼємним stock: ${negativeStockRows}`);
  console.log(`Час виконання запитів: ${elapsedMs} мс`);
  console.log('======================================================\n');

  // 7. Verify invariants
  const invariantValid =
    attempts >= 50 &&
    successful === INITIAL_STOCK &&
    finalStock === 0 &&
    negativeStockRows === 0;

  if (!invariantValid) {
    console.error('❌ ПОРУШЕННЯ ІНВАРІАНТУ: Виявлено oversell або некоректний фінальний stock!');
    console.error(`Очікувалося: successful = ${INITIAL_STOCK}, finalStock = 0, negativeStockRows = 0`);
    console.error(`Отримано: successful = ${successful}, finalStock = ${finalStock}, negativeStockRows = ${negativeStockRows}`);
    process.exit(1);
  }

  console.log('✅ Інваріант успішно дотримано: рівно 10 успішних замовлень, 0 oversell, фінальний stock 0.');
}

if (require.main === module) {
  runRaceDemo()
    .then(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Помилка в demo:race:', err);
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(1);
    });
}
