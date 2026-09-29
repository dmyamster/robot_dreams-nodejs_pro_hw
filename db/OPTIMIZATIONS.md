# Звіт з оптимізації дата-шару (EXPLAIN ANALYZE & BUFFERS)

У цьому звіті наведено результати бенчмаркінгу та оптимізації бази даних Paper Trading Broker API на реалістичному обсязі даних (150,000 рядків у головній таблиці `orders` та 120,000 рядків у каталозі продуктів `products`).

---

## Запит 1: Історія ордерів акаунта за період (q1.sql)

**Запит:**
```sql
SELECT id, account_id, product_id, side, type, status, quantity, total_amount, created_at
FROM orders
WHERE account_id = '00000000-0000-0000-0002-000000000001'
  AND created_at >= '2026-08-01 00:00:00+00'
  AND created_at < '2026-09-01 00:00:00+00'
ORDER BY created_at DESC
```

### EXPLAIN (ANALYZE, BUFFERS) ДО створення індексів:
```text
 Gather Merge  (cost=5439.14..5439.37 rows=2 width=77) (actual time=7.186..8.438 rows=4 loops=1)
   Workers Planned: 1
   Workers Launched: 1
   Buffers: shared hit=2932
   ->  Sort  (cost=4439.13..4439.13 rows=2 width=77) (actual time=6.045..6.045 rows=2 loops=2)
         Sort Key: created_at DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=2932
         Worker 0:  Sort Method: quicksort  Memory: 25kB
         ->  Parallel Seq Scan on orders  (cost=0.00..4439.12 rows=2 width=77) (actual time=4.817..5.983 rows=2 loops=2)
               Filter: ((created_at >= '2026-08-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-09-01 00:00:00+00'::timestamp with time zone) AND (account_id = '00000000-0000-0000-0002-000000000001'::uuid))
               Rows Removed by Filter: 74998
               Buffers: shared hit=2895
 Planning:
   Buffers: shared hit=126
 Planning Time: 0.455 ms
 Execution Time: 8.519 ms
```

### EXPLAIN (ANALYZE, BUFFERS) ПІСЛЯ створення індексу:
```text
 Sort  (cost=20.13..20.14 rows=4 width=77) (actual time=0.071..0.071 rows=4 loops=1)
   Sort Key: created_at DESC
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=7 read=3
   ->  Bitmap Heap Scan on orders  (cost=4.47..20.09 rows=4 width=77) (actual time=0.041..0.051 rows=4 loops=1)
         Recheck Cond: ((account_id = '00000000-0000-0000-0002-000000000001'::uuid) AND (created_at >= '2026-08-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-09-01 00:00:00+00'::timestamp with time zone))
         Heap Blocks: exact=4
         Buffers: shared hit=4 read=3
         ->  Bitmap Index Scan on idx_orders_account_created_at  (cost=0.00..4.47 rows=4 width=0) (actual time=0.033..0.034 rows=4 loops=1)
               Index Cond: ((account_id = '00000000-0000-0000-0002-000000000001'::uuid) AND (created_at >= '2026-08-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-09-01 00:00:00+00'::timestamp with time zone))
               Buffers: shared read=3
 Planning:
   Buffers: shared hit=168 read=2
 Planning Time: 0.608 ms
 Execution Time: 0.143 ms
```

**Пояснення змін:**
У вузол плану встав індекс `idx_orders_account_created_at` (Bitmap Index Scan on idx_orders_account_created_at). Завдяки складеному B-tree індексу за ключами `(account_id, created_at DESC)` з плану повністю зник важкий вузол `Parallel Seq Scan on orders`, а кількість прочитаних сторінок буферів скоротилася з 2932 до 10 (падіння навантаження на I/O у ~290 разів, а час виконання скоротився з 8.519 ms до 0.143 ms — прискорення у ~60 разів).

---

## Запит 2: Черга PENDING заявок для воркера матчингу (q2.sql)

**Запит:**
```sql
SELECT id, account_id, product_id, side, quantity, limit_price, created_at
FROM orders
WHERE status = 'PENDING'
ORDER BY created_at ASC
LIMIT 50
```

### EXPLAIN (ANALYZE, BUFFERS) ДО створення індексів:
```text
 Limit  (cost=4822.15..4822.28 rows=50 width=61) (actual time=9.463..9.469 rows=50 loops=1)
   Buffers: shared hit=2898
   ->  Sort  (cost=4822.15..4826.08 rows=1570 width=61) (actual time=9.462..9.464 rows=50 loops=1)
         Sort Key: created_at
         Sort Method: top-N heapsort  Memory: 31kB
         Buffers: shared hit=2898
         ->  Seq Scan on orders  (cost=0.00..4770.00 rows=1570 width=61) (actual time=0.011..9.271 rows=1500 loops=1)
               Filter: ((status)::text = 'PENDING'::text)
               Rows Removed by Filter: 148500
               Buffers: shared hit=2895
 Planning:
   Buffers: shared hit=120
 Planning Time: 0.465 ms
 Execution Time: 9.497 ms
```

### EXPLAIN (ANALYZE, BUFFERS) ПІСЛЯ створення індексу:
```text
 Limit  (cost=0.28..3.03 rows=50 width=61) (actual time=0.037..0.089 rows=50 loops=1)
   Buffers: shared hit=50 read=2
   ->  Index Scan using idx_orders_pending on orders  (cost=0.28..84.15 rows=1525 width=61) (actual time=0.036..0.084 rows=50 loops=1)
         Buffers: shared hit=50 read=2
 Planning:
   Buffers: shared hit=153
 Planning Time: 0.556 ms
 Execution Time: 0.107 ms
```

**Пояснення змін:**
У вузол плану став частковий індекс `idx_orders_pending` (Index Scan using idx_orders_pending on orders). Частковий індекс зберігає впорядковані записи лише для 1% рядків зі статусом `PENDING`, що дозволило позбутися вузлів `Seq Scan on orders` (який відфільтровував 148,500 рядків) та `Sort top-N heapsort`: база одразу знімає перші 50 відсортованих рядків безпосередньо з індексу, скоротивши buffers з 2898 до 52, а час виконання з 9.497 ms до 0.107 ms (прискорення у ~88 разів).

---

## Запит 3: Пошук інструменту за тікером без урахування регістру (q3.sql)

**Запит:**
```sql
SELECT id, symbol, name, sector, current_price
FROM products
WHERE lower(symbol) = 'aapl'
```

### EXPLAIN (ANALYZE, BUFFERS) ДО створення індексів:
```text
 Seq Scan on products  (cost=0.00..11835.00 rows=600 width=91) (actual time=0.013..25.202 rows=1 loops=1)
   Filter: (lower((symbol)::text) = 'aapl'::text)
   Rows Removed by Filter: 119999
   Buffers: shared hit=10035
 Planning:
   Buffers: shared hit=89
 Planning Time: 0.348 ms
 Execution Time: 25.242 ms
```

### EXPLAIN (ANALYZE, BUFFERS) ПІСЛЯ створення індексу:
```text
 Index Scan using idx_products_lower_symbol on products  (cost=0.42..8.44 rows=1 width=91) (actual time=0.017..0.017 rows=1 loops=1)
   Index Cond: (lower((symbol)::text) = 'aapl'::text)
   Buffers: shared hit=1 read=3
 Planning:
   Buffers: shared hit=125 read=1
 Planning Time: 0.383 ms
 Execution Time: 0.049 ms
```

**Пояснення змін:**
У вузол плану став функціональний індекс `idx_products_lower_symbol` (Index Scan using idx_products_lower_symbol on products). Оскільки звичайний B-Tree індекс за колонкою ігнорується виразом `lower()`, створення expression-індексу ліквідувало повне сканування таблиці `Seq Scan on products` на 120,000 рядків, скоротивши звернення до буферів з 10,035 до 4 сторінок, а час виконання знизився з 25.242 ms до 0.049 ms (прискорення понад 500 разів).

---

## Запит 4: Повнотекстовий пошук по каталогу (q4.sql)

**Запит:**
```sql
SELECT id, name, ts_rank(search_vector, plainto_tsquery('simple', 'державні облігації')) AS rank
FROM products
WHERE search_vector @@ plainto_tsquery('simple', 'державні облігації')
ORDER BY rank DESC, id
LIMIT 20
```

### EXPLAIN (ANALYZE, BUFFERS) ДО створення індексів:
```text
 Limit  (cost=11536.83..11536.88 rows=20 width=71) (actual time=17.336..17.338 rows=20 loops=1)
   Buffers: shared hit=10041
   ->  Sort  (cost=11536.83..11536.99 rows=63 width=71) (actual time=17.335..17.336 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''державні'' & ''облігації'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 27kB
         Buffers: shared hit=10041
         ->  Seq Scan on products  (cost=0.00..11535.16 rows=63 width=71) (actual time=0.009..17.185 rows=1500 loops=1)
               Filter: (search_vector @@ '''державні'' & ''облігації'''::tsquery)
               Rows Removed by Filter: 118500
               Buffers: shared hit=10035
 Planning:
   Buffers: shared hit=115 read=9
 Planning Time: 0.519 ms
 Execution Time: 17.368 ms
```

### EXPLAIN (ANALYZE, BUFFERS) ПІСЛЯ створення індексу (прогрітий GIN-індекс):
```text
 Limit  (cost=303.13..303.18 rows=20 width=71) (actual time=0.608..0.610 rows=20 loops=1)
   Buffers: shared hit=150
   ->  Sort  (cost=303.13..303.31 rows=72 width=71) (actual time=0.607..0.608 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''державні'' & ''облігації'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 27kB
         Buffers: shared hit=150
         ->  Bitmap Heap Scan on products  (cost=30.43..301.21 rows=72 width=71) (actual time=0.117..0.489 rows=1500 loops=1)
               Recheck Cond: (search_vector @@ '''державні'' & ''облігації'''::tsquery)
               Heap Blocks: exact=136
               Buffers: shared hit=144
               ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.41 rows=72 width=0) (actual time=0.103..0.103 rows=1500 loops=1)
                     Index Cond: (search_vector @@ '''державні'' & ''облігації'''::tsquery)
                     Buffers: shared hit=8
 Planning:
   Buffers: shared hit=164
 Planning Time: 0.473 ms
 Execution Time: 0.675 ms
```

**Пояснення змін:**
У вузол плану став повнотекстовий індекс `idx_products_search_vector` (Bitmap Index Scan on idx_products_search_vector). Вузол `Seq Scan on products` зник: GIN-індекс повертає бітову мапу сторінок, які містять обидва токени, внаслідок чого звернення до буферів скоротилися з 10,041 до 150 (зменшення навантаження на I/O у ~67 разів), а час виконання зменшився з 17.368 ms до 0.675 ms (прискорення у ~25 разів).

---

## Морфологія

Результати виконання пошуку для двох різних словоформ одного слова в базі даних:

```sql
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'облігації');
-- Результат: 6000

SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'облігацій');
-- Результат: 0
```

У базі зафіксовано 6000 збігів для базової форми «облігації» та 0 збігів для відмінка «облігацій».
Причина полягає в тому, що конфігурація `simple` у PostgreSQL лише переводить токени в нижній регістр та розбиває їх без урахування граматики і стемінгу, а серед 29 вбудованих словників PostgreSQL (`SELECT count(*) FROM pg_ts_config;` повертає 29) українська мова відсутня «з коробки», тому різні відмінкові форми залишаються незведеними до спільної основи різними лексемами. Підміна `simple` на конфігурацію `russian` є самообманом і не вирішує проблему, оскільки питомо українські закінчення, суфікси та лексика не відповідають російським правилам стемінгу Snowball і призводять до спотворених результатів пошуку в каталозі.
