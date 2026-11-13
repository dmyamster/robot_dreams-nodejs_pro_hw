import {
  assertInvariant,
  cleanupDemoUsers,
  ensureDemoUser,
  startDemoApp,
} from './demo-auth-helper';

async function runDemoReuse(): Promise<void> {
  const email = `demo-reuse-${Date.now()}@broker.test`;
  const password = 'DemoPassword123!';
  const { app, baseUrl, pool } = await startDemoApp();

  try {
    await ensureDemoUser(pool, email, password, 'INVESTOR');

    // 1. Login -> obtain R1
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginStatus = loginRes.status;
    assertInvariant(loginStatus, 200, 'login');
    const loginBody = (await loginRes.json()) as {
      access_token: string;
      refresh_token: string;
    };
    const r1 = loginBody.refresh_token;

    // 2. Legitimate client refreshes R1 -> receives R2
    const r1RefreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: r1 }),
    });
    const r1RefreshStatus = r1RefreshRes.status;
    assertInvariant(r1RefreshStatus, 200, 'r1-refresh');
    const r1RefreshBody = (await r1RefreshRes.json()) as {
      access_token: string;
      refresh_token: string;
    };
    const r2 = r1RefreshBody.refresh_token;

    // 3. Attacker replays already-used R1 -> 401 AND entire family is revoked
    const r1ReuseRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: r1 }),
    });
    const r1ReuseStatus = r1ReuseRes.status;
    assertInvariant(r1ReuseStatus, 401, 'r1-reuse');

    // 4. Legitimate client tries to use R2 -> 401 because the whole family is dead
    const r2AfterReuseRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: r2 }),
    });
    const r2AfterReuseStatus = r2AfterReuseRes.status;
    assertInvariant(r2AfterReuseStatus, 401, 'r2-after-reuse');

    console.log(`login=${loginStatus}`);
    console.log(`r1-refresh=${r1RefreshStatus}`);
    console.log(`r1-reuse=${r1ReuseStatus}`);
    console.log(`r2-after-reuse=${r2AfterReuseStatus}`);
  } finally {
    await cleanupDemoUsers(pool, [email]).catch(() => undefined);
    await app.close();
  }
}

if (require.main === module) {
  runDemoReuse().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
