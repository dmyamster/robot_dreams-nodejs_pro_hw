import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';

export interface RequestContextStore {
  userId?: string;
  tenant?: string;
  idempotencyKey?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestContext<T>(
  store: RequestContextStore,
  fn: () => T,
): T {
  return requestContextStorage.run(store, fn);
}

export function getRequestContext(): RequestContextStore | undefined {
  return requestContextStorage.getStore();
}

export function setRequestContextUser(userId: string): void {
  const store = requestContextStorage.getStore();
  if (store) {
    store.userId = userId;
  }
}

export function bindAsyncContext<T extends (...args: any[]) => any>(fn: T): T {
  return AsyncResource.bind(fn);
}
