import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Injectable,
  Container,
  Dispatcher,
  CreateUserDto,
} from '../src';

@Injectable()
class UsersService {
  public count = 0;

  public getUser(id: string) {
    this.count++;
    return { id, source: 'UsersService', count: this.count };
  }

  public createUser(dto: CreateUserDto) {
    this.count++;
    return { user: dto, isDtoInstance: dto instanceof CreateUserDto, count: this.count };
  }
}

@Controller('users')
class UsersController {
  constructor(public readonly usersService: UsersService) {}

  @Get(':id')
  public getUserById(@Param('id') id: string) {
    return this.usersService.getUser(id);
  }

  @Get()
  public listUsers(@Query('limit') limit: string) {
    return { limit, items: [] };
  }

  @Post()
  public createUser(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }
}

describe('Mini-Nest HTTP Routing & Validation', () => {
  let dispatcher: Dispatcher;
  let server: http.Server;
  let baseUrl: string;
  let container: Container;

  beforeEach(async () => {
    container = new Container();
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

  it('1. Controller prefix and method route concatenate correctly: GET /users/42 responds with 200', async () => {
    const res = await fetch(`${baseUrl}/users/42`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.id).toBe('42');
  });

  it('2. @Param works: GET /users/42 receives param as argument and returns body containing 42', async () => {
    const res = await fetch(`${baseUrl}/users/42`);
    const text = await res.text();
    expect(text).toContain('42');
    const json = JSON.parse(text);
    expect(json.id).toBe('42');
  });

  it('3. @Query works: GET /users?limit=5 passes limit value to handler as separate argument', async () => {
    const res = await fetch(`${baseUrl}/users?limit=5`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.limit).toBe('5');
  });

  it('4. @Body works and validation passes: valid body returns 201 and receives CreateUserDto instance', async () => {
    const payload = {
      email: 'john.doe@example.com',
      name: 'John Doe',
    };

    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.user.email).toBe('john.doe@example.com');
    expect(body.user.name).toBe('John Doe');
    expect(body.isDtoInstance).toBe(true);
  });

  it('5. Validation rejects invalid body: POST /users with invalid email returns 400 and matches /email/', async () => {
    const invalidPayload = {
      email: 'not-an-email',
      name: 'John Doe',
    };

    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload),
    });

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/email/);

    const json = JSON.parse(text);
    expect(json.statusCode).toBe(400);
    expect(Array.isArray(json.errors)).toBe(true);
    expect(json.errors.some((e: any) => e.field === 'email')).toBe(true);
  });

  it('6. Part 1 IoC Container is utilized: Controller receives service in constructor as singleton', async () => {
    const serviceFromContainer = container.resolve(UsersService);

    const res1 = await fetch(`${baseUrl}/users/1`);
    const body1: any = await res1.json();
    expect(body1.count).toBe(1);

    const res2 = await fetch(`${baseUrl}/users/2`);
    const body2: any = await res2.json();
    expect(body2.count).toBe(2);

    expect(serviceFromContainer.count).toBe(2);
  });

  it('7. Returns 404 for non-existent routes', async () => {
    const res = await fetch(`${baseUrl}/non-existent-route`);
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.statusCode).toBe(404);
  });
});
