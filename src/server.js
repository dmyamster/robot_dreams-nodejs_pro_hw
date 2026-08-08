import net from 'node:net';
import { handleConnection } from './handler.js';

net.createServer(handleConnection).listen(3000);
