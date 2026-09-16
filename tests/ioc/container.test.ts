import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { Container, Injectable, Inject } from '../../src/ioc/index.js';

describe('IoC Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  it('повинен резолвити простий граф залежностей (A -> B)', () => {
    @Injectable()
    class Engine {
      start() {
        return 'vroom';
      }
    }

    @Injectable()
    class Car {
      constructor(public engine: Engine) {}
    }

    const car = container.resolve(Car);
    expect(car).toBeInstanceOf(Car);
    expect(car.engine).toBeInstanceOf(Engine);
    expect(car.engine.start()).toBe('vroom');
  });

  it('повинен повертати один і той самий екземпляр для singleton (за замовчуванням)', () => {
    @Injectable()
    class Database {
      public id = Math.random();
    }

    const db1 = container.resolve(Database);
    const db2 = container.resolve(Database);

    expect(db1).toBe(db2);
    expect(db1.id).toBe(db2.id);
  });

  it('повинен повертати різні екземпляри для transient scope', () => {
    @Injectable({ scope: 'transient' })
    class Logger {
      public id = Math.random();
    }

    const logger1 = container.resolve(Logger);
    const logger2 = container.resolve(Logger);

    expect(logger1).not.toBe(logger2);
    expect(logger1.id).not.toBe(logger2.id);
  });

  it('повинен працювати @Inject з кастомним токеном (рядок / Symbol)', () => {
    const API_URL_TOKEN = Symbol('API_URL');
    container.register(API_URL_TOKEN, 'https://api.example.com');

    @Injectable()
    class ApiClient {
      constructor(@Inject(API_URL_TOKEN) public apiUrl: string) {}
    }

    const client = container.resolve(ApiClient);
    expect(client.apiUrl).toBe('https://api.example.com');
  });

  it('повинен викидати помилку, якщо клас не позначено @Injectable()', () => {
    class NotInjectableService {}

    expect(() => container.resolve(NotInjectableService)).toThrowError(
      /is not marked as @Injectable/
    );
  });

  it('повинен виявляти циклічні залежності і викидати помилку з ланцюгом (A -> B -> A)', () => {
    @Injectable()
    class ServiceB {
      constructor(public a: any) {}
    }

    @Injectable()
    class ServiceA {
      constructor(public b: ServiceB) {}
    }

    // Штучно емулюємо зворотну залежність ServiceB -> ServiceA
    Reflect.defineMetadata('design:paramtypes', [ServiceA], ServiceB);

    expect(() => container.resolve(ServiceA)).toThrowError(
      'Circular dependency detected: ServiceA -> ServiceB -> ServiceA'
    );
  });
});
