import http from 'node:http';
import fs from 'node:fs';

const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:30080/healthz';
const outFile = process.argv[2];
const concurrency = Number(process.env.LOAD_CONCURRENCY || '16');

if (!outFile) {
  console.error('Usage: node scripts/load-gen.mjs <output-file>');
  process.exit(1);
}

const url = new URL(targetUrl);
const stream = fs.createWriteStream(outFile, { flags: 'a' });
const agent = new http.Agent({ keepAlive: false });

let stopping = false;

process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});

function sendOne() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port) || 80,
        path: url.pathname + url.search,
        method: 'GET',
        agent,
        timeout: 2000,
        headers: { Connection: 'close' },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          stream.write(`${res.statusCode}\n`);
          resolve();
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      stream.write('000\n');
      resolve();
    });

    req.on('error', () => {
      stream.write('000\n');
      resolve();
    });

    req.end();
  });
}

async function worker() {
  while (!stopping) {
    await sendOne();
  }
}

async function main() {
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  await new Promise((resolve) => stream.end(resolve));
  process.exit(0);
}

main();
