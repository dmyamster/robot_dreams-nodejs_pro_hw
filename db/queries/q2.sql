SELECT id, account_id, product_id, side, quantity, limit_price, created_at
FROM orders
WHERE status = 'PENDING'
ORDER BY created_at ASC
LIMIT 50
