import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = val;
    }
  }
  return args;
}

function base64UrlToBuffer(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function decodeJwtPart(str) {
  return JSON.parse(base64UrlToBuffer(str).toString('utf8'));
}

function algToHashAndDsa(alg) {
  switch (alg) {
    case 'RS256':
      return { hash: 'RSA-SHA256', dsa: undefined };
    case 'RS384':
      return { hash: 'RSA-SHA384', dsa: undefined };
    case 'RS512':
      return { hash: 'RSA-SHA512', dsa: undefined };
    case 'ES256':
      return { hash: 'SHA256', dsa: 'ieee-p1363' };
    case 'ES384':
      return { hash: 'SHA384', dsa: 'ieee-p1363' };
    case 'ES512':
      return { hash: 'SHA512', dsa: 'ieee-p1363' };
    default:
      return null;
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.json();
}

async function loadJwks({ jwksFile, jwksUrl, openidConfigUrl, iss }) {
  if (jwksFile) {
    return JSON.parse(fs.readFileSync(jwksFile, 'utf8'));
  }
  let resolvedJwksUrl = jwksUrl;
  if (!resolvedJwksUrl) {
    const configUrl = openidConfigUrl || `${iss.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const oidcConfig = await fetchJson(configUrl);
    if (!oidcConfig.jwks_uri) {
      throw new Error(`No jwks_uri in ${configUrl}`);
    }
    resolvedJwksUrl = oidcConfig.jwks_uri;
  }
  return fetchJson(resolvedJwksUrl);
}

function matchSub(sub, policy) {
  if (typeof sub !== 'string' || sub.length === 0) return false;
  if (Array.isArray(policy.allowed_subs) && policy.allowed_subs.includes(sub)) {
    return true;
  }
  if (Array.isArray(policy.allowed_sub_patterns)) {
    for (const pat of policy.allowed_sub_patterns) {
      if (new RegExp(pat).test(sub)) return true;
    }
  }
  return false;
}

function matchAud(tokenAud, expectedAud) {
  if (!expectedAud) return true;
  if (typeof tokenAud === 'string') return tokenAud === expectedAud;
  if (Array.isArray(tokenAud)) return tokenAud.includes(expectedAud);
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policyPath = path.resolve(args.policy || process.env.OIDC_POLICY || 'oidc/policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

  const token = args.token || process.env.OIDC_TOKEN || '';
  const expectedIss = args.iss || process.env.OIDC_ISS || policy.iss;
  const expectedAud = args.aud || process.env.OIDC_AUD || policy.aud;

  const parts = token.split('.');
  if (parts.length !== 3) {
    console.log('oidc-iss=');
    console.log('oidc-aud=');
    console.log('oidc-sub=');
    console.log('sig-verified=0');
    console.log('policy-allow=0');
    process.exit(1);
  }

  let header;
  let payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    console.log('oidc-iss=');
    console.log('oidc-aud=');
    console.log('oidc-sub=');
    console.log('sig-verified=0');
    console.log('policy-allow=0');
    process.exit(1);
  }

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  const aud = Array.isArray(payload.aud) ? payload.aud.join(',') : (payload.aud || '');
  const sub = typeof payload.sub === 'string' ? payload.sub : '';

  let sigVerified = 0;
  try {
    const jwks = await loadJwks({
      jwksFile: args['jwks-file'] || process.env.OIDC_JWKS_FILE,
      jwksUrl: args['jwks-url'] || process.env.OIDC_JWKS_URL,
      openidConfigUrl: args['openid-config-url'] || process.env.OIDC_OPENID_CONFIG_URL,
      iss: expectedIss,
    });

    const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
    const jwk = keys.find((k) => (!header.kid || k.kid === header.kid) && (!k.use || k.use === 'sig'));
    const algInfo = algToHashAndDsa(header.alg);

    if (jwk && algInfo) {
      const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
      const signature = base64UrlToBuffer(parts[2]);
      const valid = crypto.verify(
        algInfo.hash,
        signingInput,
        algInfo.dsa ? { key: publicKey, dsaEncoding: algInfo.dsa } : publicKey,
        signature,
      );
      if (valid) {
        sigVerified = 1;
      }
    }
  } catch (err) {
    console.error(`JWKS/signature verification error: ${err.message}`);
    sigVerified = 0;
  }

  const now = Math.floor(Date.now() / 1000);
  const notExpired = typeof payload.exp === 'number' && payload.exp + 60 >= now;
  const notBeforeOk = typeof payload.nbf !== 'number' || payload.nbf - 60 <= now;
  const issOk = iss === expectedIss;
  const audOk = matchAud(payload.aud, expectedAud);
  const subOk = matchSub(sub, policy);

  const policyAllow = sigVerified === 1 && notExpired && notBeforeOk && issOk && audOk && subOk ? 1 : 0;

  console.log(`oidc-iss=${iss}`);
  console.log(`oidc-aud=${aud}`);
  console.log(`oidc-sub=${sub}`);
  console.log(`sig-verified=${sigVerified}`);
  console.log(`policy-allow=${policyAllow}`);

  process.exit(sigVerified === 1 && policyAllow === 1 ? 0 : 1);
}

main();
