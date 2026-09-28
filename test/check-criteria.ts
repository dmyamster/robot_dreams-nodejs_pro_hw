import * as fs from 'node:fs';
import * as path from 'node:path';

const specPath = path.resolve(process.cwd(), 'spec.json');
const s = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const M = ['get', 'post', 'put', 'patch', 'delete'];
const ops = Object.entries(s.paths).flatMap(([p, v]: [string, any]) =>
  Object.keys(v)
    .filter((m) => M.includes(m))
    .map((m) => [p, m]),
);

const idem = ops
  .flatMap(([p, m]: string[]) => s.paths[p][m].parameters ?? [])
  .find((x: any) => x.in === 'header' && /idempotency-key/i.test(x.name));

const resourcesCount = new Set(Object.keys(s.paths).map((p) => p.split('/')[1])).size;
const descLength = (idem?.description ?? '').trim().length;

console.log('операцій:', ops.length, '· ресурсів:', resourcesCount);
console.log('Idempotency-Key: required =', idem?.required, '· опис, символів =', descLength);

if (ops.length < 5) {
  console.error('ПОМИЛКА: Кількість операцій менша за 5!');
  process.exit(1);
}
if (resourcesCount < 2) {
  console.error('ПОМИЛКА: Кількість ресурсів менша за 2!');
  process.exit(1);
}
if (idem?.required !== true) {
  console.error('ПОМИЛКА: Idempotency-Key має бути required: true!');
  process.exit(1);
}
if (descLength < 40) {
  console.error('ПОМИЛКА: Опис Idempotency-Key має бути ≥ 40 символів!');
  process.exit(1);
}

console.log('✅ Усі критерії структури спеки успішно виконано!');
