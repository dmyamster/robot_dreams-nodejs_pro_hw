import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const schemaPath = path.resolve(rootDir, 'src/config/env.schema.ts');
const examplePath = path.resolve(rootDir, '.env.example');

if (!fs.existsSync(schemaPath)) {
  console.error(`❌ Schema file not found: ${schemaPath}`);
  process.exit(1);
}

if (!fs.existsSync(examplePath)) {
  console.error(`❌ .env.example not found: ${examplePath}`);
  process.exit(1);
}

// 1. Extract keys defined in .env.example
const exampleContent = fs.readFileSync(examplePath, 'utf8');
const exampleKeys = new Set();
for (const line of exampleContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const match = trimmed.match(/^([A-Za-z0-9_]+)=/);
  if (match) {
    exampleKeys.add(match[1]);
  }
}

// 2. Extract schema keys from env.schema.ts
let schemaKeys = [];
try {
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  const objectMatch = schemaContent.match(/envSchema\s*=\s*z\.object\(\s*\{([\s\S]*?)\}\s*\)/);
  if (objectMatch) {
    const lines = objectMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      const keyMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:/);
      if (keyMatch) {
        schemaKeys.push(keyMatch[1]);
      }
    }
  }
} catch (err) {
  console.error('❌ Failed to parse env.schema.ts:', err);
  process.exit(1);
}

if (schemaKeys.length === 0) {
  console.error('❌ No keys found in env schema');
  process.exit(1);
}

// 3. Compare schema keys with .env.example
const missingInExample = schemaKeys.filter((key) => !exampleKeys.has(key));

if (missingInExample.length > 0) {
  console.error(`\n❌ .env.example is out of sync with src/config/env.schema.ts!`);
  console.error(`Missing keys in .env.example:`);
  for (const key of missingInExample) {
    console.error(`  - ${key}`);
  }
  console.error('\nPlease update .env.example with the missing variables.\n');
  process.exit(1);
}

console.log(`✅ .env.example is in sync with env schema (${schemaKeys.length} variables checked)`);
process.exit(0);
