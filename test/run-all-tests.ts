import { spawn } from 'node:child_process';

async function main(): Promise<void> {
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

  const test = spawn('node', ['--no-warnings', '--experimental-strip-types', 'test/contract.test.ts'], {
    env: { ...process.env, PORT: String(port) },
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
