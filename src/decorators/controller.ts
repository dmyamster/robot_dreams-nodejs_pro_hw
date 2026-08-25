import 'reflect-metadata';

export const CONTROLLER_PREFIX_METADATA = 'CONTROLLER_PREFIX_METADATA';

export function Controller(prefix: string = ''): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(CONTROLLER_PREFIX_METADATA, prefix, target);
  };
}
