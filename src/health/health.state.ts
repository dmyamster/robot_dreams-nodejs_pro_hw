let ready = false;

/**
 * Sets whether the HTTP server is ready to accept traffic.
 */
export function setReady(value: boolean): void {
  ready = value;
}

/**
 * Returns true if the HTTP server is ready to accept traffic.
 */
export function isReady(): boolean {
  return ready;
}
