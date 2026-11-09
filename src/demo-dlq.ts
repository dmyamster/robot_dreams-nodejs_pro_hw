import "reflect-metadata";
import * as crypto from "crypto";
import AppDataSource from "./data-source";
import {
  createConnection,
  resetQueues,
  OrderPlacedConsumer,
  OrderPlacedEvent,
  OrderEventPublisher,
  RABBITMQ_QUEUE_ORDER_PLACED,
  RABBITMQ_QUEUE_ORDER_PLACED_DLQ,
} from "./rabbitmq";

export async function runDemoDlq(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  // 1. Reset state to clean
  await dataSource.query(`DELETE FROM "order_notifications"`);
  await dataSource.query(`DELETE FROM "processed_events"`);

  // 2. Connect to RabbitMQ and reset topology
  const conn = await createConnection();
  const mgmtChannel = await conn.createChannel();
  await resetQueues(mgmtChannel);

  // 3. Start Consumer
  const consumer = new OrderPlacedConsumer(conn, dataSource);
  await consumer.start();

  // 4. Publish 1 poisoned message (marked with isPoison: true)
  const publisher = new OrderEventPublisher(conn);
  const poisonEvent: OrderPlacedEvent = {
    eventId: crypto.randomUUID(),
    type: "order.placed",
    occurredAt: new Date().toISOString(),
    data: {
      orderId: "00000000-0000-0000-0000-000000000000",
      accountId: "00000000-0000-0000-0000-000000000000",
      productId: "00000000-0000-0000-0000-000000000000",
      symbol: "POISON",
      quantity: -999,
      price: "0",
      totalAmount: "0",
    },
    isPoison: true,
  };

  await publisher.publishOrderPlaced(poisonEvent);
  await publisher.close();

  // 5. Wait for consumer to process (and reject to DLX)
  const startWait = Date.now();
  while (consumer.stats.rejected < 1 && Date.now() - startWait < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));

  // 6. Stop consumer on work queue
  await consumer.stop();

  // 7. Inspect queue depths
  const workCheck = await mgmtChannel.checkQueue(RABBITMQ_QUEUE_ORDER_PLACED);
  const dlqCheck = await mgmtChannel.checkQueue(
    RABBITMQ_QUEUE_ORDER_PLACED_DLQ,
  );

  const work = workCheck.messageCount;
  const dlq = dlqCheck.messageCount;
  const rejected = consumer.stats.rejected;
  const effect = consumer.stats.effect;

  // 8. Read the dead-lettered message from DLQ to inspect x-death / x-first-death-reason
  const dlqMsg = await mgmtChannel.get(RABBITMQ_QUEUE_ORDER_PLACED_DLQ, {
    noAck: false,
  });
  let dlqReason = "";

  if (dlqMsg) {
    const headers = dlqMsg.properties.headers || {};
    // Extract reason from headers
    if (typeof headers["x-first-death-reason"] === "string") {
      dlqReason = headers["x-first-death-reason"];
    } else if (
      Array.isArray(headers["x-death"]) &&
      headers["x-death"].length > 0
    ) {
      dlqReason = String(headers["x-death"][0].reason);
    } else {
      dlqReason = "rejected";
    }
    // Requeue back into DLQ so the queue count remains dlq=1 for inspection
    mgmtChannel.nack(dlqMsg, false, true);
  }

  // Cleanup
  await mgmtChannel.close();
  await conn.close();
  await dataSource.destroy();

  // 9. Output key=value lines
  console.log(`rejected=${rejected}`);
  console.log(`work=${work}`);
  console.log(`dlq=${dlq}`);
  console.log(`dlq-reason=${dlqReason}`);
  console.log(`effect=${effect}`);

  // 10. Self-verification of invariant
  const validReasons = ["rejected", "expired", "maxlen", "delivery_limit"];
  const ok =
    work === 0 &&
    dlq === 1 &&
    validReasons.includes(dlqReason) &&
    effect === 0 &&
    rejected === 1;

  if (!ok) {
    console.error("❌ demo:dlq invariant violated!");
    process.exit(1);
  }
}

if (require.main === module) {
  runDemoDlq().catch((err) => {
    console.error("demo:dlq failed with error:", err);
    process.exit(1);
  });
}
