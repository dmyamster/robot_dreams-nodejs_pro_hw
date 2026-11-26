import pino, { Logger, LoggerOptions } from 'pino';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import { getRequestContext } from './request-context';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'password',
  '*.password',
  'req.body.password',
  'body.password',
  'refresh_token',
  '*.refresh_token',
  'req.body.refresh_token',
  'body.refresh_token',
  'access_token',
  '*.access_token',
  'token',
  'secret',
];

const options: LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: process.env.OTEL_SERVICE_NAME || 'paper-trading-broker-api',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  mixin() {
    const fields: Record<string, unknown> = {};
    const span = trace.getActiveSpan();
    const spanCtx = span?.spanContext();
    if (spanCtx && isSpanContextValid(spanCtx)) {
      fields.trace_id = spanCtx.traceId;
      fields.span_id = spanCtx.spanId;
    }

    const ctx = getRequestContext();
    if (ctx) {
      if (ctx.userId) fields.userId = ctx.userId;
      if (ctx.tenant) fields.tenant = ctx.tenant;
      if (ctx.idempotencyKey) fields.idempotencyKey = ctx.idempotencyKey;
    }
    return fields;
  },
};

export const logger: Logger = pino(options);

export function createLayerLogger(layer: string): Logger {
  return logger.child({ layer });
}
