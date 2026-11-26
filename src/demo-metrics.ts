import './observability/tracing';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { createNestApp } from './app.factory';
import { shutdownTracing } from './observability/tracing';
import { HTTP_DURATION_BUCKETS } from './observability/metrics';
import { SIMULATED_500_ORDER_ID } from './orders/orders.repository';
import { signDemoAdminToken } from './observability/demo-helpers';

interface ParsedMetrics {
  seriesCount: number;
  totalRequests: number;
  errorRequests: number;
  routeCount: number;
  routeTopBucket: number;
}

function parsePrometheusMetrics(text: string, targetRoute: string, topBucket: string): ParsedMetrics {
  const lines = text.split('\n');
  let seriesCount = 0;
  let totalRequests = 0;
  let errorRequests = 0;
  let routeCount = 0;
  let routeTopBucket = 0;

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('http_requests_total{')) {
      seriesCount++;
      const val = Number(line.split(' ').pop());
      if (Number.isFinite(val)) {
        totalRequests += val;
        if (/status="5\d\d"/.test(line)) {
          errorRequests += val;
        }
      }
    }

    if (
      line.startsWith('http_request_duration_seconds_count{') &&
      line.includes(`route="${targetRoute}"`)
    ) {
      const val = Number(line.split(' ').pop());
      if (Number.isFinite(val)) routeCount += val;
    }

    if (
      line.startsWith('http_request_duration_seconds_bucket{') &&
      line.includes(`route="${targetRoute}"`) &&
      line.includes(`le="${topBucket}"`)
    ) {
      const val = Number(line.split(' ').pop());
      if (Number.isFinite(val)) routeTopBucket += val;
    }
  }

  return { seriesCount, totalRequests, errorRequests, routeCount, routeTopBucket };
}

async function main(): Promise<void> {
  // Suppress app stdout JSON logs during metrics demo? No, keep stdout clean or allow extra lines.
  const app = await createNestApp();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const targetRoute = '/api/v1/orders/:id';
  const topFiniteBucket = String(
    HTTP_DURATION_BUCKETS[HTTP_DURATION_BUCKETS.length - 1],
  );

  try {
    // Check Prometheus reachability if PROMETHEUS_URL is configured
    const promUrl = process.env.PROMETHEUS_URL;
    if (promUrl) {
      const promHealth = await fetch(`${promUrl.replace(/\/+$/, '')}/-/healthy`);
      if (!promHealth.ok) {
        throw new Error(`Prometheus unhealthy: ${promHealth.status}`);
      }
    }

    const token = signDemoAdminToken();
    const authHeaders = { authorization: `Bearer ${token}` };

    // Warmup route for 200, 404, and 500 before measuring series-before
    await fetch(`${baseUrl}/api/v1/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`, {
      headers: authHeaders,
    });
    await fetch(`${baseUrl}/api/v1/orders/${randomUUID()}`, {
      headers: authHeaders,
    });
    await fetch(`${baseUrl}/api/v1/orders/${SIMULATED_500_ORDER_ID}`, {
      headers: authHeaders,
    });

    const scrape1Text = await (await fetch(`${baseUrl}/metrics`)).text();
    const before = parsePrometheusMetrics(scrape1Text, targetRoute, topFiniteBucket);

    let sentOk = 0;
    let sentFail = 0;

    // 45 valid 200 requests (including 1 slow 1100ms request to verify bucket coverage)
    for (let i = 0; i < 45; i++) {
      const headers: Record<string, string> = { ...authHeaders };
      if (i === 0) headers['x-demo-delay-ms'] = '1100';
      const res = await fetch(
        `${baseUrl}/api/v1/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`,
        { headers },
      );
      if (res.status >= 500) sentFail++;
      else sentOk++;
    }

    // 100 requests with 100 distinct UUIDs to prove bounded cardinality
    for (let i = 0; i < 100; i++) {
      const res = await fetch(`${baseUrl}/api/v1/orders/${randomUUID()}`, {
        headers: authHeaders,
      });
      if (res.status >= 500) sentFail++;
      else sentOk++;
    }

    // 10 simulated 500 requests
    for (let i = 0; i < 10; i++) {
      const res = await fetch(
        `${baseUrl}/api/v1/orders/${SIMULATED_500_ORDER_ID}`,
        { headers: authHeaders },
      );
      if (res.status >= 500) sentFail++;
      else sentOk++;
    }

    const scrape2Text = await (await fetch(`${baseUrl}/metrics`)).text();
    const after = parsePrometheusMetrics(scrape2Text, targetRoute, topFiniteBucket);

    const counterDelta = after.totalRequests - before.totalRequests;
    const errorsDelta = after.errorRequests - before.errorRequests;
    const aboveTopBucket = after.routeCount - after.routeTopBucket;

    console.log(`sent-ok=${sentOk}`);
    console.log(`sent-fail=${sentFail}`);
    console.log(`counter-delta=${counterDelta}`);
    console.log(`errors-delta=${errorsDelta}`);
    console.log(`above-top-bucket=${aboveTopBucket}`);
    console.log(`series-before=${before.seriesCount}`);
    console.log(`series-after=${after.seriesCount}`);

    const ok =
      sentOk + sentFail >= 50 &&
      counterDelta === sentOk + sentFail &&
      errorsDelta === sentFail &&
      aboveTopBucket === 0 &&
      after.seriesCount === before.seriesCount;

    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
    await shutdownTracing();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
