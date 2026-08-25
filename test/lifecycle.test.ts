import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Container,
  Dispatcher,
  CreateUserDto,
  AuthGuard,
  LoggingInterceptor,
  NotFoundError,
  RequestContext,
} from '../src';
import { UsersService, UsersRepository } from '../src/services/users.service';

@Controller('users')
class UsersController {
  constructor(public readonly usersService: UsersService) {}

  @Get(':id')
  public getUserById(@Param('id') id: string) {
    if (id === 'not-found') {
      throw new NotFoundError(`User with id ${id} not found`);
    }
    if (id === 'boom') {
      throw new Error('Internal boom error with secret credentials at /secret.ts:42');
    }
    return this.usersService.getUser(id);
  }

  @Get()
  public listUsers(@Query('limit') limit: string) {
    return { limit, items: [] };
  }

  @Post()
  public createUser(@Body() dto: CreateUserDto) {
    return { user: dto, created: true };
  }
}

describe('Mini-Nest Lifecycle & Features', () => {
  let dispatcher: Dispatcher;
  let server: http.Server;
  let baseUrl: string;
  let container: Container;
  let logOutput: string[] = [];

  beforeEach(async () => {
    logOutput = [];
    container = new Container();
    container.register(UsersRepository);
    container.register(UsersService);

    dispatcher = new Dispatcher({
      container,
      controllers: [UsersController],
    });

    server = dispatcher.listen(0);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await dispatcher.close();
  });

  it('1. Guard blocks before handler when Authorization header is missing (returns 403 and handler is not called)', async () => {
    const handlerSpy = vi.fn();

    @Controller('protected')
    class ProtectedController {
      @Get()
      public test() {
        handlerSpy();
        return { ok: true };
      }
    }

    const secureDispatcher = new Dispatcher({
      guards: [AuthGuard],
      controllers: [ProtectedController],
    });

    const secureServer = secureDispatcher.listen(0);
    await new Promise<void>(resolve => secureServer.once('listening', () => resolve()));
    const port = (secureServer.address() as AddressInfo).port;
    const secUrl = `http://127.0.0.1:${port}`;

    try {
      // Missing Authorization -> 403
      const resUnauth = await fetch(`${secUrl}/protected`);
      expect(resUnauth.status).toBe(403);
      expect(handlerSpy).not.toHaveBeenCalled();

      // With Authorization -> 200
      const resAuth = await fetch(`${secUrl}/protected`, {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(resAuth.status).toBe(200);
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    } finally {
      await secureDispatcher.close();
    }
  });

  it('2. Interceptor measures duration and logs METHOD /path — XX.X ms', async () => {
    const logs: string[] = [];
    const interceptor = new LoggingInterceptor(msg => logs.push(msg));

    const loggedDispatcher = new Dispatcher({
      container,
      controllers: [UsersController],
      interceptors: [interceptor],
    });

    const loggedServer = loggedDispatcher.listen(0);
    await new Promise<void>(resolve => loggedServer.once('listening', () => resolve()));
    const port = (loggedServer.address() as AddressInfo).port;
    const logUrl = `http://127.0.0.1:${port}`;

    try {
      const res = await fetch(`${logUrl}/users/123`);
      expect(res.status).toBe(200);
      expect(logs.length).toBeGreaterThan(0);
      const logLine = logs[0];
      expect(logLine).toContain('GET /users/123');
      expect(logLine).toMatch(/[0-9]+(\.[0-9]+)? ?ms/);
    } finally {
      await loggedDispatcher.close();
    }
  });

  it('3. Pipe on Zod rejects invalid body with 400 and returns list of fields', async () => {
    const invalidPayload = {
      email: 'not-an-email',
      name: 'a', // min length is 2
    };

    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(Array.isArray(body.errors)).toBe(true);

    const fields = body.errors.map((e: any) => e.field);
    expect(fields).toContain('email');
    expect(fields).toContain('name');
  });

  it('4. Pipe on Zod accepts valid body with 201', async () => {
    const validPayload = {
      email: 'john@example.com',
      name: 'John Doe',
    };

    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.user.email).toBe('john@example.com');
    expect(body.user.name).toBe('John Doe');
  });

  it('5. Exception filter catches domain error NotFoundError and returns 404 with message', async () => {
    const res = await fetch(`${baseUrl}/users/not-found`);
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
    expect(body.message).toContain('User with id not-found not found');
  });

  it('6. Exception filter catches unexpected errors, returns 500 without leaking error message or stack trace', async () => {
    const res = await fetch(`${baseUrl}/users/boom`);
    expect(res.status).toBe(500);
    const rawText = await res.text();

    // Verify response does not leak internal 'boom' message or stack traces
    expect(rawText).not.toMatch(/boom|at .*\.ts:/);
    const json = JSON.parse(rawText);
    expect(json.statusCode).toBe(500);
    expect(json.message).toBe('Internal Server Error');
  });

  it('7. AsyncLocalStorage propagates requestId to deep services without parameter passing', async () => {
    const customRequestId = 'custom-request-id-12345';

    const res = await fetch(`${baseUrl}/users/42`, {
      headers: { 'X-Request-Id': customRequestId },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe(customRequestId);

    const body: any = await res.json();
    expect(body.serviceRequestId).toBe(customRequestId);
    expect(body.repoResult.repositoryRequestId).toBe(customRequestId);
  });

  it('8. X-Request-Id is automatically generated when not provided', async () => {
    const res = await fetch(`${baseUrl}/users/42`);
    expect(res.status).toBe(200);

    const responseRequestId = res.headers.get('x-request-id');
    expect(responseRequestId).toBeTruthy();

    const body: any = await res.json();
    expect(body.serviceRequestId).toBe(responseRequestId);
    expect(body.repoResult.repositoryRequestId).toBe(responseRequestId);
  });

  it('9. 10 concurrent requests do not mix up their AsyncLocalStorage contexts', async () => {
    const requestIds = Array.from({ length: 10 }, (_, i) => `req-concurrent-${i}`);

    const responses = await Promise.all(
      requestIds.map(async id => {
        const res = await fetch(`${baseUrl}/users/${id}`, {
          headers: { 'X-Request-Id': id },
        });
        const json: any = await res.json();
        return {
          headerId: res.headers.get('x-request-id'),
          serviceId: json.serviceRequestId,
          repoId: json.repoResult.repositoryRequestId,
          userId: json.id,
        };
      })
    );

    for (let i = 0; i < requestIds.length; i++) {
      const expectedId = requestIds[i];
      const result = responses[i];
      expect(result.headerId).toBe(expectedId);
      expect(result.serviceId).toBe(expectedId);
      expect(result.repoId).toBe(expectedId);
      expect(result.userId).toBe(expectedId);
    }
  });
});
