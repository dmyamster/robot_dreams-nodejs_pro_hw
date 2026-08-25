import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  Controller,
  Get,
  Post,
  Body,
  Container,
  Dispatcher,
  CanActivate,
  ExecutionContext,
  NestInterceptor,
  CallHandler,
  PipeTransform,
  ArgumentMetadata,
} from '../src';

describe('Lifecycle Order Test', () => {
  let dispatcher: Dispatcher;
  let server: http.Server;
  let baseUrl: string;
  let container: Container;

  const executionLog: string[] = [];

  class OrderMiddleware {
    static use(req: http.IncomingMessage, res: http.ServerResponse, next: () => void | Promise<void>) {
      executionLog.push('middleware');
      return next();
    }
  }

  class OrderGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      executionLog.push('guard');
      return true;
    }
  }

  class OrderInterceptor implements NestInterceptor {
    async intercept(context: ExecutionContext, next: CallHandler): Promise<any> {
      executionLog.push('interceptor:before');
      const result = await next.handle();
      executionLog.push('interceptor:after');
      return result;
    }
  }

  class OrderPipe implements PipeTransform {
    transform(value: any, metadata?: ArgumentMetadata): any {
      executionLog.push('pipe');
      return value;
    }
  }

  @Controller('test')
  class TestController {
    @Post()
    public testHandler(@Body() body: any) {
      executionLog.push('handler');
      return { success: true };
    }
  }

  beforeEach(async () => {
    executionLog.length = 0;
    container = new Container();

    dispatcher = new Dispatcher({
      container,
      controllers: [TestController],
      middlewares: [OrderMiddleware.use],
      guards: [OrderGuard],
      interceptors: [OrderInterceptor],
      pipes: [OrderPipe],
    });

    server = dispatcher.listen(0);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await dispatcher.close();
  });

  it('proves exact lifecycle order: middleware -> guard -> interceptor:before -> pipe -> handler -> interceptor:after', async () => {
    const res = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.success).toBe(true);

    expect(executionLog).toEqual([
      'middleware',
      'guard',
      'interceptor:before',
      'pipe',
      'handler',
      'interceptor:after',
    ]);
  });
});
