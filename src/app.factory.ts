import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';
import * as OpenApiValidator from 'express-openapi-validator';
import * as express from 'express';
import * as path from 'node:path';

export async function createNestApp() {
  const app = await NestFactory.create(AppModule, { logger: false });

  app.setGlobalPrefix('api/v1');

  app.use(express.json());

  const apiSpecPath = path.resolve(process.cwd(), 'openapi/openapi.yaml');
  app.use(
    OpenApiValidator.middleware({
      apiSpec: apiSpecPath,
      validateRequests: true,
      validateResponses: true,
    }),
  );

  app.useGlobalFilters(new ProblemExceptionFilter());

  return app;
}
