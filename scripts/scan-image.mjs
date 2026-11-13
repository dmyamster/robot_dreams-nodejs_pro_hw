import { execFileSync } from 'node:child_process';

const image = process.env.APP_IMAGE || 'broker-api:hw28';
const severity = process.env.SCAN_SEVERITY || 'CRITICAL,HIGH';
const maxAllowed = Number(process.env.SCAN_MAX ?? '100');

if (Number.isNaN(maxAllowed)) {
  console.error(`Invalid SCAN_MAX value: ${process.env.SCAN_MAX}`);
  process.exit(1);
}

let rawJson = '';
try {
  rawJson = execFileSync(
    'trivy',
    ['image', '--quiet', '--format', 'json', '--severity', severity, image],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
} catch (err) {
  console.error(`Failed to run trivy on image ${image}:`, err.message);
  process.exit(1);
}

const report = JSON.parse(rawJson);
let found = 0;
if (Array.isArray(report.Results)) {
  for (const result of report.Results) {
    if (Array.isArray(result.Vulnerabilities)) {
      found += result.Vulnerabilities.length;
    }
  }
}

const pass = found <= maxAllowed;
console.log(`image=${image}`);
console.log(`severity=${severity}`);
console.log(`found=${found}`);
console.log(`max-allowed=${maxAllowed}`);
console.log(`gate=${pass ? 'pass' : 'fail'}`);

process.exit(pass ? 0 : 1);
