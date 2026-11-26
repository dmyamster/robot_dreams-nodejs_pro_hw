import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function runCmd(cmd, args, extraEnv = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  return res.status ?? 1;
}

function runShell(command, extraEnv = {}) {
  const res = spawnSync('bash', ['-c', command], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  return res.status ?? 1;
}

function hasCommand(cmd) {
  const res = spawnSync('which', [cmd], { encoding: 'utf8' });
  return res.status === 0;
}

function testTypesLint() {
  const ok = runShell('npx tsc --noEmit && npx eslint src');
  const tmpFile = path.join(ROOT, 'src', '__broken_types_lint_test__.ts');
  let broken = 0;
  try {
    fs.writeFileSync(
      tmpFile,
      'export const brokenType: number = "not_a_number";\n',
      'utf8',
    );
    broken = runShell('npx tsc --noEmit && npx eslint src');
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
  return { ok, broken };
}

function testContract() {
  // Ensure spec.json is up-to-date
  const bundleStatus = runCmd('npm', ['run', 'bundle:spec', '--silent']);
  if (bundleStatus !== 0) {
    return { ok: bundleStatus, broken: 1 };
  }

  const baseSpec = path.join(ROOT, 'spec.json');
  const brokenSpec = path.join(os.tmpdir(), `hw32-broken-spec-${process.pid}.json`);
  const specObj = JSON.parse(fs.readFileSync(baseSpec, 'utf8'));

  // Intentionally introduce a breaking change: remove the first path from OpenAPI spec
  const pathKeys = Object.keys(specObj.paths || {});
  if (pathKeys.length > 0) {
    delete specObj.paths[pathKeys[0]];
  }
  fs.writeFileSync(brokenSpec, JSON.stringify(specObj, null, 2), 'utf8');

  let ok = 1;
  let broken = 0;
  try {
    if (hasCommand('oasdiff')) {
      ok = runCmd('oasdiff', ['breaking', baseSpec, baseSpec, '--fail-on', 'ERR']);
      broken = runCmd('oasdiff', ['breaking', baseSpec, brokenSpec, '--fail-on', 'ERR']);
    } else {
      // Fallback to Dockerized oasdiff if binary is not installed locally
      ok = runCmd('docker', [
        'run',
        '--rm',
        '-v',
        `${ROOT}:/work:ro`,
        'tufin/oasdiff',
        'breaking',
        '/work/spec.json',
        '/work/spec.json',
        '--fail-on',
        'ERR',
      ]);
      broken = runCmd('docker', [
        'run',
        '--rm',
        '-v',
        `${ROOT}:/work:ro`,
        '-v',
        `${brokenSpec}:/tmp/broken.json:ro`,
        'tufin/oasdiff',
        'breaking',
        '/work/spec.json',
        '/tmp/broken.json',
        '--fail-on',
        'ERR',
      ]);
    }
  } finally {
    fs.rmSync(brokenSpec, { force: true });
  }
  return { ok, broken };
}

function testArch() {
  const ok = runCmd('npx', ['depcruise', '--config', '.dependency-cruiser.cjs', 'src']);
  const tmpFile = path.join(ROOT, 'src', 'health', '__broken_arch_test__.ts');
  let broken = 0;
  try {
    fs.writeFileSync(
      tmpFile,
      "import { OrdersService } from '../orders/orders.service';\nexport const leak = OrdersService;\n",
      'utf8',
    );
    broken = runCmd('npx', ['depcruise', '--config', '.dependency-cruiser.cjs', 'src']);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
  return { ok, broken };
}

function resolveScanImage() {
  if (process.env.APP_IMAGE) return process.env.APP_IMAGE;
  const candidates = ['broker-api:hw28', 'node:22-alpine', 'gcr.io/distroless/nodejs22-debian12:nonroot'];
  for (const img of candidates) {
    try {
      execFileSync('docker', ['image', 'inspect', img], { stdio: 'ignore' });
      return img;
    } catch {
      // try next
    }
  }
  return 'broker-api:hw28';
}

function testScan() {
  const image = resolveScanImage();
  const ok = runCmd('npm', ['run', 'scan', '--silent'], {
    APP_IMAGE: image,
    SCAN_MAX: '99999',
  });
  const broken = runCmd('npm', ['run', 'scan', '--silent'], {
    APP_IMAGE: image,
    SCAN_MAX: '-1',
  });
  return { ok, broken };
}

const typesLint = testTypesLint();
const contract = testContract();
const arch = testArch();
const scan = testScan();

console.log(`types-lint-ok=${typesLint.ok}`);
console.log(`types-lint-broken=${typesLint.broken}`);
console.log(`contract-ok=${contract.ok}`);
console.log(`contract-broken=${contract.broken}`);
console.log(`arch-ok=${arch.ok}`);
console.log(`arch-broken=${arch.broken}`);
console.log(`scan-ok=${scan.ok}`);
console.log(`scan-broken=${scan.broken}`);

const allGood =
  typesLint.ok === 0 &&
  typesLint.broken !== 0 &&
  contract.ok === 0 &&
  contract.broken !== 0 &&
  arch.ok === 0 &&
  arch.broken !== 0 &&
  scan.ok === 0 &&
  scan.broken !== 0;

process.exit(allGood ? 0 : 1);
