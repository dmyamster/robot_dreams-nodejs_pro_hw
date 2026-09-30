SELECT id, symbol, name, sector, current_price
FROM products
WHERE lower(symbol) = 'aapl'
