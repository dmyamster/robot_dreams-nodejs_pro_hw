import { generateKeyPairSync } from 'node:crypto';

if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.JWT_PRIVATE_KEY = Buffer.from(privateKey).toString('base64');
  process.env.JWT_PUBLIC_KEY = Buffer.from(publicKey).toString('base64');
}
if (!process.env.REFRESH_TOKEN_PEPPER) {
  process.env.REFRESH_TOKEN_PEPPER = 'test-pepper-at-least-32-bytes-long-1234';
}
if (!process.env.JWT_KID) {
  process.env.JWT_KID = 'test-1';
}
