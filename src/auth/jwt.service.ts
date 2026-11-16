import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { Env } from '../config/env.schema';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface VerifyOptions {
  algorithms: readonly string[];
}

const DEFAULT_VERIFY_OPTIONS: VerifyOptions = {
  algorithms: ['ES256'],
};

function decodeKeyInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('-----BEGIN ')) {
    return trimmed;
  }
  return Buffer.from(trimmed, 'base64').toString('utf8');
}

@Injectable()
export class JwtService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly kid: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessTtlSeconds: number;
  private readonly fingerprint: string;

  constructor(private readonly configService: ConfigService<Env, true>) {
    const privPem = decodeKeyInput(
      this.configService.get('JWT_PRIVATE_KEY', { infer: true }),
    );
    const pubPem = decodeKeyInput(
      this.configService.get('JWT_PUBLIC_KEY', { infer: true }),
    );

    this.privateKey = createPrivateKey(privPem);
    this.publicKey = createPublicKey(pubPem);
    this.kid = this.configService.get('JWT_KID', { infer: true });
    this.issuer = this.configService.get('JWT_ISSUER', { infer: true });
    this.audience = this.configService.get('JWT_AUDIENCE', { infer: true });
    this.accessTtlSeconds = this.configService.get('ACCESS_TOKEN_TTL_SECONDS', {
      infer: true,
    });

    const spkiDer = this.publicKey.export({ type: 'spki', format: 'der' });
    this.fingerprint = createHash('sha256')
      .update(spkiDer)
      .digest('hex')
      .slice(0, 16);
  }

  getKid(): string {
    return this.kid;
  }

  getKeyFingerprint(): string {
    return this.fingerprint;
  }

  getAccessTtlSeconds(): number {
    return this.accessTtlSeconds;
  }

  signAccessToken(claims: { sub: string; email: string; role: string }): {
    token: string;
    jti: string;
    exp: number;
  } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.accessTtlSeconds;
    const jti = randomUUID();

    const header = {
      alg: 'ES256',
      typ: 'JWT',
      kid: this.kid,
    };

    const payload: AccessTokenPayload = {
      sub: claims.sub,
      email: claims.email,
      role: claims.role,
      jti,
      iat: now,
      exp,
      iss: this.issuer,
      aud: this.audience,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${headerB64}.${payloadB64}`;

    const signature = sign('sha256', Buffer.from(signingInput), {
      key: this.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');

    return {
      token: `${signingInput}.${signature}`,
      jti,
      exp,
    };
  }

  verifyAccessToken(
    token: string,
    options: VerifyOptions = DEFAULT_VERIFY_OPTIONS,
  ): AccessTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed JWT');
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) {
      throw new UnauthorizedException('Malformed JWT');
    }

    let header: { alg?: string; typ?: string; kid?: string };
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid JWT header');
    }

    // RFC 8725 §3.1: enforce explicit algorithm allowlist before verification
    if (!header.alg || !options.algorithms.includes(header.alg)) {
      throw new UnauthorizedException('Unsupported JWT algorithm');
    }

    const signingInput = `${headerB64}.${payloadB64}`;
    const signatureBuf = Buffer.from(signatureB64, 'base64url');
    const isValid = verify(
      'sha256',
      Buffer.from(signingInput),
      { key: this.publicKey, dsaEncoding: 'ieee-p1363' },
      signatureBuf,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid JWT signature');
    }

    let payload: AccessTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid JWT payload');
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || now >= payload.exp) {
      throw new UnauthorizedException('Access token expired');
    }
    if (payload.iss !== this.issuer || payload.aud !== this.audience) {
      throw new UnauthorizedException('Invalid token issuer or audience');
    }
    if (!payload.sub || !payload.jti || !payload.role) {
      throw new UnauthorizedException('Missing required token claims');
    }

    return payload;
  }
}
