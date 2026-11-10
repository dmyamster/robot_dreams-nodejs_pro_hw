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

export async function runDemoCrashWrite(): Promise<void> {
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

  // 2. Perform checkout with simulated crash right after outbox insertion (before COMMIT)
  let writeFailed = 0;
  try {
    await checkout(dataSource, {
      accountId: targetAccount.id,
      productId: targetProduct.id,
      quantity: 5,
      idempotencyKey: `crash-write-${Date.now()}`,
      simulateCrashAfterOutbox: true,
    });
  } catch (err: any) {
    if (err.message.includes('Simulated write failure')) {
      writeFailed = 1;
    } else {
      throw err;
    }
  }

  // 3. Start Consumer to verify no events were ever routed to broker
  const consumer = new OrderPlacedConsumer(conn, dataSource);
  await consumer.start();

  // 4. Run Relay Worker to attempt publishing unpublished outbox records
  const publisher = new OrderEventPublisher(conn);
  const relayStats = await runOutboxRelayOnce(dataSource, publisher, { batchSize: 10 });
  await publisher.close();

  // Allow brief window for any accidental delivery
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 5. Query counts from durable storage
  const [{ count: ordersCount }] = await dataSource.query(`SELECT COUNT(*) AS count FROM "orders"`);
  const [{ count: outboxCount }] = await dataSource.query(`SELECT COUNT(*) AS count FROM "outbox"`);
  const [{ count: effectCount }] = await dataSource.query(
    `SELECT COUNT(*) AS count FROM "order_notifications"`,
  );

  // Cleanup
  await consumer.stop();
  await mgmtChannel.close();
  await conn.close();
  await dataSource.destroy();

  const orders = Number(ordersCount);
  const outbox = Number(outboxCount);
  const published = relayStats.published;
  const deliveries = consumer.stats.delivered;
  const effect = Number(effectCount);

  // 6. Output key=number contract for grading
  console.log(`write-failed=${writeFailed}`);
  console.log(`orders=${orders}`);
  console.log(`outbox=${outbox}`);
  console.log(`published=${published}`);
  console.log(`deliveries=${deliveries}`);
  console.log(`effect=${effect}`);

  // 7. Verify invariant
  const ok =
    writeFailed === 1 &&
    orders === 0 &&
    outbox === 0 &&
    published === 0 &&
    deliveries === 0 &&
    effect === 0;

  if (!ok) {
    console.error('❌ demo:crash-write invariant violated!');
    process.exit(1);
  }
}

if (require.main === module) {
  runDemoCrashWrite().catch((err) => {
    console.error('demo:crash-write failed:', err);
    process.exit(1);
  });
}

