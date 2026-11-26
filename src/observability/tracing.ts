import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { trace } from '@opentelemetry/api';

let sdk: NodeSDK | null = null;

function resolveOtlpTracesUrl(): string {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:22918';
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

export function initTracing(): NodeSDK {
  if (sdk) {
    return sdk;
  }

  const exporter = new OTLPTraceExporter({
    url: resolveOtlpTracesUrl(),
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]:
        process.env.OTEL_SERVICE_NAME || 'paper-trading-broker-api',
    }),
    traceExporter: exporter,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url || '';
          return (
            url === '/metrics' ||
            url === '/healthz' ||
            url === '/readyz' ||
            url === '/health' ||
            url === '/api/v1/health'
          );
        },
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
    ],
  });

  sdk.start();
  return sdk;
}

export async function forceFlushTracing(): Promise<void> {
  const provider = trace.getTracerProvider() as {
    forceFlush?: () => Promise<void>;
    getDelegate?: () => { forceFlush?: () => Promise<void> };
  };
  if (typeof provider.forceFlush === 'function') {
    await provider.forceFlush();
    return;
  }
  const delegate = provider.getDelegate?.();
  if (delegate && typeof delegate.forceFlush === 'function') {
    await delegate.forceFlush();
  }
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

// Initialize immediately on import so OTel patches http/express/pg before app modules load.
initTracing();
