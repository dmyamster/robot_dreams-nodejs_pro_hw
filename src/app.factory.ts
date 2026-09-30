import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';
import * as OpenApiValidator from 'express-openapi-validator';
import * as express from 'express';
import * as path from 'node:path';

export async function createNestApp() {
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    logger: ['error', 'warn'],
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
