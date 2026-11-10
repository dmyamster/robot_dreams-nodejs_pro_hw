import { DataSource } from 'typeorm';
import { OrderEventPublisher } from './publisher';
import { OrderPlacedEvent } from './contracts';

export interface OutboxRelayOptions {
  batchSize?: number;
  simulateCrashBetweenPublishAndUpdate?: boolean;
}

export interface RelayRunStats {
  found: number;
  published: number;
  updated: number;
}

/**
 * Executes one polling batch iteration of the Transactional Outbox Relay:
 * 1. SELECT ... WHERE published_at IS NULL ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT N
 * 2. publish to broker
 * 3. UPDATE published_at = NOW()
 *
 * Uses FOR UPDATE SKIP LOCKED to ensure multiple concurrent relay worker instances
 * do not block each other and do not produce duplicate fetches.
 */
export async function runOutboxRelayOnce(
  dataSource: DataSource,
  publisher: OrderEventPublisher,
  options?: OutboxRelayOptions,
): Promise<RelayRunStats> {
  const batchSize = options?.batchSize || 10;
  const stats: RelayRunStats = { found: 0, published: 0, updated: 0 };

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // 1. SELECT ... WHERE published_at IS NULL ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT N
    const rows = await queryRunner.query(
      `SELECT "id", "aggregate_type", "aggregate_id", "type", "payload", "attempts"
       FROM "outbox"
       WHERE "published_at" IS NULL
       ORDER BY "created_at" ASC, "id" ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [batchSize],
    );

    const outboxRows: any[] = Array.isArray(rows[0]) ? rows[0] : rows;
    stats.found = outboxRows.length;

    for (const row of outboxRows) {
      const event: OrderPlacedEvent =
        typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

      // 2. publish to broker
      await publisher.publishOrderPlaced(event);
      stats.published++;

      // Modeled crash: simulated process crash right between publish and UPDATE published_at
      if (options?.simulateCrashBetweenPublishAndUpdate) {
        await queryRunner.rollbackTransaction();
        throw new Error(
          'SimulatedRelayCrash: process died between publish and UPDATE published_at',
        );
      }

      // 3. UPDATE published_at
      await queryRunner.query(
        `UPDATE "outbox"
         SET "published_at" = NOW(),
             "attempts" = "attempts" + 1
         WHERE "id" = $1`,
        [row.id],
      );
      stats.updated++;
    }

    await queryRunner.commitTransaction();
  } catch (err) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    throw err;
  } finally {
    await queryRunner.release();
  }

  return stats;
}

/**
 * Continuous polling background worker for Outbox relay.
 */
export class OutboxRelayWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  public totalPublished = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly publisher: OrderEventPublisher,
    private readonly pollIntervalMs: number = 200,
    private readonly batchSize: number = 10,
  ) {}

  async start(): Promise<void> {
    this.isRunning = true;
    const pollLoop = async () => {
      if (!this.isRunning) return;
      try {
        const stats = await runOutboxRelayOnce(this.dataSource, this.publisher, {
          batchSize: this.batchSize,
        });
        this.totalPublished += stats.published;
      } catch (err) {
        // Polling errors (e.g. transient DB disconnection) do not kill worker loop
      }
      if (this.isRunning) {
        this.timer = setTimeout(pollLoop, this.pollIntervalMs);
      }
    };
    pollLoop();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(options?: OutboxRelayOptions): Promise<RelayRunStats> {
    return runOutboxRelayOnce(this.dataSource, this.publisher, options);
  }
}

