import * as amqp from "amqplib";
import { DataSource } from "typeorm";
import {
  RABBITMQ_QUEUE_ORDER_PLACED,
  DEFAULT_PREFETCH,
} from "./rabbitmq.constants";
import { setupTopology } from "./topology";
import { OrderPlacedEvent } from "./contracts";

export interface ConsumerStats {
  delivered: number;
  effect: number;
  acked: number;
  rejected: number;
  skipped: number;
}

export interface ConsumerOptions {
  prefetch?: number;
  beforeAck?: (
    msg: amqp.ConsumeMessage,
    event: OrderPlacedEvent,
    isDuplicate: boolean,
  ) => Promise<void> | void;
}

export class OrderPlacedConsumer {
  private channel: amqp.Channel | null = null;
  private consumerTag: string | null = null;
  public stats: ConsumerStats = {
    delivered: 0,
    effect: 0,
    acked: 0,
    rejected: 0,
    skipped: 0,
  };

  constructor(
    private readonly connection: amqp.ChannelModel,
    private readonly dataSource: DataSource,
    private readonly prefetchCount: number = DEFAULT_PREFETCH,
  ) {}

  async start(options?: ConsumerOptions): Promise<void> {
    this.channel = await this.connection.createChannel();

    // Consumer declares topology before subscribing
    await setupTopology(this.channel);

    const prefetch = options?.prefetch ?? this.prefetchCount;
    // Set explicit prefetch to prevent buffer overrun and starvation
    await this.channel.prefetch(prefetch);

    const { consumerTag } = await this.channel.consume(
      RABBITMQ_QUEUE_ORDER_PLACED,
      async (msg) => {
        if (!msg) return;
        this.stats.delivered++;

        let event: OrderPlacedEvent;
        try {
          const contentStr = msg.content.toString("utf-8");
          event = JSON.parse(contentStr);

          if (
            !event ||
            !event.eventId ||
            event.type !== "order.placed" ||
            event.isPoison
          ) {
            throw new Error(
              `Poison message or invalid contract: ${contentStr}`,
            );
          }
        } catch {
          // Poison message: reject with requeue=false -> routed to DLX (dead-lettered)
          this.stats.rejected++;
          this.channel?.reject(msg, false);
          return;
        }

        let isDuplicate = false;
        try {
          // Idempotent effect via natural key constraint in durable storage:
          // INSERT INTO processed_events ... ON CONFLICT DO NOTHING RETURNING event_id
          const insertResult = await this.dataSource.query(
            `INSERT INTO "processed_events" ("event_id", "event_type", "order_id", "payload", "created_at")
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT ("event_id") DO NOTHING
             RETURNING "event_id"`,
            [
              event.eventId,
              event.type,
              event.data?.orderId || null,
              JSON.stringify(event.data || {}),
            ],
          );

          const insertedRows = Array.isArray(insertResult[0])
            ? insertResult[0]
            : insertResult;

          if (insertedRows && insertedRows.length > 0) {
            // Natural key conflict did not occur: apply business effect
            await this.dataSource.query(
              `INSERT INTO "order_notifications" ("id", "event_id", "order_id", "message", "created_at")
               VALUES (uuid_generate_v4(), $1, $2, $3, NOW())
               ON CONFLICT ("event_id") DO NOTHING`,
              [
                event.eventId,
                event.data?.orderId || null,
                `Order ${event.data?.orderId} for ${event.data?.quantity} shares of ${event.data?.symbol} placed successfully.`,
              ],
            );
            this.stats.effect++;
          } else {
            // Already present in durable storage: duplicate detected, skip effect
            isDuplicate = true;
            this.stats.skipped++;
          }

          // Optional hook (e.g. for simulating process death before ack)
          if (options?.beforeAck) {
            await options.beforeAck(msg, event, isDuplicate);
          }

          // Manual ACK: only after effect has been safely applied to DB
          this.channel?.ack(msg);
          this.stats.acked++;
        } catch {
          // DB or unrecoverable processing error -> reject without requeue to DLX
          this.stats.rejected++;
          this.channel?.reject(msg, false);
        }
      },
      { noAck: false }, // Manual acknowledgment enforced
    );

    this.consumerTag = consumerTag;
  }

  async stop(): Promise<void> {
    if (this.channel) {
      if (this.consumerTag) {
        try {
          await this.channel.cancel(this.consumerTag);
        } catch {}
      }
      try {
        await this.channel.close();
      } catch {}
      this.channel = null;
    }
  }
}
