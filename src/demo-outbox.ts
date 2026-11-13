import 'reflect-metadata';
import AppDataSource from './data-source';
import { Product, Account } from './entities';
import { checkout } from './checkout';
import {
  createConnection,
  resetQueues,
  OrderEventPublisher,
  OrderPlacedConsumer,
  runOutboxRelayOnce,
} from './rabbitmq';

export async function runDemoOutbox(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  // 1. Reset state to clean: wipe DB tables and reset queues
  await dataSource.query(`DELETE FROM "order_notifications"`);
  await dataSource.query(`DELETE FROM "processed_messages"`);
  await dataSource.query(`DELETE FROM "processed_events"`);
  await dataSource.query(`DELETE FROM "outbox"`);
  await dataSource.query(`DELETE FROM "order_tasks"`);
  await dataSource.query(`DELETE FROM "orders"`);

  // Ensure active product exists with stock
  let targetProduct = await dataSource.getRepository(Product).findOne({ where: { symbol: 'AAPL' } });
  if (!targetProduct) {
    targetProduct = await dataSource.getRepository(Product).findOneOrFail({ where: { tradingStatus: 'ACTIVE' } });
  }
  await dataSource.query(
    `UPDATE "products" SET "stock" = 100, "trading_status" = 'ACTIVE' WHERE "id" = $1`,
    [targetProduct.id],
  );

  // Ensure account exists with sufficient cash
  const accounts = await dataSource.getRepository(Account).find({ take: 1 });
  const targetAccount = accounts[0];
  if (!targetAccount) {
    throw new Error('No accounts found. Please ensure database is seeded.');
  }
  await dataSource.query(
    `UPDATE "accounts" SET "cash_balance" = 1000000 WHERE "id" = $1`,
    [targetAccount.id],
  );

  // Connect to RabbitMQ and reset topology
  const conn = await createConnection();
  const mgmtChannel = await conn.createChannel();
  await resetQueues(mgmtChannel);

  // 2. Perform 2 requests with the SAME Idempotency-Key
  const IDEMPOTENCY_KEY = `idem-outbox-${Date.now()}`;
  const requestCount = 2;

  // Request #1: Creates order & outbox entry in 1 atomic COMMIT
  const res1 = await checkout(dataSource, {
    accountId: targetAccount.id,
    productId: targetProduct.id,
    quantity: 5,
    idempotencyKey: IDEMPOTENCY_KEY,
  });

  // Request #2: Same Idempotency-Key -> returns cached order (isReplay=true), NO duplicate order or outbox entry
  const res2 = await checkout(dataSource, {
    accountId: targetAccount.id,
    productId: targetProduct.id,
    quantity: 5,
    idempotencyKey: IDEMPOTENCY_KEY,
  });

  // 3. Start Consumer to receive message
  const consumer = new OrderPlacedConsumer(conn, dataSource);
  await consumer.start();

  // 4. Run Relay Worker to poll and publish outbox records
  const publisher = new OrderEventPublisher(conn);
  const relayStats = await runOutboxRelayOnce(dataSource, publisher, { batchSize: 10 });
  await publisher.close();

  // Wait for consumer to process message
  const startWait = Date.now();
  while (consumer.stats.acked < 1 && Date.now() - startWait < 8000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // 5. Query counts from durable storage
  const [{ count: ordersCount }] = await dataSource.query(`SELECT COUNT(*) AS count FROM "orders"`);
  const [{ count: outboxCount }] = await dataSource.query(`SELECT COUNT(*) AS count FROM "outbox"`);
  const [{ count: publishedCount }] = await dataSource.query(
    `SELECT COUNT(*) AS count FROM "outbox" WHERE "published_at" IS NOT NULL`,
  );
  const [{ count: effectCount }] = await dataSource.query(
    `SELECT COUNT(*) AS count FROM "order_notifications"`,
  );
  const [{ count: processedCount }] = await dataSource.query(
    `SELECT COUNT(*) AS count FROM "processed_messages"`,
  );

  // Cleanup
  await consumer.stop();
  await mgmtChannel.close();
  await conn.close();
  await dataSource.destroy();

  const requests = requestCount;
  const orders = Number(ordersCount);
  const outbox = Number(outboxCount);
  const published = Number(publishedCount);
  const deliveries = consumer.stats.delivered;
  const effect = Number(effectCount);
  const processed = Number(processedCount);

  // 6. Output key=number contract for grading
  console.log(`requests=${requests}`);
  console.log(`orders=${orders}`);
  console.log(`outbox=${outbox}`);
  console.log(`published=${published}`);
  console.log(`deliveries=${deliveries}`);
  console.log(`effect=${effect}`);
  console.log(`processed=${processed}`);

  // 7. Verify invariant
  const ok =
    requests === 2 &&
    orders === 1 &&
    outbox === 1 &&
    published === 1 &&
    deliveries === 1 &&
    effect === 1 &&
    processed === 1 &&
    res1.isReplay === false &&
    res2.isReplay === true;

  if (!ok) {
    console.error('❌ demo:outbox invariant violated!');
    process.exit(1);
  }
}

if (require.main === module) {
  runDemoOutbox().catch((err) => {
    console.error('demo:outbox failed:', err);
    process.exit(1);
  });
}

