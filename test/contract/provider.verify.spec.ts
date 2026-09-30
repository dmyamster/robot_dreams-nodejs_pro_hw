import { Verifier, VerifierOptions } from '@pact-foundation/pact';
import { createNestApp } from '../../src/app.factory';
import * as path from 'node:path';

describe('Pact Provider Verification', () => {
  it('should verify provider against consumer contracts', async () => {
    const app = await createNestApp();
    const server = await app.listen(0);
    const address = server.address() as any;
    const port = address.port;
    const providerBaseUrl = `http://127.0.0.1:${port}`;

    const brokerUrl = process.env.PACT_BROKER_URL;
    const brokerToken = process.env.PACT_BROKER_TOKEN;
    const providerVersion = process.env.PROVIDER_VERSION || process.env.GIT_COMMIT || '1.0.0';
    const localPact = path.resolve(
      process.cwd(),
      'pacts/PaperTradingFrontend-PaperTradingBrokerApi.json',
    );

    const opts: VerifierOptions = {
      provider: 'PaperTradingBrokerApi',
      providerBaseUrl,
      logLevel: 'info',
      stateHandlers: {
        'an order with ID a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 exists': async () => {
          return { description: 'Order a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 is available' };
        },
        'an instrument with symbol AAPL exists': async () => {
          return { description: 'Instrument AAPL is available' };
        },
      },
      ...(brokerUrl
        ? {
            pactBrokerUrl: brokerUrl,
            ...(brokerToken ? { pactBrokerToken: brokerToken } : {}),
            publishVerificationResult: true,
            providerVersion,
            consumerVersionSelectors: [{ latest: true }],
          }
        : {
            pactUrls: [localPact],
          }),
    };

    try {
      const verifier = new Verifier(opts);
      await verifier.verifyProvider();
    } finally {
      await app.close();
    }
  });
});
