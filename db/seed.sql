-- Course Project: Paper Trading Broker API Data Layer
-- db/seed.sql

-- 1. Наповнення користувачів (5,000 рядків)
INSERT INTO users (id, email, password_hash, role, is_verified, created_at, updated_at)
SELECT
    ('00000000-0000-0000-0001-' || lpad(to_hex(i), 12, '0'))::uuid,
    'user_' || i || '@broker.example.com',
    '$2b$10$wT8K5s2yqC.7o1/8yH3Q0eYnFqYtP0p9X0e4vXb5qK8f1m2n3o4p5',
    CASE WHEN i = 1 THEN 'ADMIN' ELSE 'INVESTOR' END,
    true,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 123) % 15000000) * INTERVAL '1 second',
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 123) % 15000000) * INTERVAL '1 second'
FROM generate_series(1, 5000) AS s(i);

-- 2. Наповнення рахунків інвесторів (5,000 рядків)
INSERT INTO accounts (id, user_id, account_number, cash_balance, locked_balance, currency, created_at, updated_at)
SELECT
    ('00000000-0000-0000-0002-' || lpad(to_hex(i), 12, '0'))::uuid,
    ('00000000-0000-0000-0001-' || lpad(to_hex(i), 12, '0'))::uuid,
    'ACC-' || lpad(i::text, 8, '0'),
    (5000 + (i * 7) % 50000)::numeric(18, 4),
    ((i * 13) % 2000)::numeric(18, 4),
    'USD',
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 123) % 15000000) * INTERVAL '1 second',
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 123) % 15000000) * INTERVAL '1 second'
FROM generate_series(1, 5000) AS s(i);

-- 3. Наповнення каталогу фінансових інструментів / продуктів (120,000 рядків)
INSERT INTO products (symbol, name, description, sector, current_price, trading_status, logo_url, created_at, updated_at)
SELECT
    CASE
        WHEN i = 1 THEN 'AAPL'
        WHEN i = 2 THEN 'NVDA'
        WHEN i = 3 THEN 'MSFT'
        WHEN i = 4 THEN 'GOOGL'
        WHEN i = 5 THEN 'AMZN'
        WHEN i = 6 THEN 'TSLA'
        ELSE 'SEC' || i
    END,
    CASE
        -- 1.25% (1,500 записів) містять «державні» та «облігації»
        WHEN i <= 1500 THEN 'Державні облігації серії ' || i
        -- 3.75% (4,500 записів) містять «облігації», але не «державні»
        WHEN i <= 6000 THEN 'Корпоративні облігації підприємства ' || i
        -- Решта каталогу містить різноманітні фінансові інструменти українською мовою
        WHEN i % 5 = 0 THEN 'Акції технологічної корпорації ' || i
        WHEN i % 5 = 1 THEN 'Інвестиційний фонд розвитку ' || i
        WHEN i % 5 = 2 THEN 'Зелені сертифікати енергетики ' || i
        WHEN i % 5 = 3 THEN 'Військовий фонд підтримки ' || i
        ELSE 'Індексний контракт ринку ' || i
    END,
    CASE
        WHEN i <= 1500 THEN 'Облігації внутрішньої державної позики з фіксованим купоном та державною гарантією повернення'
        WHEN i <= 6000 THEN 'Облігації комерційного емітента для фінансування капітальних інвестицій та розвитку виробництва'
        WHEN i % 5 = 0 THEN 'Прості іменні акції для довгострокового інвестування та отримання дивідендних виплат'
        WHEN i % 5 = 1 THEN 'Сертифікати пайового фонду для диверсифікації портфеля та зниження ризиків'
        WHEN i % 5 = 2 THEN 'Екологічні фінансові активи для підтримки відновлюваних джерел енергії'
        WHEN i % 5 = 3 THEN 'Цільові фінансові запозичення для забезпечення стабільності національної економіки'
        ELSE 'Похідний фінансовий інструмент на базі зведеного ринкового індексу ліквідних активів'
    END,
    (ARRAY['Technology', 'Financial', 'Energy', 'Healthcare', 'Consumer', 'Industrial'])[1 + (i % 6)],
    (10 + (i * 13) % 5000 + ((i % 99) * 0.01))::numeric(18, 4),
    CASE WHEN i % 200 = 0 THEN 'HALTED' ELSE 'ACTIVE' END,
    'https://storage.example.com/logos/sec' || i || '.png',
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 147) % 20000000) * INTERVAL '1 second',
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 147) % 20000000) * INTERVAL '1 second'
FROM generate_series(1, 120000) AS s(i);

-- 4. Наповнення торгових заявок / ордерів (150,000 рядків)
INSERT INTO orders (id, account_id, product_id, side, type, status, quantity, limit_price, execution_price, fee, total_amount, idempotency_key, created_at, updated_at)
SELECT
    gen_random_uuid(),
    ('00000000-0000-0000-0002-' || lpad(to_hex(((i - 1) % 5000) + 1), 12, '0'))::uuid,
    ((i * 17) % 120000) + 1,
    CASE WHEN i % 2 = 0 THEN 'BUY' ELSE 'SELL' END,
    CASE WHEN i % 3 = 0 THEN 'LIMIT' ELSE 'MARKET' END,
    -- Реалістичний перекіс статусів: 80% FILLED, 15% CANCELLED, 4% REJECTED, 1% PENDING
    CASE
        WHEN i % 100 = 0 THEN 'PENDING'
        WHEN i % 100 < 5 THEN 'REJECTED'
        WHEN i % 100 < 20 THEN 'CANCELLED'
        ELSE 'FILLED'
    END,
    1 + (i % 500),
    CASE WHEN i % 3 = 0 THEN (50 + (i % 200))::numeric(18, 4) ELSE NULL END,
    (50 + (i % 200))::numeric(18, 4),
    (1.50 + ((i % 10) * 0.1))::numeric(18, 4),
    ((1 + (i % 500)) * (50 + (i % 200)) + 1.50)::numeric(18, 4),
    'idemp-key-' || i,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 153) % 23000000) * INTERVAL '1 second',
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 153) % 23000000 + 60) * INTERVAL '1 second'
FROM generate_series(1, 150000) AS s(i);

-- 5. Наповнення позицій у портфелях інвесторів (20,000 рядків)
INSERT INTO positions (account_id, product_id, shares_count, average_buy_price, created_at, updated_at)
SELECT
    ('00000000-0000-0000-0002-' || lpad(to_hex(((i - 1) % 4000) + 1), 12, '0'))::uuid,
    ((i * 23) % 120000) + 1,
    10 + (i % 1000),
    (50 + (i % 200))::numeric(18, 4),
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 100) % 20000000) * INTERVAL '1 second',
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((i * 100) % 20000000) * INTERVAL '1 second'
FROM generate_series(1, 20000) AS s(i)
ON CONFLICT (account_id, product_id) DO NOTHING;

-- 6. Оновлення статистики та visibility map
VACUUM (ANALYZE);
