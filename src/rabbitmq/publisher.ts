import * as amqp from "amqplib";
import {
  RABBITMQ_EXCHANGE,
  RABBITMQ_ROUTING_KEY_ORDER_PLACED,
} from "./rabbitmq.constants";
import { OrderPlacedEvent } from "./contracts";

export class OrderEventPublisher {
  private confirmChannel: amqp.ConfirmChannel | null = null;

  constructor(private readonly connection: amqp.ChannelModel) {}

  async getConfirmChannel(): Promise<amqp.ConfirmChannel> {
    if (!this.confirmChannel) {
      this.confirmChannel = await this.connection.createConfirmChannel();
    }
    return this.confirmChannel;
  }

  /**
   * Publishes an order.placed event to the domain topic exchange using a confirm channel.
   * Awaits broker confirmation (waitForConfirms) to guarantee receipt.
   *
   * Note: As per architecture requirements, the publisher does NOT assert queues or bindings;
   * it publishes to the exchange with routing key 'order.placed'.
   */
  async publishOrderPlaced(event: OrderPlacedEvent): Promise<boolean> {
    const channel = await this.getConfirmChannel();
    const payload = Buffer.from(JSON.stringify(event));

    channel.publish(
      RABBITMQ_EXCHANGE,
      RABBITMQ_ROUTING_KEY_ORDER_PLACED,
      payload,
      {
        persistent: true,
        contentType: "application/json",
        messageId: event.eventId,
        timestamp: new Date(event.occurredAt).getTime() || Date.now(),
      },
    );

    await channel.waitForConfirms();
    return true;
  }

  async close(): Promise<void> {
    if (this.confirmChannel) {
      await this.confirmChannel.close();
      this.confirmChannel = null;
    }
  }
}
