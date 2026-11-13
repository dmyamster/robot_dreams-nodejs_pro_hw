import "reflect-metadata";
import * as path from "path";
import { fork } from "child_process";
import AppDataSource from "./data-source";
import {
  createConnection,
  resetQueues,
  OrderPlacedConsumer,
  OrderPlacedEvent,
  OrderEventPublisher,
} from "./rabbitmq";

export async function runDemoDuplicate(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  // 1. Reset state to clean: wipe DB records
  await dataSource.query(`DELETE FROM "order_notifications"`);
  await dataSource.query(`DELETE FROM "processed_events"`);

  // 2. Connect to RabbitMQ and reset topology
  const conn = await createConnection();
  const mgmtChannel = await conn.createChannel();
  await resetQueues(mgmtChannel);

  // 3. Publish exactly 1 event with a stable eventId
  const STABLE_EVENT_ID = `stable-evt-${Date.now()}`;
  const publisher = new OrderEventPublisher(conn);
  const event: OrderPlacedEvent = {
    eventId: STABLE_EVENT_ID,
    type: "order.placed",
    occurredAt: new Date().toISOString(),
    data: {
      orderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      accountId: "b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      productId: "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
      symbol: "AAPL",
      quantity: 5,
      price: "22050",
      totalAmount: "110400",
    },
  };

  await publisher.publishOrderPlaced(event);
  await publisher.close();

  // 4. Spawn child worker process for Delivery #1.
  // The worker will apply the effect to PostgreSQL and abruptly terminate with SIGKILL (kill -9) BEFORE sending ack.
  const workerScript = path.resolve(__dirname, "demo-duplicate-worker.js");
  const child = fork(workerScript, [], {
    env: { ...process.env },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  await new Promise<void>((resolve) => {
    child.on("exit", () => {
      resolve();
    });
    child.on("error", () => {
      resolve();
    });
  });

  // Brief pause for RabbitMQ to detect TCP connection drop and requeue unacked message
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 5. Start Consumer 2 for Delivery #2 (re-delivery).
  // The consumer checks the DB; detects that STABLE_EVENT_ID was already processed, skips the effect, and acks.
  const consumer2 = new OrderPlacedConsumer(conn, dataSource);
  await consumer2.start();

  const startWait = Date.now();
  while (consumer2.stats.acked < 1 && Date.now() - startWait < 8000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // 6. Verify database state
  const [{ count: effectCount }] = await dataSource.query(
    `SELECT COUNT(*) AS count FROM "order_notifications" WHERE "event_id" = $1`,
    [STABLE_EVENT_ID],
  );

  const deliveries = 1 + consumer2.stats.delivered; // 1 from worker + 1 from consumer2 = 2
  const effect = Number(effectCount); // exactly 1 in DB
  const skipped = consumer2.stats.skipped; // 1

  // Cleanup
  await consumer2.stop();
  await mgmtChannel.close();
  await conn.close();
  await dataSource.destroy();

  // 7. Output key=value contract
  console.log(`deliveries=${deliveries}`);
  console.log(`effect=${effect}`);
  console.log(`skipped=${skipped}`);

  // 8. Self-verification of invariant
  const ok = deliveries >= 2 && effect === 1;

  if (!ok) {
    console.error("❌ demo:duplicate invariant violated!");
    process.exit(1);
  }
}

if (require.main === module) {
  runDemoDuplicate().catch((err) => {
    console.error("demo:duplicate failed with error:", err);
    process.exit(1);
  });
}
