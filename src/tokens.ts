export type Constructor<T = any> = new (...args: any[]) => T;
export type AbstractConstructor<T = any> = abstract new (...args: any[]) => T;
export type ForwardRefFn<T = any> = () => Token<T>;

export interface ForwardRef<T = any> {
  forwardRef: ForwardRefFn<T>;
}

export type Token<T = any> =
  | Constructor<T>
  | AbstractConstructor<T>
  | string
  | symbol
  | ForwardRef<T>;

export function forwardRef<T = any>(fn: ForwardRefFn<T>): ForwardRef<T> {
  return { forwardRef: fn };
}

export function isForwardRef(token: any): token is ForwardRef {
  return typeof token === 'object' && token !== null && typeof token.forwardRef === 'function';
}

export function unwrapToken<T>(token: Token<T>): Token<T> {
  if (isForwardRef(token)) {
    return token.forwardRef();
  }
  return token;
}

export function getTokenName(token: Token<any>): string {
  if (token === undefined || token === null) {
    return 'undefined';
  }
  if (isForwardRef(token)) {
    try {
      return getTokenName(token.forwardRef());
    } catch {
      return 'ForwardRef';
    }
  }
  if (typeof token === 'function') {
    return token.name || 'AnonymousClass';
  }
  if (typeof token === 'symbol') {
    return token.description ? `Symbol(${token.description})` : token.toString();
  }
  return String(token);
}
