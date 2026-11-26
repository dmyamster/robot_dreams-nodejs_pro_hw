import { createPrivateKey, randomBytes, randomUUID, sign } from 'node:crypto';

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeKeyInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('-----BEGIN ')) {
    return trimmed;
  }
  return Buffer.from(trimmed, 'base64').toString('utf8');
}

export function signDemoAdminToken(): string {
  const pem = decodeKeyInput(process.env.JWT_PRIVATE_KEY || '');
  const privateKey = createPrivateKey(pem);
  const now = Math.floor(Date.now() / 1000);

  const header = base64Url(
    JSON.stringify({
      alg: 'ES256',
      typ: 'JWT',
      kid: process.env.JWT_KID || 'dev-1',
    }),
  );
  const payload = base64Url(
    JSON.stringify({
      sub: '00000000-0000-0000-0000-000000000001',
      email: 'demo-admin@example.com',
      role: 'ADMIN',
      jti: randomUUID(),
      iat: now,
      exp: now + 300,
      iss: process.env.JWT_ISSUER || 'paper-trading-broker-api',
      aud: process.env.JWT_AUDIENCE || 'paper-trading-clients',
    }),
  );

  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${base64Url(signature)}`;
}

export function makeTraceparent(): {
  traceId: string;
  parentId: string;
  header: string;
} {
  const traceId = randomBytes(16).toString('hex');
  const parentId = randomBytes(8).toString('hex');
  return { traceId, parentId, header: `00-${traceId}-${parentId}-01` };
}

export async function waitForHealth(baseUrl: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server did not become healthy in time');
}
