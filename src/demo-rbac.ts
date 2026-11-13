import { randomUUID } from 'node:crypto';
import {
  assertInvariant,
  cleanupDemoUsers,
  ensureDemoUser,
  startDemoApp,
} from './demo-auth-helper';

async function loginAs(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: status ${res.status}`);
  }
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function forgeTamperedRoleToken(token: string, newRole: string): string {
  const parts = token.split('.');
  const payload = JSON.parse(
    Buffer.from(parts[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  payload.role = newRole;
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return parts.join('.');
}

async function runDemoRbac(): Promise<void> {
  const ts = Date.now();
  const investor1Email = `demo-inv1-${ts}@broker.test`;
  const investor2Email = `demo-inv2-${ts}@broker.test`;
  const adminEmail = `demo-admin-${ts}@broker.test`;
  const password = 'DemoPassword123!';

  const { app, baseUrl, pool } = await startDemoApp();

  try {
    await ensureDemoUser(pool, investor1Email, password, 'INVESTOR');
    await ensureDemoUser(pool, investor2Email, password, 'INVESTOR');
    await ensureDemoUser(pool, adminEmail, password, 'ADMIN');

    const investor1Token = await loginAs(baseUrl, investor1Email, password);
    const investor2Token = await loginAs(baseUrl, investor2Email, password);
    const adminToken = await loginAs(baseUrl, adminEmail, password);

    // 1. Anonymous request to protected resource -> 401
    const anonRes = await fetch(`${baseUrl}/orders`);
    const anonStatus = anonRes.status;
    assertInvariant(anonStatus, 401, 'anon');

    // Create an order as investor1
    const createOrderRes = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${investor1Token}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        symbol: 'AAPL',
        side: 'BUY',
        type: 'MARKET',
        quantity: 2,
      }),
    });
    assertInvariant(createOrderRes.status, 201, 'create-order');
    const createdOrder = (await createOrderRes.json()) as { id: string };

    // 2. Owner reads own order -> 200
    const ownRes = await fetch(`${baseUrl}/orders/${createdOrder.id}`, {
      headers: { authorization: `Bearer ${investor1Token}` },
    });
    const ownStatus = ownRes.status;
    assertInvariant(ownStatus, 200, 'own');

    // 3. Another investor reads investor1's order -> 403 (ownership check in service)
    const foreignRes = await fetch(`${baseUrl}/orders/${createdOrder.id}`, {
      headers: { authorization: `Bearer ${investor2Token}` },
    });
    const foreignStatus = foreignRes.status;
    assertInvariant(foreignStatus, 403, 'foreign');

    const suffix = String.fromCharCode(65 + (ts % 26));
    const newSymbol = `DEMO${suffix}`;
    const instrumentPayload = {
      symbol: newSymbol,
      company_name: 'Demo Corp',
      current_price_cents: 15000,
      sector: 'Technology',
      trading_status: 'ACTIVE',
    };

    // 4. Investor tries to create instrument (privileged role required) -> 403
    const roleDeniedRes = await fetch(`${baseUrl}/instruments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${investor1Token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(instrumentPayload),
    });
    const roleDeniedStatus = roleDeniedRes.status;
    assertInvariant(roleDeniedStatus, 403, 'role-denied');

    // 5. Admin creates instrument -> 201
    const roleAllowedRes = await fetch(`${baseUrl}/instruments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(instrumentPayload),
    });
    const roleAllowedStatus = roleAllowedRes.status;
    assertInvariant(roleAllowedStatus, [200, 201], 'role-allowed');

    // 6. Tampered token (payload role changed to ADMIN, original signature kept) -> 401
    const forgedToken = forgeTamperedRoleToken(investor1Token, 'ADMIN');
    const tamperedRes = await fetch(`${baseUrl}/instruments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${forgedToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...instrumentPayload, symbol: `XEMO${suffix}` }),
    });
    const tamperedStatus = tamperedRes.status;
    assertInvariant(tamperedStatus, 401, 'tampered');

    console.log(`anon=${anonStatus}`);
    console.log(`own=${ownStatus}`);
    console.log(`foreign=${foreignStatus}`);
    console.log(`role-denied=${roleDeniedStatus}`);
    console.log(`role-allowed=${roleAllowedStatus}`);
    console.log(`tampered=${tamperedStatus}`);
  } finally {
    await cleanupDemoUsers(pool, [
      investor1Email,
      investor2Email,
      adminEmail,
    ]).catch(() => undefined);
    await app.close();
  }
}

if (require.main === module) {
  runDemoRbac().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
