import {
  assertInvariant,
  cleanupDemoUsers,
  ensureDemoUser,
  startDemoApp,
} from './demo-auth-helper';

async function runDemoAuth(): Promise<void> {
  const email = `demo-auth-${Date.now()}@broker.test`;
  const password = 'DemoPassword123!';
  const { app, baseUrl, pool } = await startDemoApp();

  try {
    await ensureDemoUser(pool, email, password, 'INVESTOR');

    // 1. Login -> 200
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

    // 2. Access protected route without token -> 401
    const noTokenRes = await fetch(`${baseUrl}/orders`);
    const noTokenStatus = noTokenRes.status;
    assertInvariant(noTokenStatus, 401, 'no-token');

    // 3. Access protected route with token -> 200
    const withTokenRes = await fetch(`${baseUrl}/orders`, {
      headers: { authorization: `Bearer ${loginBody.access_token}` },
    });
    const withTokenStatus = withTokenRes.status;
    assertInvariant(withTokenStatus, 200, 'with-token');

    // 4. Refresh -> 200 (rotates refresh token, issues new access token)
    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: loginBody.refresh_token }),
    });
    const refreshStatus = refreshRes.status;
    assertInvariant(refreshStatus, 200, 'refresh');
    const refreshBody = (await refreshRes.json()) as {
      access_token: string;
      refresh_token: string;
    };

    // 5. Logout -> 200 or 204 (revokes refresh family + adds access jti to Redis denylist)
    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${refreshBody.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshBody.refresh_token }),
    });
    const logoutStatus = logoutRes.status;
    assertInvariant(logoutStatus, [200, 204], 'logout');

    // 6. Use same access token after logout -> 401 (denylist proof)
    const afterLogoutRes = await fetch(`${baseUrl}/orders`, {
      headers: { authorization: `Bearer ${refreshBody.access_token}` },
    });
    const afterLogoutStatus = afterLogoutRes.status;
    assertInvariant(afterLogoutStatus, 401, 'after-logout');

    // 7. Use refresh token after logout -> 401
    const refreshAfterLogoutRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshBody.refresh_token }),
    });
    const refreshAfterLogoutStatus = refreshAfterLogoutRes.status;
    assertInvariant(refreshAfterLogoutStatus, 401, 'refresh-after-logout');

    console.log(`login=${loginStatus}`);
    console.log(`no-token=${noTokenStatus}`);
    console.log(`with-token=${withTokenStatus}`);
    console.log(`refresh=${refreshStatus}`);
    console.log(`logout=${logoutStatus}`);
    console.log(`after-logout=${afterLogoutStatus}`);
    console.log(`refresh-after-logout=${refreshAfterLogoutStatus}`);
  } finally {
    await cleanupDemoUsers(pool, [email]).catch(() => undefined);
    await app.close();
  }
}

if (require.main === module) {
  runDemoAuth().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
