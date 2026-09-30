import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';
import * as OpenApiValidator from 'express-openapi-validator';
import * as express from 'express';
import * as path from 'node:path';

export function configureApp(app: INestApplication): INestApplication {
  // Allow requests to /orders and /instruments without /api/v1 prefix (e.g. for contract test verification)
  app.use((req: any, _res: any, next: any) => {
    if (
      typeof req.url === 'string' &&
      !req.url.startsWith('/api/v1') &&
      !req.url.startsWith('/health') &&
      (req.url.startsWith('/orders') || req.url.startsWith('/instruments'))
    ) {
      const rewritten = '/api/v1' + req.url;
      req.url = rewritten;
      req.originalUrl = rewritten;
    }
    next();
  });

  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'api/v1/health'],
  });

  app.use(express.json());

  const apiSpecPath = path.resolve(process.cwd(), 'openapi/openapi.yaml');
  app.use(
    OpenApiValidator.middleware({
      apiSpec: apiSpecPath,
      validateRequests: true,
      validateResponses: true,
      ignorePaths: (reqPath: string) => reqPath.includes('health'),
    }),
  );

  app.useGlobalFilters(new ProblemExceptionFilter());

  return app;
}

export async function createNestApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    logger: ['error', 'warn'],
  });

  return configureApp(app);
}
