import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const POLICY_PATH = path.join(ROOT, 'oidc', 'policy.json');
const GATE_SCRIPT = path.join(ROOT, 'scripts', 'oidc-gate.mjs');

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload, privateKey, kid = 'demo-key-1') {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const h = toBase64Url(JSON.stringify(header));
  const p = toBase64Url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), privateKey);
  return `${signingInput}.${toBase64Url(sig)}`;
}

function corruptSignature(jwt) {
  const parts = jwt.split('.');
  const sigBuf = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  sigBuf[0] = sigBuf[0] ^ 0xff;
  sigBuf[1] = sigBuf[1] ^ 0xff;
  parts[2] = toBase64Url(sigBuf);
  return parts.join('.');
}

function runGate(token, openidConfigUrl, iss, aud) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        GATE_SCRIPT,
        '--policy',
        POLICY_PATH,
        '--openid-config-url',
        openidConfigUrl,
        '--iss',
        iss,
        '--aud',
        aud,
      ],
      {
        cwd: ROOT,
        env: { ...process.env, OIDC_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('close', (code) => {
      const sigVerified = out.match(/^sig-verified=(\d+)/m)?.[1] ?? '0';
      const policyAllow = out.match(/^policy-allow=(\d+)/m)?.[1] ?? '0';
      resolve({
        exitCode: code ?? 1,
        sigVerified,
        policyAllow,
      });
    });
  });
}

async function main() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' });
  publicJwk.kid = 'demo-key-1';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  let port = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') {
      res.end(
        JSON.stringify({
          issuer: policy.iss,
          jwks_uri: `http://127.0.0.1:${port}/.well-known/jwks.json`,
        }),
      );
      return;
    }
    if (req.url === '/.well-known/jwks.json') {
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const openidConfigUrl = `http://127.0.0.1:${port}/.well-known/openid-configuration`;

  try {
    const now = Math.floor(Date.now() / 1000);
    const allowedSub = policy.allowed_subs[0];

    const greenToken = signJwt(
      { iss: policy.iss, aud: policy.aud, sub: allowedSub, iat: now, exp: now + 300 },
      privateKey,
    );
    const foreignSubToken = signJwt(
      {
        iss: policy.iss,
        aud: policy.aud,
        sub: 'repo:attacker/evil-repo:ref:refs/heads/main',
        iat: now,
        exp: now + 300,
      },
      privateKey,
    );
    const badSigToken = corruptSignature(greenToken);

    const cases = [
      { name: 'green', token: greenToken, expectSig: '1', expectAllow: '1', expectExitZero: true },
      { name: 'foreign-sub', token: foreignSubToken, expectSig: '1', expectAllow: '0', expectExitZero: false },
      { name: 'bad-signature', token: badSigToken, expectSig: '0', expectAllow: '0', expectExitZero: false },
    ];

    let ok = true;
    for (const c of cases) {
      const result = await runGate(c.token, openidConfigUrl, policy.iss, policy.aud);
      console.log(`case=${c.name}`);
      console.log(`sig-verified=${result.sigVerified}`);
      console.log(`policy-allow=${result.policyAllow}`);
      const exitMatch = c.expectExitZero ? result.exitCode === 0 : result.exitCode !== 0;
      if (result.sigVerified !== c.expectSig || result.policyAllow !== c.expectAllow || !exitMatch) {
        ok = false;
      }
    }

    process.exit(ok ? 0 : 1);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

main();
