import 'reflect-metadata';
import { INJECTABLE_METADATA_KEY, SCOPE_METADATA_KEY, INJECT_METADATA_KEY } from './constants.js';
import type { Constructor, Token, Scope } from './types.js';

export class Container {
  // Кеш створених синглтонів: токен -> інстанс
  private instances = new Map<Token, any>();

  // Провайдери, зареєстровані вручну (наприклад, токени рядки/символи)
  private providers = new Map<Token, any>();

  /**
   * Реєстрація значення за токеном вручну (наприклад, для @Inject('CONFIG'))
   */
  register<T>(token: Token<T>, value: T): void {
    this.providers.set(token, value);
  }

  /**
   * Головний метод отримання екземпляра
   */
  resolve<T>(token: Token<T>, resolutionPath: Token[] = []): T {
    // 1. Якщо значення зареєстроване вручну (наприклад, токен @Inject)
    if (this.providers.has(token)) {
      return this.providers.get(token);
    }

    // Якщо це не конструктор (не клас) і його нема в providers — ми не знаємо, як його створити
    if (typeof token !== 'function') {
      throw new Error(`Cannot resolve token: ${String(token)}. No provider found.`);
    }

    const TargetClass = token as Constructor<T>;

    // 2. Детекція циклічних залежностей
    if (resolutionPath.includes(token)) {
      const chain = [...resolutionPath, token].map(t => typeof t === 'function' ? t.name : String(t)).join(' -> ');
      throw new Error(`Circular dependency detected: ${chain}`);
    }

    // 3. Перевірка на @Injectable()
    const isInjectable = Reflect.getMetadata(INJECTABLE_METADATA_KEY, TargetClass);
    if (!isInjectable) {
      throw new Error(`Class ${TargetClass.name} is not marked as @Injectable()`);
    }

    // 4. Отримуємо scope класу (за замовчуванням 'singleton')
    const scope: Scope = Reflect.getMetadata(SCOPE_METADATA_KEY, TargetClass) ?? 'singleton';

    // 5. Якщо це singleton і вже існує в кеші — повертаємо його
    if (scope === 'singleton' && this.instances.has(TargetClass)) {
      return this.instances.get(TargetClass);
    }

    // 6. Зчитуємо залежності конструктора
    const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', TargetClass) || [];
    const injectTokens: Record<number, Token> = Reflect.getMetadata(INJECT_METADATA_KEY, TargetClass) || {};

    // Оновлюємо шлях резолву для дочірніх залежностей
    const currentPath = [...resolutionPath, token];

    // 7. Рекурсивно резолвимо кожну залежність
    const dependencies = paramTypes.map((paramType, index) => {
      // Якщо є явний @Inject(token) — беремо його, інакше беремо тип з design:paramtypes
      const depToken = injectTokens[index] ?? paramType;
      return this.resolve(depToken, currentPath);
    });

    // 8. Створюємо екземпляр
    const instance = new TargetClass(...dependencies);

    // 9. Якщо singleton — зберігаємо в кеш
    if (scope === 'singleton') {
      this.instances.set(TargetClass, instance);
    }

    return instance;
  }
}
