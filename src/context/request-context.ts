import { AsyncLocalStorage } from 'node:async_hooks';
import * as http from 'node:http';

export interface RequestStore {
  requestId: string;
  req?: http.IncomingMessage;
  res?: http.ServerResponse;
  [key: string]: any;
}

export class RequestContext {
  private static readonly storage = new AsyncLocalStorage<RequestStore>();

  public static run<R>(store: RequestStore, callback: () => R): R {
    return this.storage.run(store, callback);
  }

  public static getStore(): RequestStore | undefined {
    return this.storage.getStore();
  }

  public static getRequestId(): string | undefined {
    return this.getStore()?.requestId;
  }

  public static get<T = any>(key: string): T | undefined {
    const store = this.getStore();
    return store ? (store[key] as T) : undefined;
  }

  public static set(key: string, value: any): void {
    const store = this.getStore();
    if (store) {
      store[key] = value;
    }
  }
}
