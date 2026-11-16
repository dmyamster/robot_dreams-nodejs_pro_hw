import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';

function ensureTestAuthEnv(): void {
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
  if (!process.env.STORAGE_ACCESS_KEY) {
    process.env.STORAGE_ACCESS_KEY = 'test-access-key';
  }
  if (!process.env.STORAGE_SECRET_KEY) {
    process.env.STORAGE_SECRET_KEY = 'test-secret-key';
  }
}

async function main(): Promise<void> {
  ensureTestAuthEnv();
  console.log('📦 Збірка проєкту (nest build)...');
  const build = spawn('npx', ['nest', 'build'], { stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    build.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Build failed'))));
  });

  // Імпортуємо скомпільований NestJS додаток напряму з dist
  const distPath = '../dist/src/app.factory.js';
  const { createNestApp } = await import(distPath);
  const app = await createNestApp();
  await app.listen(0);

  const server = app.getHttpServer();
  const address = server.address();
  const port = typeof address === 'string' ? 3000 : address.port;

  console.log(`🚀 NestJS додаток піднято на порті ${port} для тестів...`);

  const jwtDistPath = '../dist/src/auth/jwt.service.js';
  const { JwtService } = await import(jwtDistPath);
  const jwtService = app.get(JwtService);
  const { token } = jwtService.signAccessToken({
    sub: 'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    email: 'contract-test@broker.test',
    role: 'ADMIN',
  });

  const test = spawn('node', ['--no-warnings', '--experimental-strip-types', 'test/contract.test.ts'], {
    env: { ...process.env, PORT: String(port), TEST_AUTH_TOKEN: token },
    stdio: 'inherit',
  });

  test.on('close', async (code) => {
    await app.close();
    process.exit(code ?? 0);
  });
}

main().catch((err: Error) => {
  console.error(err);
  process.exit(1);
});
