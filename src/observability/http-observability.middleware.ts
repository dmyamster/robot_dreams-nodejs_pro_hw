import { NextFunction, Request, Response } from 'express';
import { createLayerLogger } from './logger';
import { httpRequestDurationSeconds, httpRequestsTotal } from './metrics';
import {
  bindAsyncContext,
  RequestContextStore,
  runWithRequestContext,
} from './request-context';

const httpLogger = createLayerLogger('http.middleware');

function resolveRouteLabel(req: Request): string {
  if (req.route && typeof req.route.path === 'string') {
    const base = req.baseUrl || '';
    return `${base}${req.route.path}`;
  }
  return 'UNMATCHED';
}

export function httpObservabilityMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const path = req.path || req.url;
  if (path === '/metrics' || path === '/healthz' || path === '/readyz') {
    next();
    return;
  }

  const tenantHeader = req.headers['x-tenant-id'];
  const idempotencyHeader = req.headers['idempotency-key'];

  const store: RequestContextStore = {
    tenant:
      typeof tenantHeader === 'string' && tenantHeader.length > 0
        ? tenantHeader
        : 'default',
    idempotencyKey:
      typeof idempotencyHeader === 'string' && idempotencyHeader.length > 0
        ? idempotencyHeader
        : undefined,
  };

  const startNs = process.hrtime.bigint();

  runWithRequestContext(store, () => {
    httpLogger.info(
      {
        req: {
          method: req.method,
          url: req.originalUrl || req.url,
          headers: {
            authorization: req.headers.authorization,
          },
          body: req.body,
        },
      },
      'incoming request',
    );

    res.on(
      'finish',
      bindAsyncContext(() => {
        const durationSeconds =
          Number(process.hrtime.bigint() - startNs) / 1e9;
        const route = resolveRouteLabel(req);
        const status = String(res.statusCode);
        const method = req.method;

        httpRequestsTotal.inc({ method, route, status });
        httpRequestDurationSeconds.observe({ method, route, status }, durationSeconds);

        httpLogger.info(
          {
            method,
            route,
            statusCode: res.statusCode,
            durationMs: Math.round(durationSeconds * 1000 * 100) / 100,
          },
          'request completed',
        );
      }),
    );

    next();
  });
}
