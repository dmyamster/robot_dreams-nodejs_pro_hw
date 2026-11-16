import {
  createOrderQueue,
  createOrderWorker,
  createQueueRedis,
  enqueueOrderPostProcess,
  getRedisConfigValue,
  upsertRatingRecalcScheduler,
} from './redis';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDemoQueue(): Promise<void> {
  const queueRedis = createQueueRedis(false);
  const queueName = `order-post-process-demo-${Date.now()}`;
  const queue = createOrderQueue(queueName);

  let attempts = 0;
  let completed = 0;
  let scheduledRuns = 0;

  // 1. Verify Redis queue instance uses maxmemory-policy=noeviction
  const policy = await getRedisConfigValue(queueRedis, 'maxmemory-policy');
  const queueNoeviction = policy === 'noeviction' ? 1 : 0;

  // 2. Deduplication by jobId: add 2 jobs with the same jobId before worker starts
  const dedupJobId = `order-dedup-${Date.now()}`;
  await enqueueOrderPostProcess(
    queue,
    { orderId: 'ord-1', symbol: 'AAPL', failUntilAttempt: 2 },
    dedupJobId,
  );
  await enqueueOrderPostProcess(
    queue,
    { orderId: 'ord-1', symbol: 'AAPL', failUntilAttempt: 2 },
    dedupJobId,
  );
  const added = 2;

  const counts = await queue.getJobCounts('wait', 'delayed', 'active', 'completed', 'failed');
  const queued = counts.wait + counts.delayed + counts.active + counts.completed + counts.failed;

  // 3. Start worker: failing job retries 3 times (exponential backoff + jitter), scheduler runs >= 2
  const worker = createOrderWorker(async (job) => {
    if (job.name === 'order-post-process') {
      attempts += 1;
      const failUntil = job.data.failUntilAttempt ?? 0;
      if (job.attemptsMade + 1 <= failUntil) {
        throw new Error(`Simulated transient downstream error on attempt ${job.attemptsMade + 1}`);
      }
      completed += 1;
      return;
    }

    if (job.name === 'recalculate-ratings') {
      scheduledRuns += 1;
    }
  }, queueName);

  try {
    // Wait for the retried job to complete
    const retryDeadline = Date.now() + 8000;
    while (completed < 1 && Date.now() < retryDeadline) {
      await sleep(50);
    }

    // 4. Upsert job scheduler (BullMQ 6 upsertJobScheduler API)
    const schedulerId = `rating-recalc-scheduler-${Date.now()}`;
    await upsertRatingRecalcScheduler(queue, 350, schedulerId);

    const schedulers = (await queue.getJobSchedulers()).length;

    const schedDeadline = Date.now() + 6000;
    while (scheduledRuns < 2 && Date.now() < schedDeadline) {
      await sleep(50);
    }

    await queue.removeJobScheduler(schedulerId);

    console.log(`queue-noeviction=${queueNoeviction}`);
    console.log(`attempts=${attempts}`);
    console.log(`completed=${completed}`);
    console.log(`added=${added}`);
    console.log(`queued=${queued}`);
    console.log(`schedulers=${schedulers}`);
    console.log(`scheduled-runs=${scheduledRuns}`);
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await queueRedis.quit();
  }
}

if (require.main === module) {
  runDemoQueue().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
