-- Course Project: Paper Trading Broker API Optimization Indexes
-- db/indexes.sql

-- 1. Index for q1: Composite index for account order history in reverse chronological order
CREATE INDEX idx_orders_account_created_at ON orders (account_id, created_at DESC);

-- 2. Index for q2: Partial index for worker queue of pending orders
CREATE INDEX idx_orders_pending ON orders (created_at ASC) WHERE status = 'PENDING';

-- 3. Index for q3: Expression index for case-insensitive symbol lookup
CREATE INDEX idx_products_lower_symbol ON products (lower(symbol));

-- 4. Index for q4: Full-text search GIN index for product catalog
CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);
