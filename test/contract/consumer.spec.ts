import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import * as path from 'node:path';

const provider = new PactV3({
  consumer: 'PaperTradingFrontend',
  provider: 'PaperTradingBrokerApi',
  dir: path.resolve(process.cwd(), 'pacts'),
});

describe('Consumer Contract Test (Frontend -> PaperTradingBrokerApi)', () => {
  it('should verify order retrieval contract matching OpenAPI spec', async () => {
    provider
      .given('an order with ID a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 exists')
      .uponReceiving('a request for an existing order by ID')
      .withRequest({
        method: 'GET',
        path: '/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: {
          id: MatchersV3.regex(
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          ),
          account_id: MatchersV3.regex(
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          ),
          symbol: MatchersV3.like('AAPL'),
          side: MatchersV3.regex('^(BUY|SELL)$', 'BUY'),
          type: MatchersV3.regex('^(MARKET|LIMIT)$', 'MARKET'),
          quantity: MatchersV3.like(10),
          limit_price_cents: null,
          execution_price_cents: MatchersV3.like(22050),
          fee_cents: MatchersV3.like(150),
          total_cents: MatchersV3.like(220650),
          status: MatchersV3.regex('^(PENDING|FILLED|CANCELLED|REJECTED)$', 'FILLED'),
          created_at: MatchersV3.like('2026-09-16T10:00:00Z'),
        },
      });

    await provider.executeTest(async (mockserver) => {
      const response = await fetch(
        `${mockserver.url}/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`,
      );
      expect(response.status).toBe(200);
      const data: any = await response.json();
      expect(data.symbol).toBe('AAPL');
      expect(data.id).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    });
  });

  it('should verify stock instrument retrieval contract matching OpenAPI spec', async () => {
    provider
      .given('an instrument with symbol AAPL exists')
      .uponReceiving('a request for instrument by symbol')
      .withRequest({
        method: 'GET',
        path: '/instruments/AAPL',
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: {
          symbol: MatchersV3.like('AAPL'),
          company_name: MatchersV3.like('Apple Inc.'),
          current_price_cents: MatchersV3.like(22050),
          sector: MatchersV3.like('Technology'),
          trading_status: MatchersV3.regex('^(ACTIVE|HALTED)$', 'ACTIVE'),
          logo_url: MatchersV3.like('https://storage.example.com/logos/aapl.png'),
        },
      });

    await provider.executeTest(async (mockserver) => {
      const response = await fetch(`${mockserver.url}/instruments/AAPL`);
      expect(response.status).toBe(200);
      const data: any = await response.json();
      expect(data.symbol).toBe('AAPL');
      expect(data.trading_status).toBe('ACTIVE');
    });
  });
});
