import "reflect-metadata";
import AppDataSource from "./data-source";
import { createConnection, OrderPlacedConsumer } from "./rabbitmq";

async function runWorker(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  const conn = await createConnection();
  const consumer = new OrderPlacedConsumer(conn, dataSource);

  await consumer.start({
    beforeAck: async (_msg, _event, _isDuplicate) => {
      // Effect is now committed in PostgreSQL.
      // We simulate an abrupt crash (OOM / SIGKILL / container killed)
      // BEFORE acknowledging the message back to RabbitMQ.
      console.error(
        "[Worker] Effect applied to DB. Simulating process kill -9 before ack...",
      );
      process.kill(process.pid, "SIGKILL");
    },
  });

  // Signal to parent that worker is ready
  if (process.send) {
    process.send("READY");
  }
}

runWorker().catch((err) => {
  console.error("[Worker] Failed:", err);
  process.exit(1);
});
