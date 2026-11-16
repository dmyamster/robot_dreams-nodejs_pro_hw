import { Queue, Worker, Job, ConnectionOptions } from 'bullmq';
import { getQueueRedisUrl, parseRedisOptions } from './redis.clients';

export const ORDER_POST_PROCESS_QUEUE = 'order-post-process';

export interface OrderPostProcessPayload {
  orderId?: string;
  symbol: string;
  failUntilAttempt?: number;
  source?: string;
}

export function createOrderQueue(queueName = ORDER_POST_PROCESS_QUEUE): Queue<OrderPostProcessPayload> {
  return new Queue(queueName, {
    connection: parseRedisOptions(getQueueRedisUrl(), false) as ConnectionOptions,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 150,
        jitter: 0.5,
      },
      // Do NOT use removeOnComplete: true, as it disables jobId deduplication
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 3600 },
    },
  });
}

export function createOrderWorker(
  processor: (job: Job<OrderPostProcessPayload>) => Promise<void>,
  queueName = ORDER_POST_PROCESS_QUEUE,
): Worker<OrderPostProcessPayload> {
  return new Worker(queueName, processor, {
    connection: parseRedisOptions(getQueueRedisUrl(), true) as ConnectionOptions,
    concurrency: 2,
  });
}

export async function enqueueOrderPostProcess(
  queue: Queue<OrderPostProcessPayload>,
  data: OrderPostProcessPayload,
  jobId: string,
): Promise<Job<OrderPostProcessPayload>> {
  return queue.add('order-post-process', data, {
    jobId,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 150,
      jitter: 0.5,
    },
    removeOnComplete: { age: 3600 },
  });
}

export async function upsertRatingRecalcScheduler(
  queue: Queue<OrderPostProcessPayload>,
  everyMs = 400,
  schedulerId = 'recalculate-ratings-scheduler',
) {
  return queue.upsertJobScheduler(
    schedulerId,
    { every: everyMs },
    {
      name: 'recalculate-ratings',
      data: { symbol: 'ALL', source: 'scheduler' },
      opts: {
        removeOnComplete: { age: 3600 },
      },
    },
  );
}
