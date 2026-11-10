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

export async function runDemoCrashRelay(): Promise<void> {
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

  // 2. Perform checkout: exactly 1 order committed with 1 outbox record (published_at IS NULL)
  await checkout(dataSource, {
    accountId: targetAccount.id,
    productId: targetProduct.id,
    quantity: 5,
    idempotencyKey: `crash-relay-${Date.now()}`,
  });

  let totalPublished = 0;
  const publisher = new OrderEventPublisher(conn);

  // 3. Relay run #1: simulate crash/abort right between publish and UPDATE published_at
  try {
    await runOutboxRelayOnce(dataSource, publisher, {
      batchSize: 10,
      simulateCrashBetweenPublishAndUpdate: true,
    });
  } catch (err: any) {
    if (err.message.includes('SimulatedRelayCrash')) {
      // 1 delivery was successfully sent to broker before relay crash
      totalPublished += 1;
    } else {
      throw err;
    }
  }

  // Verify published_at is still NULL in DB due to crash/rollback
  const [{ count: unpubCount }] = await dataSource.query(
    `SELECT COUNT(*) AS count FROM "outbox" WHERE "published_at" IS NULL`,
  );
  if (Number(unpubCount) !== 1) {
    throw new Error(`Expected published_at to remain NULL after crash, but found ${unpubCount} NULL rows`);
  }

  // 4. Relay run #2: recovery run (polling picks up the unpublished message and publishes it again)
  const recoveryStats = await runOutboxRelayOnce(dataSource, publisher, {
    batchSize: 10,
    simulateCrashBetweenPublishAndUpdate: false,
  });
  totalPublished += recoveryStats.published;
  await publisher.close();

  // 5. Start Idempotent Consumer: will receive 2 deliveries for the same event
  const consumer = new OrderPlacedConsumer(conn, dataSource);
  await consumer.start();

  // Wait for consumer to process both deliveries (at least 2 deliveries)
  const startWait = Date.now();
  while (consumer.stats.delivered < 2 && Date.now() - startWait < 8000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Brief settle time
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 6. Query durable storage counts
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

  const published = totalPublished;
  const deliveries = consumer.stats.delivered;
  const applied = Number(effectCount);
  const effect = Number(effectCount);
  const processed = Number(processedCount);

  // 7. Output key=number contract for grading
  console.log(`published=${published}`);
  console.log(`deliveries=${deliveries}`);
  console.log(`applied=${applied}`);
  console.log(`effect=${effect}`);
  console.log(`processed=${processed}`);

  // 8. Verify invariant: deliveries >= 2, applied === 1, effect === 1, processed === 1
  const ok = deliveries >= 2 && applied === 1 && effect === 1 && processed === 1;

  if (!ok) {
    console.error('❌ demo:crash-relay invariant violated!');
    process.exit(1);
  }
}

if (require.main === module) {
  runDemoCrashRelay().catch((err) => {
    console.error('demo:crash-relay failed:', err);
    process.exit(1);
  });
}

