import * as amqp from "amqplib";
import {
  RABBITMQ_EXCHANGE,
  RABBITMQ_DLX_EXCHANGE,
  RABBITMQ_QUEUE_ORDER_PLACED,
  RABBITMQ_QUEUE_ORDER_PLACED_DLQ,
  RABBITMQ_ROUTING_KEY_ORDER_PLACED,
  RABBITMQ_ROUTING_KEY_ORDER_PLACED_DLQ,
} from "./rabbitmq.constants";

/**
 * Declares the RabbitMQ topology:
 * - Domain Topic Exchange (shop.events)
 * - Dead Letter Exchange (shop.dlx)
 * - Dead Letter Queue (orders.order-placed.dlq) + binding to DLX
 * - Work Queue (orders.order-placed) with x-dead-letter-exchange & x-dead-letter-routing-key + binding to shop.events
 *
 * NOTE: As per architectural requirements, the consumer/bootstrap declares the topology,
 * NOT the producer (the producer does not know who consumes its events).
 */
export async function setupTopology(channel: amqp.Channel): Promise<void> {
  // 1. Declare Domain Topic Exchange
  await channel.assertExchange(RABBITMQ_EXCHANGE, "topic", { durable: true });

  // 2. Declare Dead Letter Exchange (DLX)
  await channel.assertExchange(RABBITMQ_DLX_EXCHANGE, "topic", {
    durable: true,
  });

  // 3. Declare Dead Letter Queue (DLQ) and bind to DLX
  await channel.assertQueue(RABBITMQ_QUEUE_ORDER_PLACED_DLQ, {
    durable: true,
  });
  await channel.bindQueue(
    RABBITMQ_QUEUE_ORDER_PLACED_DLQ,
    RABBITMQ_DLX_EXCHANGE,
    RABBITMQ_ROUTING_KEY_ORDER_PLACED_DLQ,
  );

  // 4. Declare Work Queue with DLX arguments and bind to Domain Exchange
  await channel.assertQueue(RABBITMQ_QUEUE_ORDER_PLACED, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": RABBITMQ_DLX_EXCHANGE,
      "x-dead-letter-routing-key": RABBITMQ_ROUTING_KEY_ORDER_PLACED_DLQ,
    },
  });
  await channel.bindQueue(
    RABBITMQ_QUEUE_ORDER_PLACED,
    RABBITMQ_EXCHANGE,
    RABBITMQ_ROUTING_KEY_ORDER_PLACED,
  );
}

/**
 * Resets queues and re-asserts topology cleanly.
 * Used by demo scripts to ensure a pristine state before running tests.
 */
export async function resetQueues(channel: amqp.Channel): Promise<void> {
  try {
    await channel.deleteQueue(RABBITMQ_QUEUE_ORDER_PLACED);
  } catch {}
  try {
    await channel.deleteQueue(RABBITMQ_QUEUE_ORDER_PLACED_DLQ);
  } catch {}
  await setupTopology(channel);
}
