import 'reflect-metadata';
import { Token, Constructor, getTokenName, unwrapToken } from './tokens';
import { Provider, Scope, ClassProvider, ValueProvider, FactoryProvider } from './types';
import { SCOPE_METADATA_KEY } from './decorators/injectable';
import { PARAM_TOKENS_METADATA_KEY } from './decorators/inject';

export class Container {
  private providers = new Map<Token, Provider>();
  private singletons = new Map<Token, any>();

  public register<T>(token: Token<T>, provider?: Provider<T>): this {
    const unwrappedToken = unwrapToken(token);
    if (provider === undefined) {
      if (typeof unwrappedToken === 'function') {
        this.providers.set(unwrappedToken, { useClass: unwrappedToken as Constructor<T> });
      } else {
        throw new Error(`Cannot automatically register token: ${getTokenName(unwrappedToken)} without a provider.`);
      }
    } else {
      this.providers.set(unwrappedToken, provider);
    }
    return this;
  }

  public resolve<T>(rawToken: Token<T>, resolutionPath: Token[] = []): T {
    const token = unwrapToken(rawToken);

    // 1. Circular dependency check
    if (resolutionPath.includes(token)) {
      const chain = [...resolutionPath, token].map(t => getTokenName(t)).join(' -> ');
      throw new Error(`Circular dependency detected: ${chain}`);
    }

    // 2. Return cached singleton instance if available
    if (this.singletons.has(token)) {
      return this.singletons.get(token);
    }

    const currentPath = [...resolutionPath, token];
    const registeredProvider = this.providers.get(token);

    // 3. Value provider handling
    if (registeredProvider && this.isValueProvider(registeredProvider)) {
      this.singletons.set(token, registeredProvider.useValue);
      return registeredProvider.useValue;
    }

    // 4. Factory provider handling
    if (registeredProvider && this.isFactoryProvider(registeredProvider)) {
      const injectTokens = registeredProvider.inject || [];
      const dependencies = injectTokens.map(depToken => this.resolve(depToken, currentPath));
      const instance = registeredProvider.useFactory(...dependencies);

      const scope = registeredProvider.scope ?? 'singleton';
      if (scope === 'singleton') {
        this.singletons.set(token, instance);
      }
      return instance;
    }

    // 5. Class provider or direct Constructor resolution
    let targetClass: Constructor<T>;
    let providerScope: Scope | undefined;

    if (registeredProvider && this.isClassProvider(registeredProvider)) {
      targetClass = registeredProvider.useClass;
      providerScope = registeredProvider.scope;
    } else if (typeof token === 'function') {
      targetClass = token as Constructor<T>;
    } else {
      throw new Error(`No provider found for token: ${getTokenName(token)}`);
    }

    const classScope: Scope = Reflect.getMetadata(SCOPE_METADATA_KEY, targetClass) || 'singleton';
    const effectiveScope: Scope = providerScope ?? classScope;

    // Check if targetClass is already cached under targetClass token when resolving an alias
    if (effectiveScope === 'singleton' && this.singletons.has(targetClass)) {
      const instance = this.singletons.get(targetClass);
      this.singletons.set(token, instance);
      return instance;
    }

    // Read constructor parameter types via design:paramtypes
    const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', targetClass) || [];
    const customParamTokens: Record<number, Token> =
      Reflect.getOwnMetadata(PARAM_TOKENS_METADATA_KEY, targetClass) || {};

    const primitiveConstructors: any[] = [Object, String, Number, Boolean, Symbol, Function, BigInt];

    const dependencies = paramTypes.map((paramType, index) => {
      const paramToken = customParamTokens[index] !== undefined ? customParamTokens[index] : paramType;
      if (
        paramToken === undefined ||
        (primitiveConstructors.includes(paramToken) && customParamTokens[index] === undefined)
      ) {
        throw new Error(
          `Cannot resolve parameter at index ${index} of ${getTokenName(targetClass)}. ` +
          `Interface or primitive types must be annotated with @Inject(token).`
        );
      }
      return this.resolve(paramToken, currentPath);
    });

    const instance = new targetClass(...dependencies);

    if (effectiveScope === 'singleton') {
      this.singletons.set(token, instance);
      if (token !== targetClass) {
        this.singletons.set(targetClass, instance);
      }
    }

    return instance;
  }

  public clear(): void {
    this.providers.clear();
    this.singletons.clear();
  }

  private isValueProvider<T>(provider: Provider<T>): provider is ValueProvider<T> {
    return 'useValue' in provider;
  }

  private isFactoryProvider<T>(provider: Provider<T>): provider is FactoryProvider<T> {
    return 'useFactory' in provider;
  }

  private isClassProvider<T>(provider: Provider<T>): provider is ClassProvider<T> {
    return 'useClass' in provider;
  }
}
