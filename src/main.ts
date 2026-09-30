import { ConfigService } from '@nestjs/config';
import { createNestApp } from './app.factory';
import { Env } from './config/env.schema';

async function bootstrap() {
  try {
    const app = await createNestApp();
    const configService = app.get<ConfigService<Env, true>>(ConfigService);
    const port = configService.get('PORT', { infer: true });
    await app.listen(port);
    console.log(`🚀 Paper Trading Broker API (NestJS) running on http://localhost:${port}/api/v1`);
  } catch (err: any) {
    console.error(err.message || err);
    process.exit(1);
  }
}

bootstrap();
