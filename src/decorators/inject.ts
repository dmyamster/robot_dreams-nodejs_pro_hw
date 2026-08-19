import 'reflect-metadata';
import { Token } from '../tokens';

export const PARAM_TOKENS_METADATA_KEY = 'custom:param_tokens';

export function Inject(token: Token): ParameterDecorator {
  return (target: Object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const targetClass = typeof target === 'function' ? target : target.constructor;
    const existingParamTokens: Record<number, Token> =
      Reflect.getOwnMetadata(PARAM_TOKENS_METADATA_KEY, targetClass) || {};
    existingParamTokens[parameterIndex] = token;
    Reflect.defineMetadata(PARAM_TOKENS_METADATA_KEY, existingParamTokens, targetClass);
  };
}
