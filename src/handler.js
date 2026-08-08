import { parseRequest } from './parser.js';

export function handleConnection(socket) {
  let requestData = '';

  socket.on('data', (chunk) => {
    requestData += chunk.toString('utf-8');

    const parsedRequest = parseRequest(requestData);
    if (parsedRequest) {
      const { method, path, headers } = parsedRequest;

      let statusCode = '200 OK';
      let contentType = 'text/plain; charset=utf-8';
      let body = '';

      if (method === 'GET' && path === '/') {
        body = 'Dummy body';
      } else if (method === 'GET' && path === '/headers') {
        body = Object.entries(headers)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');
      } else {
        statusCode = '404 Not Found';
        body = 'Not Found';
      }

      const response = [
        `HTTP/1.1 ${statusCode}`,
        `Content-Type: ${contentType}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        body
      ].join('\r\n');

      socket.write(response);
      socket.end();
    }
  });
}
