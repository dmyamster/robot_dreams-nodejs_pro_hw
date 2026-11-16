import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.factory';
import { JwtService } from '../../src/auth/jwt.service';
import { DenylistService } from '../../src/auth/denylist.service';
import {
  startPostgresContainer,
  stopPostgresContainer,
} from '../integration/testkit/postgres-container';
import { randomUUID } from 'node:crypto';

describe('Paper Trading Broker API (E2E Suite via Supertest)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    // 1. Start real PostgreSQL testcontainer and supply connection through environment variable
    const { uri } = await startPostgresContainer();
    process.env.DB_URL = uri;
    process.env.DATABASE_URL = uri;

    // 2. Full Nest application compilation (DenylistService backed by in-memory Set when Redis is absent in CI)
    const revokedJtis = new Set<string>();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DenylistService)
      .useValue({
        revoke: async (jti: string) => {
          revokedJtis.add(jti);
        },
        isRevoked: async (jti: string) => revokedJtis.has(jti),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const jwtService = app.get(JwtService);
    authToken = jwtService.signAccessToken({
      sub: 'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      email: 'e2e@broker.test',
      role: 'ADMIN',
    }).token;
  });

  afterAll(async () => {
    // Graceful closure prevents open handles in Jest
    if (app) {
      await app.close();
    }
    await stopPostgresContainer();
  });

  describe('Main Feature Flow (Create Order -> Read Order -> Read Instruments)', () => {
    it('1. happy path: should create an order and retrieve it by id', async () => {
      const idempotencyKey = randomUUID();
      const orderPayload = {
        symbol: 'AAPL',
        side: 'BUY',
        type: 'MARKET',
        quantity: 5,
      };

      // 1. CREATE ORDER (POST /api/v1/orders)
      const postResponse = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(orderPayload)
        .expect(HttpStatus.CREATED); // 201

      expect(postResponse.body).toBeDefined();
      expect(postResponse.body.id).toBeDefined();
      expect(postResponse.body.symbol).toBe('AAPL');
      expect(postResponse.body.quantity).toBe(5);
      expect(postResponse.body.status).toBe('FILLED');

      const createdId = postResponse.body.id;

      // 2. READ ORDER (GET /api/v1/orders/:id)
      const getResponse = await request(app.getHttpServer())
        .get(`/api/v1/orders/${createdId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(HttpStatus.OK); // 200

      expect(getResponse.body).toBeDefined();
      expect(getResponse.body.id).toBe(createdId);
      expect(getResponse.body.symbol).toBe('AAPL');

      // 3. READ INSTRUMENTS CATALOG (GET /api/v1/instruments)
      const catalogResponse = await request(app.getHttpServer())
        .get('/api/v1/instruments?limit=5')
        .expect(HttpStatus.OK); // 200

      expect(catalogResponse.body.items).toBeInstanceOf(Array);
      expect(catalogResponse.body.items.length).toBeGreaterThan(0);
    });

    it('2. replay path: should return cached order with Idempotency-Replay header on duplicate payload', async () => {
      const idempotencyKey = randomUUID();
      const orderPayload = {
        symbol: 'MSFT',
        side: 'SELL',
        type: 'MARKET',
        quantity: 2,
      };

      const initialRes = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(orderPayload)
        .expect(HttpStatus.CREATED);

      const replayRes = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(orderPayload)
        .expect(HttpStatus.CREATED);

      expect(replayRes.headers['idempotency-replay']).toBe('true');
      expect(replayRes.body.id).toBe(initialRes.body.id);
    });
  });

  describe('Negative Cases (Validation & Semantic Failures)', () => {
    it('3. negative: should return 400 Bad Request when Idempotency-Key is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          symbol: 'AAPL',
          side: 'BUY',
          type: 'MARKET',
          quantity: 1,
        })
        .expect(HttpStatus.BAD_REQUEST); // 400

      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(response.status).toBe(400);
      expect(response.body.title).toBeDefined();
    });

    it('4. negative: should return 400 Bad Request when quantity is invalid (quantity = 0)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          symbol: 'AAPL',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0, // minimum is 1 in OpenAPI schema
        })
        .expect(HttpStatus.BAD_REQUEST); // 400

      expect(response.status).toBe(400);
      expect(response.body.detail).toMatch(/quantity/i);
    });

    it('5. negative: should return 404 Not Found for non-existent order id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/orders/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(HttpStatus.NOT_FOUND); // 404

      expect(response.status).toBe(404);
      expect(response.body.title).toMatch(/NotFound|Not Found/i);
    });

    it('6. negative: should return 422 Unprocessable Entity when same Idempotency-Key reused with different body', async () => {
      const idempotencyKey = randomUUID();

      await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ symbol: 'AAPL', side: 'BUY', type: 'MARKET', quantity: 2 })
        .expect(HttpStatus.CREATED);

      const collisionRes = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ symbol: 'TSLA', side: 'BUY', type: 'MARKET', quantity: 10 })
        .expect(HttpStatus.UNPROCESSABLE_ENTITY); // 422

      expect(collisionRes.status).toBe(422);
    });
  });
});
