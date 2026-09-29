SELECT id, account_id, product_id, side, type, status, quantity, total_amount, created_at
FROM orders
WHERE account_id = '00000000-0000-0000-0002-000000000001'
  AND created_at >= '2026-08-01 00:00:00+00'
  AND created_at < '2026-09-01 00:00:00+00'
ORDER BY created_at DESC
