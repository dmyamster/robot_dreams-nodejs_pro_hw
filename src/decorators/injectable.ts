import 'reflect-metadata';
import { InjectableOptions } from '../types';

export const INJECTABLE_METADATA_KEY = 'custom:injectable';
export const SCOPE_METADATA_KEY = 'custom:scope';

export function Injectable(options?: InjectableOptions): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(INJECTABLE_METADATA_KEY, true, target);
    Reflect.defineMetadata(SCOPE_METADATA_KEY, options?.scope ?? 'singleton', target);
  };
}
