import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '../src/container';
import { Injectable } from '../src/decorators/injectable';
import { Inject } from '../src/decorators/inject';
import { forwardRef } from '../src/tokens';

describe('IoC Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('Recursive graph resolution', () => {
    @Injectable()
    class ServiceC {
      getValue() {
        return 'Hello from C';
      }
    }

    @Injectable()
    class ServiceB {
      constructor(public c: ServiceC) {}
    }

    @Injectable()
    class ServiceA {
      constructor(public b: ServiceB) {}
    }

    it('should recursively resolve A -> B -> C and instantiate nested dependencies', () => {
      const a = container.resolve(ServiceA);

      expect(a).toBeInstanceOf(ServiceA);
      expect(a.b).toBeInstanceOf(ServiceB);
      expect(a.b.c).toBeInstanceOf(ServiceC);
      expect(a.b.c.getValue()).toBe('Hello from C');
    });
  });

  describe('Scopes (Singleton vs Transient)', () => {
    @Injectable()
    class SingletonService {
      public id = Math.random();
    }

    @Injectable({ scope: 'transient' })
    class TransientService {
      public id = Math.random();
    }

    it('should return the exact same instance for singleton classes', () => {
      const instance1 = container.resolve(SingletonService);
      const instance2 = container.resolve(SingletonService);

      expect(instance1).toBe(instance2);
      expect(instance1.id).toBe(instance2.id);
    });

    it('should return different instances for transient classes', () => {
      const instance1 = container.resolve(TransientService);
      const instance2 = container.resolve(TransientService);

      expect(instance1).not.toBe(instance2);
      expect(instance1.id).not.toBe(instance2.id);
    });
  });

  describe('@Inject(token)', () => {
    const CONFIG_TOKEN = Symbol.for('CONFIG');

    interface AppConfig {
      apiUrl: string;
    }

    @Injectable()
    class ApiClient {
      constructor(@Inject(CONFIG_TOKEN) public config: AppConfig) {}
    }

    it('should resolve dependencies registered by custom token (Symbol)', () => {
      const mockConfig: AppConfig = { apiUrl: 'https://api.example.com' };
      container.register(CONFIG_TOKEN, { useValue: mockConfig });

      const client = container.resolve(ApiClient);
      expect(client).toBeInstanceOf(ApiClient);
      expect(client.config).toEqual(mockConfig);
      expect(client.config.apiUrl).toBe('https://api.example.com');
    });

    it('should resolve dependencies registered with string tokens', () => {
      const STRING_TOKEN = 'DATABASE_URL';
      container.register(STRING_TOKEN, { useValue: 'postgres://localhost:5432/db' });

      @Injectable()
      class DatabaseService {
        constructor(@Inject(STRING_TOKEN) public dbUrl: string) {}
      }

      const dbService = container.resolve(DatabaseService);
      expect(dbService.dbUrl).toBe('postgres://localhost:5432/db');
    });
  });

  describe('Circular Dependency Detection', () => {
    @Injectable()
    class CircularA {
      constructor(@Inject(forwardRef(() => CircularB)) public b: any) {}
    }

    @Injectable()
    class CircularB {
      constructor(@Inject(forwardRef(() => CircularA)) public a: any) {}
    }

    it('should throw an informative error matching the full cycle chain without RangeError', () => {
      expect(() => {
        container.resolve(CircularA);
      }).toThrowError(/CircularA -> CircularB -> CircularA/);

      // Verify that it is not a RangeError
      try {
        container.resolve(CircularA);
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(RangeError);
        expect(error.message).toContain('Circular dependency detected: CircularA -> CircularB -> CircularA');
      }
    });

    it('should detect longer cycle chains NodeA -> NodeB -> NodeC -> NodeA', () => {
      @Injectable()
      class NodeA {
        constructor(@Inject(forwardRef(() => NodeB)) public b: any) {}
      }

      @Injectable()
      class NodeB {
        constructor(@Inject(forwardRef(() => NodeC)) public c: any) {}
      }

      @Injectable()
      class NodeC {
        constructor(@Inject(forwardRef(() => NodeA)) public a: any) {}
      }

      expect(() => {
        container.resolve(NodeA);
      }).toThrowError(/NodeA -> NodeB -> NodeC -> NodeA/);
    });
  });

  describe('Providers (useValue, useClass, useFactory)', () => {
    it('should resolve useFactory with injected dependencies', () => {
      const PORT_TOKEN = 'PORT';
      container.register(PORT_TOKEN, { useValue: 8080 });

      const SERVER_TOKEN = 'SERVER';
      container.register(SERVER_TOKEN, {
        useFactory: (port: number) => ({ port, url: `http://localhost:${port}` }),
        inject: [PORT_TOKEN],
      });

      const server: any = container.resolve(SERVER_TOKEN);
      expect(server.port).toBe(8080);
      expect(server.url).toBe('http://localhost:8080');
    });

    it('should resolve interface tokens using useClass', () => {
      abstract class ILogger {
        abstract log(msg: string): string;
      }

      @Injectable()
      class ConsoleLogger implements ILogger {
        log(msg: string) {
          return `LOG: ${msg}`;
        }
      }

      container.register(ILogger, { useClass: ConsoleLogger });

      @Injectable()
      class AppService {
        constructor(@Inject(ILogger) public logger: ILogger) {}
      }

      const app = container.resolve(AppService);
      expect(app.logger).toBeInstanceOf(ConsoleLogger);
      expect(app.logger.log('test')).toBe('LOG: test');
    });
  });

  describe('Error handling', () => {
    it('should throw an informative error when resolving an unregistered non-class token', () => {
      expect(() => {
        container.resolve('UNKNOWN_TOKEN');
      }).toThrowError(/No provider found for token: UNKNOWN_TOKEN/);
    });

    it('should throw error when constructor has interface/primitive param without @Inject', () => {
      @Injectable()
      class BrokenService {
        constructor(public unannotatedParam: string) {}
      }

      expect(() => {
        container.resolve(BrokenService);
      }).toThrowError(/Cannot resolve parameter at index 0 of BrokenService/);
    });
  });
});
