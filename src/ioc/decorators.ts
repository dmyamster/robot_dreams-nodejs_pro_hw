import 'reflect-metadata';
import { INJECTABLE_METADATA_KEY, INJECT_METADATA_KEY, SCOPE_METADATA_KEY } from './constants.js';
import type { InjectableOptions, Token } from './types.js';


export function Injectable(options?: InjectableOptions): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(INJECTABLE_METADATA_KEY, true, target);
    Reflect.defineMetadata(SCOPE_METADATA_KEY, options?.scope ?? 'singleton', target);
  };
}


export function Inject(token: Token): ParameterDecorator {
  return function (target: Object, propertyKey: string | symbol | undefined, parameterIndex: number) {
    // Якщо декоратор викликано на прототипі, беремо його конструктор (сам клас)
    const actualTarget = typeof target === 'function' ? target : target.constructor;
    // Отримуємо вже збережені раніше токени параметрів (якщо декілька параметрів мають @Inject)
    const existingTokens: Record<number, Token> =
      Reflect.getOwnMetadata(INJECT_METADATA_KEY, actualTarget) || {};
    // Зберігаємо токен під індексом цього параметра
    existingTokens[parameterIndex] = token;
    // Записуємо оновлену мапу в метадані класу
    Reflect.defineMetadata(INJECT_METADATA_KEY, existingTokens, actualTarget);
  };
}
