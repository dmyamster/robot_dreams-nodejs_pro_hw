import assert from 'node:assert';

const PORT = process.env.PORT || 3000;
const baseUrl = `http://localhost:${PORT}/api/v1`;

interface ProblemResponse {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

interface OrderResponse {
  id: string;
  account_id: string;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  total_cents: number;
  status: string;
}

interface InstrumentListResponse {
  items: Array<{ symbol: string; company_name: string }>;
  next_cursor: string | null;
}

async function runTests(): Promise<void> {
  console.log(`\n🧪 Запуск контрактних тестів Варіанта Б проти сервера на ${baseUrl}...\n`);

  // Тест 1: POST /orders без Idempotency-Key -> 400 problem+json
  console.log("Тест 1: POST /orders без Idempotency-Key...");
  const res1 = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'MARKET',
      quantity: 10,
    }),
  });

  const body1 = (await res1.json()) as ProblemResponse;
  assert.strictEqual(res1.status, 400, 'Очікуємо статус 400');
  assert.strictEqual(
    res1.headers.get('content-type'),
    'application/problem+json; charset=utf-8',
    'Content-Type має бути application/problem+json',
  );
  console.log('  -> Статус:', res1.status, 'detail:', body1.detail);
  assert.ok(
    body1.detail.includes("idempotency-key"),
    `Detail має містити згадку про idempotency-key, отримано: ${body1.detail}`,
  );

  // Тест 2: POST /orders з невалідним quantity (0) -> 400 problem+json
  console.log("Тест 2: POST /orders із невалідним quantity (0)...");
  const res2 = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    },
    body: JSON.stringify({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0,
    }),
  });

  assert.strictEqual(res2.status, 400, 'Очікуємо статус 400');
  const body2 = (await res2.json()) as ProblemResponse;
  console.log('  -> Статус 400, detail:', body2.detail);
  assert.ok(
    body2.detail.includes('quantity'),
    `Detail має містити помилку валідації quantity, отримано: ${body2.detail}`,
  );

  // Тест 3: POST /orders валідний запит -> 201 Created
  console.log("Тест 3: Валідний POST /orders...");
  const validKey = '11111111-2222-3333-4444-555555555555';
  const validPayload = {
    symbol: 'AAPL',
    side: 'BUY',
    type: 'MARKET',
    quantity: 5,
  };

  const res3 = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': validKey,
    },
    body: JSON.stringify(validPayload),
  });

  assert.strictEqual(res3.status, 201, 'Очікуємо статус 201');
  const body3 = (await res3.json()) as OrderResponse;
  console.log('  -> Статус 201, створено ордер id:', body3.id, 'total_cents:', body3.total_cents);
  assert.strictEqual(body3.symbol, 'AAPL');
  assert.strictEqual(body3.quantity, 5);

  // Тест 4: Повтор того самого Idempotency-Key + того самого тіла -> 201 + Idempotency-Replay: true
  console.log("Тест 4: Повтор Idempotency-Key з тим самим тілом...");
  const res4 = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': validKey,
    },
    body: JSON.stringify(validPayload),
  });
  assert.strictEqual(res4.status, 201);
  assert.strictEqual(res4.headers.get('idempotency-replay'), 'true');
  console.log('  -> Статус 201, заголовок Idempotency-Replay:', res4.headers.get('idempotency-replay'));

  // Тест 5: Той самий Idempotency-Key з іншим тілом -> 422 Unprocessable Entity
  console.log("Тест 5: Той самий Idempotency-Key з іншим тілом...");
  const res5 = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': validKey,
    },
    body: JSON.stringify({
      symbol: 'TSLA',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
    }),
  });
  assert.strictEqual(res5.status, 422);
  const body5 = (await res5.json()) as ProblemResponse;
  console.log('  -> Статус 422, detail:', body5.detail);

  // Тест 6: Cursor-пагінація GET /instruments
  console.log("Тест 6: Cursor-пагінація GET /instruments?limit=2...");
  const res6 = await fetch(`${baseUrl}/instruments?limit=2`);
  assert.strictEqual(res6.status, 200);
  const body6 = (await res6.json()) as InstrumentListResponse;
  assert.strictEqual(body6.items.length, 2);
  assert.ok(body6.next_cursor !== null, 'Очікуємо наявність next_cursor');
  console.log('  -> Отримано items:', body6.items.length, 'next_cursor:', body6.next_cursor);

  // Тест 7: POST /orders із зайвим полем hacker_field -> 400 problem+json (additionalProperties: false)
  console.log("Тест 7: POST /orders із зайвим полем hacker_field...");
  const res7 = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': '77777777-7777-7777-7777-777777777777',
    },
    body: JSON.stringify({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
      hacker_field: 'exploit',
    }),
  });
  assert.strictEqual(res7.status, 400, 'Очікуємо статус 400 для зайвого поля');
  const body7 = (await res7.json()) as ProblemResponse;
  console.log('  -> Статус 400, detail:', body7.detail);
  assert.ok(
    body7.detail.includes('hacker_field') || body7.detail.includes('additional'),
    `Detail має сигналізувати про невідоме поле: ${body7.detail}`,
  );

  // Тест 8: Cursor-пагінація GET /orders?limit=2
  console.log("Тест 8: Cursor-пагінація GET /orders?limit=2...");
  const res8 = await fetch(`${baseUrl}/orders?limit=2`);
  assert.strictEqual(res8.status, 200);
  const body8 = (await res8.json()) as { items: OrderResponse[]; next_cursor: string | null };
  assert.strictEqual(body8.items.length, 2, 'Має повернути рівно limit=2 ордерів');
  assert.ok(body8.next_cursor !== null, 'Очікуємо наявність next_cursor при наявності наступних ордерів');
  console.log('  -> Отримано items:', body8.items.length, 'next_cursor:', body8.next_cursor);

  console.log("\n✅ Усі тести Варіанта Б успішно пройдено!\n");
}

runTests().catch((err: Error) => {
  console.error("❌ Тест завалився:", err);
  process.exit(1);
});
