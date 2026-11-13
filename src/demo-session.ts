import { SessionService, createQueueRedis } from './redis';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDemoSession(): Promise<void> {
  // Sessions MUST live on the noeviction Redis instance, never on the allkeys-lru cache instance
  const redis1 = createQueueRedis(false);
  const ttlSeconds = 30;
  const sessionService1 = new SessionService(redis1, ttlSeconds);

  const observedSessionIds = new Set<string>();
  let requests = 0;

  // Request 1: create session
  const created = await sessionService1.createSession('user-demo-1', 'INVESTOR');
  observedSessionIds.add(created.sessionId);
  requests += 1;

  // Wait > 2s so TTL actually ticks down before renewal
  await sleep(2200);
  const ttlBeforeActivity = await sessionService1.getSessionTtl(created.sessionId);

  // Simulate process restart by closing first Redis client and opening a fresh one
  await redis1.quit();

  const redis2 = createQueueRedis(false);
  const sessionService2 = new SessionService(redis2, ttlSeconds);

  try {
    // Requests 2..4: read session on new process instance -> rolling TTL extends via GETEX
    for (let i = 0; i < 3; i += 1) {
      const session = await sessionService2.getSession(created.sessionId);
      if (session) {
        observedSessionIds.add(session.sessionId);
      }
      requests += 1;
    }

    const inRedis = (await sessionService2.existsInRedis(created.sessionId)) ? 1 : 0;
    const ttlAfterActivity = await sessionService2.getSessionTtl(created.sessionId);
    const ttlRenewed = ttlAfterActivity > ttlBeforeActivity ? 1 : 0;

    // Self-clean
    await sessionService2.deleteSession(created.sessionId);

    console.log(`requests=${requests}`);
    console.log(`sessions=${observedSessionIds.size}`);
    console.log(`in-redis=${inRedis}`);
    console.log(`ttl-renewed=${ttlRenewed}`);
  } finally {
    await redis2.quit();
  }
}

if (require.main === module) {
  runDemoSession().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
