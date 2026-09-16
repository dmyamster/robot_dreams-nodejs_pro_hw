import { createNestApp } from './app.factory';

async function bootstrap() {
  const app = await createNestApp();
  const PORT = process.env.PORT || 3000;
  await app.listen(PORT);
  console.log(`🚀 Paper Trading Broker API (NestJS) running on http://localhost:${PORT}/api/v1`);
}

bootstrap();
