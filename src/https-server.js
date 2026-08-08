import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleConnection } from './handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

tls
  .createServer({
    key: fs.readFileSync(path.join(__dirname, '../key.pem')),
    cert: fs.readFileSync(path.join(__dirname, '../cert.pem'))
  }, handleConnection)
  .listen(3443);

