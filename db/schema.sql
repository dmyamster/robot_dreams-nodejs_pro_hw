-- Course Project: Paper Trading Broker API Data Layer
-- db/schema.sql

DROP VIEW IF EXISTS instruments CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Користувачі платформи (інвестори та адміністратори)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'INVESTOR' CHECK (role IN ('INVESTOR', 'ADMIN')),
    is_verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Брокерські рахунки інвесторів (баланси в USD)
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_number VARCHAR(32) NOT NULL UNIQUE,
    cash_balance NUMERIC(18, 4) NOT NULL DEFAULT 10000.0000 CHECK (cash_balance >= 0),
    locked_balance NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (locked_balance >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Фінансові інструменти / Продукти каталогу біржі
CREATE TABLE products (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    symbol VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sector VARCHAR(64) NOT NULL,
    current_price NUMERIC(18, 4) NOT NULL CHECK (current_price > 0),
    trading_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (trading_status IN ('ACTIVE', 'HALTED')),
    logo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || description)) STORED
);

-- Синонім / View для доменної сумісності з контрактом OpenAPI (instruments)
CREATE VIEW instruments AS SELECT * FROM products;

-- 4. Торгові заявки / Ордери (Головна таблиця)
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    type VARCHAR(16) NOT NULL CHECK (type IN ('MARKET', 'LIMIT')),
    status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'FILLED', 'CANCELLED', 'REJECTED')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    limit_price NUMERIC(18, 4) CHECK (limit_price IS NULL OR limit_price > 0),
    execution_price NUMERIC(18, 4) CHECK (execution_price IS NULL OR execution_price > 0),
    fee NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (fee >= 0),
    total_amount NUMERIC(18, 4) NOT NULL CHECK (total_amount >= 0),
    idempotency_key VARCHAR(64) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Відкриті інвестиційні позиції в портфелі
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    shares_count INTEGER NOT NULL CHECK (shares_count >= 0),
    average_buy_price NUMERIC(18, 4) NOT NULL CHECK (average_buy_price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_positions_account_product UNIQUE (account_id, product_id)
);
