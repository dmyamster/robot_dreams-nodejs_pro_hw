export function parseRequest(rawRequest) {
  if (!rawRequest) {
    return null;
  }

  const separatorIndex = rawRequest.indexOf('\r\n\r\n');
  if (separatorIndex === -1) {
    return null;
  }

  const headerPart = rawRequest.slice(0, separatorIndex);
  const body = rawRequest.slice(separatorIndex + 4);

  const headerLines = headerPart.split('\r\n');
  const requestLine = headerLines[0];

  if (!requestLine) {
    return null;
  }

  const [method, path, httpVersion] = requestLine.split(' ');

  const headers = {};
  for (let i = 1; i < headerLines.length; i++) {
    const line = headerLines[i];
    if (line.trim() === '') continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  return {
    method,
    path,
    httpVersion,
    headers,
    body
  };
}
