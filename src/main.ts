import './observability/tracing';
import { ConfigService } from '@nestjs/config';
import { createNestApp } from './app.factory';
import { Env } from './config/env.schema';
import { setReady } from './health/health.state';
import { logger } from './observability/logger';
import { shutdownTracing } from './observability/tracing';

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
      logger.info({ warmupMs }, 'Warming up before listening');
      await sleep(warmupMs);
    }

    await app.listen(port);
    setReady(true);
    logger.info({ port }, 'Paper Trading Broker API (NestJS) listening');

    let shuttingDown = false;
    const handleShutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal, drainDelayMs }, 'Shutting down: marking /readyz not-ready');
      // 1. Fail readiness probe first so kube-proxy stops sending new traffic
      setReady(false);
      // 2. Wait for EndpointSlice propagation & in-flight requests
      if (drainDelayMs > 0) {
        await sleep(drainDelayMs);
      }
      // 3. Close HTTP server and database pool, then flush OTel spans
      await app.close();
      await shutdownTracing();
      process.exit(0);
    };

    process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
    process.on('SIGINT', () => void handleShutdown('SIGINT'));
  } catch (err: any) {
    logger.error({ err }, err.message || 'Bootstrap failed');
    process.exit(1);
  }
}

bootstrap();
