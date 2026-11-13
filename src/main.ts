import { ConfigService } from '@nestjs/config';
import { createNestApp } from './app.factory';
import { Env } from './config/env.schema';
import { setReady } from './health/health.state';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootstrap() {
  try {
    const app = await createNestApp();
    const configService = app.get<ConfigService<Env, true>>(ConfigService);
    const port = configService.get('PORT', { infer: true });
    const warmupMs = configService.get('STARTUP_WARMUP_MS', { infer: true });
    const drainDelayMs = configService.get('DRAIN_DELAY_MS', { infer: true });

    if (warmupMs > 0) {
      console.log(`Warming up for ${warmupMs}ms before listening...`);
      await sleep(warmupMs);
    }

    await app.listen(port);
    setReady(true);
    console.log(`🚀 Paper Trading Broker API (NestJS) running on http://localhost:${port}/api/v1`);

    let shuttingDown = false;
    const handleShutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`Received ${signal}: marking /readyz not-ready and draining for ${drainDelayMs}ms...`);
      // 1. Fail readiness probe first so kube-proxy stops sending new traffic
      setReady(false);
      // 2. Wait for EndpointSlice propagation & in-flight requests
      if (drainDelayMs > 0) {
        await sleep(drainDelayMs);
      }
      // 3. Close HTTP server and database pool
      await app.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
    process.on('SIGINT', () => void handleShutdown('SIGINT'));
  } catch (err: any) {
    console.error(err.message || err);
    process.exit(1);
  }
}

bootstrap();
