import 'reflect-metadata';

export type ParamType = 'body' | 'param' | 'query';

export interface ParamMetadata {
  index: number;
  type: ParamType;
  name?: string;
}

export const PARAMS_METADATA = 'PARAMS_METADATA';

function createParamDecorator(type: ParamType) {
  return (name?: string): ParameterDecorator => {
    return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
      if (!propertyKey) return;
      const existingParams: Record<number, ParamMetadata> =
        Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || {};
      existingParams[parameterIndex] = {
        index: parameterIndex,
        type,
        name,
      };
      Reflect.defineMetadata(PARAMS_METADATA, existingParams, target, propertyKey);
    };
  };
}

export const Body = createParamDecorator('body');
export const Param = createParamDecorator('param');
export const Query = createParamDecorator('query');
