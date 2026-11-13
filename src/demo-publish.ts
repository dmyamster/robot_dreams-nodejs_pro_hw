import 'reflect-metadata';
import AppDataSource from './data-source';
import { Product, Account } from './entities';
import { checkout } from './checkout';
import {
  createConnection,
  resetQueues,
  OrderPlacedConsumer,
  RABBITMQ_QUEUE_ORDER_PLACED,
  RABBITMQ_QUEUE_ORDER_PLACED_DLQ,
  DEFAULT_PREFETCH,
} from './rabbitmq';

export async function runDemoPublish(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  // 1. Reset state to clean: wipe notifications & processed events
  await dataSource.query(`DELETE FROM "order_notifications"`);
  await dataSource.query(`DELETE FROM "processed_events"`);

  // Ensure an active product and an account exist
  let targetProduct = await dataSource.getRepository(Product).findOne({ where: { symbol: 'AAPL' } });
  if (!targetProduct) {
    targetProduct = await dataSource.getRepository(Product).findOneOrFail({ where: { tradingStatus: 'ACTIVE' } });
  }
  // Ensure stock is available
  await dataSource.query(`UPDATE "products" SET "stock" = 100, "trading_status" = 'ACTIVE' WHERE "id" = $1`, [
    targetProduct.id,
  ]);

  let accounts = await dataSource.getRepository(Account).find({ take: 1 });
  let targetAccount = accounts[0];
  if (!targetAccount) {
    throw new Error('No accounts found. Please run seed or ensure database is seeded.');
  }
  // Ensure account has sufficient cash balance
  await dataSource.query(`UPDATE "accounts" SET "cash_balance" = 1000000 WHERE "id" = $1`, [targetAccount.id]);

  // 2. Connect to RabbitMQ and reset topology to clean state
  const conn = await createConnection();
  const mgmtChannel = await conn.createChannel();
  await resetQueues(mgmtChannel);

  // 3. Start Consumer with explicit prefetch
  const PREFETCH = DEFAULT_PREFETCH; // 10
  const consumer = new OrderPlacedConsumer(conn, dataSource, PREFETCH);
  await consumer.start({ prefetch: PREFETCH });

  // 4. Publish exactly 5 events from real checkout business operation
  const TOTAL_EVENTS = 5;
  for (let i = 1; i <= TOTAL_EVENTS; i++) {
    await checkout(dataSource, {
      accountId: targetAccount.id,
      productId: targetProduct.id,
      quantity: 1,
      idempotencyKey: `demo-pub-key-${Date.now()}-${i}`,
      publishEvent: true,
      amqpConnection: conn,
    });
  }

  // 5. Wait for consumer to process and ack all 5 events
  const startWait = Date.now();
  while (consumer.stats.acked < TOTAL_EVENTS && Date.now() - startWait < 10000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // 6. Query queue depths
  const workCheck = await mgmtChannel.checkQueue(RABBITMQ_QUEUE_ORDER_PLACED);
  const dlqCheck = await mgmtChannel.checkQueue(RABBITMQ_QUEUE_ORDER_PLACED_DLQ);

  const published = TOTAL_EVENTS;
  const delivered = consumer.stats.delivered;
  const effect = consumer.stats.effect;
  const acked = consumer.stats.acked;
  const work = workCheck.messageCount;
  const dlq = dlqCheck.messageCount;
  const prefetch = PREFETCH;

  // Cleanup
  await consumer.stop();
  await mgmtChannel.close();
  await conn.close();
  await dataSource.destroy();

  // 7. Print summary in required key=value contract
  console.log(`published=${published}`);
  console.log(`delivered=${delivered}`);
  console.log(`effect=${effect}`);
  console.log(`acked=${acked}`);
  console.log(`work=${work}`);
  console.log(`dlq=${dlq}`);
  console.log(`prefetch=${prefetch}`);

  // 8. Self-verification of invariant
  const ok =
    published === 5 &&
    delivered === 5 &&
    effect === 5 &&
    acked === 5 &&
    dlq === 0 &&
    prefetch >= 1 &&
    prefetch <= 2000;

  if (!ok) {
    console.error('❌ demo:publish invariant violated!');
    process.exit(1);
  }
}

if (require.main === module) {
  runDemoPublish().catch((err) => {
    console.error('demo:publish failed with error:', err);
    process.exit(1);
  });
}
