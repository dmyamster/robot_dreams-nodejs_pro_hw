export type Scope = 'singleton' | 'transient';
export interface InjectableOptions {
  scope?: Scope;
}
export type Constructor<T = any> = new (...args: any[]) => T;
export type Token<T = any> = Constructor<T> | string | symbol;