SELECT id, name, ts_rank(search_vector, plainto_tsquery('simple', 'державні облігації')) AS rank
FROM products
WHERE search_vector @@ plainto_tsquery('simple', 'державні облігації')
ORDER BY rank DESC, id
LIMIT 20
