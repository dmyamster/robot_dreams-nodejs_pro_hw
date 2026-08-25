import { Token, Constructor } from './tokens';

export type Scope = 'singleton' | 'transient';

export interface InjectableOptions {
  scope?: Scope;
}

export interface ClassProvider<T = any> {
  useClass: Constructor<T>;
  scope?: Scope;
}

export interface ValueProvider<T = any> {
  useValue: T;
}

export interface FactoryProvider<T = any> {
  useFactory: (...args: any[]) => T;
  inject?: Token[];
  scope?: Scope;
}

export type Provider<T = any> =
  | Constructor<T>
  | ClassProvider<T>
  | ValueProvider<T>
  | FactoryProvider<T>;
