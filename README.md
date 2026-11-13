# Paper Trading Broker API

---

## 1. Що це за сервіс

Бекенд-платформа віртуального фондового брокера для симуляції торгівлі реальними акціями ринку США (S&P 500, NASDAQ) без фінансового ризику. Сервіс створений для інвесторів-початківців і трейдерів, вирішуючи проблему високого фінансового порогу та психологічного бар'єра входу в ринок через надання повноцінного симулятора: віртуальний стартовий депозит $10,000 USD, виконання ринкових і лімітних ордерів на базі реальних котирувань, розрахунок нереалізованого PnL портфеля та генерація брокерських звітів.

**User stories:**

1. Як **Investor**, я хочу зареєструватися й отримати стартовий віртуальний рахунок на $10,000 USD, щоб мати капітал для інвестування без ризику реальних грошей.
2. Як **Investor**, я хочу виставити ордер (Market або Limit) на купівлю/продаж акцій (наприклад, AAPL або NVDA), щоб відкрити або закрити позицію за бажаною ціною.
3. Як **Investor**, я хочу бачити свій портфель із розрахунком прибутку/збитку (PnL) у реальному часі та отримувати сповіщення, коли мій ордер виконано.
4. Як **Investor**, я хочу завантажити PDF-виписку по рахунку (Account Statement) за вибраний період, щоб проаналізувати ефективність угод.
5. Як **Admin**, я хочу мати змогу призупинити торги окремим активом (halt trading) та переглядати аудиторський лог транзакцій для контролю за платформою.

## 2. Домен

Сутності стануть ресурсами в OpenAPI (ДЗ#9) і таблицями в схемі (ДЗ#12).
Тому називай їх зараз так, як готовий жити з ними три місяці.

| Сутність            | Що зберігає                                                                                                                                                                                                         | Ключові звʼязки                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **User**            | Профіль, хеш пароля, роль (`INVESTOR`, `ADMIN`), статус верифікації                                                                                                                 | `User 1──1 Account`, `User 1──n Order`                                                                     |
| **Account**         | Фінансовий рахунок: вільна готівка (`cash_balance`), заблокована готівка (`locked_balance`), валюта (USD)                                                                           | `Account 1──1 User`, `Account 1──n Position`, `Account 1──n Order`                                         |
| **StockInstrument** | Тікер (`symbol`: AAPL), назва компанії, сектор, поточна ціна (`current_price`), статус торгів (`trading_status`), логотип                                                           | `StockInstrument 1──n Order`, `StockInstrument 1──n Position`                                              |
| **Order**           | Торгова заявка та виконання: тип (`BUY`/`SELL`), вид (`MARKET`/`LIMIT`), кількість, лімітна ціна, ціна виконання (`execution_price`), комісія, статус (`PENDING`, `FILLED`, `CANCELLED`), `idempotency_key`     | `Order n──1 Account`, `Order n──1 StockInstrument`                                                         |
| **Position**        | Відкрита частка акцій у портфелі: кількість акцій (`shares_count`), середня ціна входу (`average_buy_price`)                                                                        | `Position n──1 Account`, `Position n──1 StockInstrument` (композитний ключ `account_id` + `instrument_id`) |

```
Схема звʼязків (текстом теж годиться):

User 1──1 Account 1──n Position n──1 StockInstrument
            │                          │
            └──n Order ────────────────┘
```

### Перевірка домену

🔴 **Заповнити ПЕРШИМ.** Не закриваються 2+ рядки — міняй домен, поки дешево.
Ці властивості потрібні конкретним ДЗ; домен без них ламається аж на 12-й лекції.

| Потрібно                             | Що це у мене                                                                                    | Де знадобиться                   | ✓   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------- | --- |
| ≥ 2 ролі з різними правами           | `INVESTOR` (торгівля, свій портфель) vs `ADMIN` (додавання тікерів, halt торгів, аудит)         | #24 RBAC                         | ☑   |
| Обмежений ресурс, за який конкурують | Вільний баланс готівки (`cash_balance`) при паралельних ордерах; доступна квота акцій в пулі    | #14 транзакція під навантаженням | ☑   |
| Операція з незворотним ефектом       | Виконання угоди (переведення Order у `FILLED`): списання грошей, нарахування акцій, комісія      | #22 outbox + idempotency         | ☑   |
| Подія, про яку треба сповістити      | Ордер виконано (`ORDER_FILLED`), зміна ціни акції (realtime WS); звіт сформовано (email/черга)  | #18 realtime · #19 черга         | ☑   |
| Сутність із файлами                  | Логотипи компаній (`StockInstrument.logo_url`), брокерські PDF-виписки (`AccountStatement`)     | #26 S3 presigned                 | ☑   |
| Дані «часто читають, рідко пишуть»   | Довідник інструментів (тікери, метадані акцій, сектори) та денні ціни закриття                  | #23 cache-aside                  | ☑   |
| 4–6 сутностей зі звʼязками           | 5 сутностей (`User`, `Account`, `StockInstrument`, `Order`, `Position`)                         | #12 схема · #13 entities         | ☑   |

## 3. Архітектурні рішення

Формат кожного пункту: **рішення → чому → що це ускладнює**.
«Обрав Postgres» — не рішення. «Обрав Postgres, бо потрібні транзакції при
декременті залишку, а eventual consistency коштувала б овербукінгом» — рішення.

| Питання        | Рішення                                                                 | Чому саме так                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compute model  | Modular Monolith на NestJS + TypeScript                                 | Вимога курсу. Чіткі межі модулів (`auth`, `accounts`, `trading`, `market-data`, `reporting`) в єдиному репозиторії. Усуває оверхед мережевих викликів і розподілених транзакцій (2PC/Saga), але дозволяє легко винести сервіс звітності або матчингу окремо в майбутньому. Ускладнює контроль за тим, щоб не імпортувати напряму репозиторії між чужими модулями. |
| База даних     | PostgreSQL + TypeORM (дефолт курсу)                                     | Потрібна строга ACID-узгодженість і рівні ізоляції для фінансових проводок. Механізм `SELECT FOR UPDATE` гарантує відсутність овердрафту при списанні балансу під навантаженням (#14), а `SKIP LOCKED` — для пулу воркерів. Ускладнює масштабування записів у разі мільйонів котирувань на секунду (вимагає шардування/партиціонування). |
| Асинхронність  | RabbitMQ (для бізнес-подій) + Redis/BullMQ (для scheduled jobs)          | RabbitMQ для надійної доставки та роутингу асинхронних подій домену (`order.placed`, `order.filled`) на ДЗ#19. Redis + BullMQ на ДЗ#23 для відкладених фонових задач (генерація PDF-звітів, retries). Ускладнює інфраструктуру необхідністю підтримувати два різних сервіси повідомлень у Docker/K8s.                                            |
| Автентифікація | JWT (Access + Refresh rotation) + RBAC guards                           | Stateless валідація токенів у запитах до API з ротацією refresh-токенів (секрети у сховищі Infisical за правилами #11, #24), легка інтеграція з WebSocket handshakes. Ускладнює миттєве анулювання доступу (вимагає token blacklist у Redis для розлогіну).                                                                                            |
| Deploy         | Docker multi-stage → K8s (AWS EKS/RDS через Pulumi IaC)                 | Відповідає вимогам #28, #31, #32. Локально — Docker Compose. У хмарі — деклартивна інфраструктура на AWS (VPC, RDS, ALB, EKS) через код на Pulumi та деплой через GitHub Actions з AWS OIDC. Ускладнює конфігурацію маніфестів і час налаштування CI/CD пайплайну.                                                                               |

**Де мені знадобляться транзакції:**
У момент переводу ордера в статус `FILLED` (Trade Settlement): в одній атомарній транзакції з `SELECT FOR UPDATE` ми перевіряємо та списуємо `locked_balance`/`cash_balance`, оновлюємо `Order` (фіксуємо `execution_price`, `fee`, `status = 'FILLED'`), оновлюємо або створюємо запис у `Position` (зміна кількості акцій і перерахунок середньої ціни `average_buy_price`), та записуємо подію в `Outbox`-таблицю. Якщо хоча б один крок впаде — відкочується вся операція. Також на ДЗ#14 воркер-пул використовує `SELECT ... FOR UPDATE SKIP LOCKED` для паралельного розбору черги заявок у статусі `PENDING`.

**Яка подія піде через чергу першою:**
`order.placed` (а згодом `order.filled`): подія публікується в RabbitMQ exchange після коміту транзакції через Transactional Outbox і потрапляє до консьюмерів: 1) пуш у WebSocket клієнту, 2) запуск асинхронного розрахунку оновленого PnL портфеля.

**Ролі та їхні права:**

- `INVESTOR`: читання публічного списку акцій, перегляд свого рахунку (`Account`), створення та скасування власних ордерів (`Order`), перегляд своїх позицій (`Position`), замовлення своєї виписки (`AccountStatement`). Заборонено доступ до чужих рахунків та адмін-функцій.
- `ADMIN`: повний доступ до читання всіх ресурсів, додавання та редагування тікерів (`StockInstrument`), примусова зупинка/відновлення торгів інструментом (`HALT` / `RESUME`), перегляд загального аудиторського логу транзакцій (`TransactionAuditLog`).

## 4. Trade-offs — що я свідомо НЕ роблю

Найважливіший розділ. Рішення без відкинутих альтернатив — це не рішення,
а перелік технологій.

| Відкинув                                                                     | Чому                                                                                                                                                                                                                       | За яких умов повернувся б                                                                                                                                          |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Мікросервісна архітектура** (розбиття на 4 сервіси)                        | Призвела б до розподілених транзакцій (Saga), мережевого latency та ускладнення локального девелопменту на старті з 17 ДЗ. Модульний моноліт повністю покриває навантаження навчального проєкту.                           | Якщо команда розростеться до кількох автономних команд або сервіс біржового матчингу почне вимагати незалежного автомасштабування через екстремальне навантаження. |
| **NoSQL (MongoDB)**                                                          | У фінансовому додатку неприпустима Eventual Consistency. Будь-який збій або неатомарне оновлення балансу веде до фінансових дірок.                                                                                         | Якби проєкт зберігав неструктуровані потокові логи біржових тіків (time-series ticks) або клікстрім-аналітику поведінки користувачів.                              |
| **Повноцінний Order Matching Engine в оперативній пам'яті (LMAX Disruptor)** | Реалізація повного біржового стакану (Order Book) у пам'яті на C++/Rust або чистих бінарних структурах зайняла б занадто багато часу і змістила фокус із розробки Node.js API на алгоритми матчингу.                       | Якщо буде вимога підтримувати від 50,000 операцій матчингу на секунду з субмілісекундним SLA.                                                                      |
| **Пряма інтеграція з платною біржею (Nasdaq / Bloomberg API)**               | Вимагає дорогих платних підписок, складної верифікації та створює ризик падіння локальних тестів через збої зовнішньої мережі. Замість цього використовуємо сиди через безкоштовний `yahoo-finance2` та локальні фікстури. | Якщо проєкт перейде у фазу production для реальних торгів справжніми грошима.                                                                                      |
| **Збереження грошей у типах `FLOAT / NUMBER` JavaScript**                    | Похибки округлення чисел з плаваючою комою (IEEE 754) у фінансових операціях призводять до втрати центів. Використовуємо рядок або `BigInt` на рівні додатка та `NUMERIC(18, 4)` у PostgreSQL.                             | Ніколи в розрахунках балансів і грошей. Float допустимий лише для відображення відсотків у UI.                                                                     |

**Найбільший ризик мого вибору:**
Конкурентні блокування рядків `SELECT ... FOR UPDATE` в PostgreSQL при великому навантаженні можуть призводити до черг очікування на рівні БД (lock contention) або потенційних Deadlocks, якщо кілька транзакцій блокуватимуть ресурси в різному порядку (наприклад, рахунок і позицію).

**Як я помічу, що помилився:**
Зростання часу відповіді ендпоінтів створення ордерів (latency p99 > 1s), поява в логах помилок PostgreSQL `deadlock detected (SQLSTATE 40P01)` або вичерпання пулу з'єднань (`pool exhaustion`) під час навантажувального тестування на ДЗ#14.

---

## Запуск

## ДЗ #9: API Design та Контракт (Варіант Б на NestJS)

Для виконання контрактної частини обрано **Варіант Б (Runtime-валідація на кордоні)**, реалізований на повноцінному **NestJS + TypeScript**:
- OpenAPI 3.0.3 спека: `openapi/openapi.yaml` (2 ресурси: `/instruments`, `/orders`; 5 операцій, cursor-пагінація, `Idempotency-Key: required`, помилки RFC 7807 `application/problem+json`).
- Сервер на NestJS із підключеним `express-openapi-validator` middleware (`validateRequests: true`, `validateResponses: true`).
- Глобальний `ProblemExceptionFilter` перехоплює всі відхилення валідатора та винятки NestJS і віддає `application/problem+json`.
- Повна семантика ідемпотентності: повтор того самого ключа + тіла повертає раніше створений ордер та заголовок `Idempotency-Replay: true`, а той самий ключ з іншим тілом повертає `422 problem+json`.

## Запуск та перевірка

```bash
# 1. Встановлення залежностей
npm install

# 2. Повний запуск усіх перевірок (lint + структура + збірка + контрактні тести)
npm test

# 3. Окремі команди з Acceptance Criteria:
# Валідація спеки Redocly (exit code 0)
npm run lint:spec

# Перевірка структури спеки (≥5 операцій, ≥2 ресурси, Idempotency-Key required з описом ≥40 симв.)
npm run check:criteria

# Запуск NestJS сервера в режимі розробки
npm run start:dev

# Збірка та запуск продакшн-білду
npm run build
npm run start:prod
```

## Структура

- `openapi/openapi.yaml` — OpenAPI 3.0.3 специфікація контракту
- `src/main.ts` — точка входу запуску NestJS сервера
- `src/app.factory.ts` — фабрика створення NestJS додатку з валідатором та фільтрами
- `src/app.module.ts` — кореневий модуль додатку
- `src/instruments/` — контролер, сервіс і модуль для фінансових інструментів (акцій)
- `src/orders/` — контролер, сервіс і модуль для торгових заявок з підтримкою Idempotency-Key
- `src/common/filters/problem-exception.filter.ts` — фільтр винятків RFC 7807 problem+json
- `test/contract.test.ts` — контрактні e2e тести клієнта
- `test/check-criteria.ts` — скрипт перевірки Acceptance Criteria специфікації
- `test/run-all-tests.ts` — автономний тест-раннер (build + start + test)

---

---

## Configuration

У проєкті реалізовано централізоване керування конфігурацією з принципом **Fail-Fast** та динамічним оновленням секретів без рестарту застосунку:
- **process.env → Zod-схема (fail-fast) → ConfigService<Env, true> → код**
- **secrets/db_password → password: () => readFile() → pg.Pool → БД**

### Список змінних оточення

Усі змінні суворо описані у схемі `src/config/env.schema.ts`:

| Змінна | Тип | Обовʼязкова / Дефолт | Джерело | Опис |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | `enum('development', 'production', 'test')` | Дефолт: `development` | Оточення (`.env` / CLI) | Режим оточення застосунку |
| `PORT` | `number` (z.coerce) | Дефолт: `3000` | Оточення (`.env` / CLI) | TCP-порт HTTP-сервера |
| `DB_URL` | `string` | **Обовʼязкова** | **Сховище** (Infisical / secret store) | URL підключення до PostgreSQL (без секретів) |
| `DB_PASSWORD_PATH` | `string` | Дефолт: `./secrets/db_password` | Локальний файл / volume mount | Шлях до файлу із паролем до БД |

> **Секрети поза Git та Docker-образом**: Файл `.env` та каталог `secrets/` знаходяться у `.gitignore` та `.dockerignore`. У Git комітиться виключно файл-контракт `.env.example`.

### Контракт змінних (.env.example)

Файл `.env.example` виступає суворим контрактом. Будь-які зміни в `src/config/env.schema.ts` вимагають відповідного оновлення `.env.example`. Звірка здійснюється скриптом:
```bash
npm run check:env
```
Якщо будь-яка змінна відсутня у `.env.example`, команда завершується з кодом 1 і списком розбіжностей.

### Команди запуску

```bash
# 1. Підготовка локального середовища
cp .env.example .env
mkdir -p secrets && echo -n "super_secret_db_pass_123" > secrets/db_password

# 2. Перевірка синхронності контракту конфігурації
npm run check:env

# 3. Запуск локального PostgreSQL у Docker Compose
docker compose up -d

# 4. Збірка та запуск додатку
npm run start
# або для режиму розробки:
npm run start:dev
```

### Покрокова інструкція з ротації DB-пароля без рестарту

Пароль бази даних читається динамічно з файлу `secrets/db_password` на кожне нове підключення в `pg.Pool`. Ротація виконується без жодного простою чи перезапуску Node.js процесу:

1. **Перевірка доступності та фіксація uptime**:
   ```bash
   curl -i http://localhost:3000/health
   ```
   У відповіді буде повернено статус 200, стан бази `database: "connected"` та поточний час роботи процесу `uptime` (наприклад, `15.42`).

2. **Виконання скрипту ротації**:
   ```bash
   bash rotate.sh [новий_пароль_опціонально]
   ```
   Скрипт послідовно виконує 3 атомарні дії:
   - Змінює пароль користувача в PostgreSQL через `ALTER ROLE postgres WITH PASSWORD '...'`
   - Оновлює файл секрету `secrets/db_password`
   - Примусово закриває старі зʼєднання через `pg_terminate_backend` (пул перехоплює подію `error` без аварійного падіння процесу)

3. **Перевірка успішності ротації**:
   ```bash
   curl -i http://localhost:3000/health
   ```
   Наступний запит створює нове зʼєднання до БД, використовуючи щойно оновлений файл `secrets/db_password`. Запит повертає `200 OK`, `database: "connected"`, а значення `uptime` збільшилося відносно кроку 1, підтверджуючи, що процес не перезапускався.

> **Примітка**: Якщо виконати `docker compose down -v`, Postgres буде скинуто до початкового стану. У такому разі поверніть початковий пароль у файл: `echo -n "super_secret_db_pass_123" > secrets/db_password`.

---

## ДЗ #12: Дата-шар під навантаженням (Схема, Seed, Індекси, Пошук)

У цьому завданні реалізовано та протестовано продуктивний дата-шар PostgreSQL для домену **Paper Trading Broker API**:
- Схема (`db/schema.sql`): 5 таблиць (`users`, `accounts`, `products`, `orders`, `positions`), 5 звʼязків `FOREIGN KEY`, суворі типи (`NUMERIC(18, 4)` для фінансів, `TIMESTAMPTZ`), генерована колонка `search_vector tsvector GENERATED ALWAYS AS (...) STORED` та сумісний view `instruments`.
- Обсяг даних (`db/seed.sql`): 150,000 рядків у головній таблиці `orders` та 120,000 рядків у каталозі `products`. Реалістичний перекіс статусів: 80% `FILLED`, 15% `CANCELLED`, 4% `REJECTED`, 1% `PENDING`. Текстові описи українською мовою та завершальний `VACUUM (ANALYZE);`.
- Оптимізація (`db/indexes.sql`): композитний B-Tree, partial index для статусу `PENDING`, expression index для `lower(symbol)` та GIN індекс для `search_vector`.
- Звіт (`db/OPTIMIZATIONS.md`): повні виводи `EXPLAIN (ANALYZE, BUFFERS)` до та після, аналіз планів і розділ дослідження морфології.

### Швидкий запуск стенда (свіжий клон)

**Підняти базу:**
```bash
docker compose up -d --wait
```

**Підключитись:**
```bash
docker compose exec -T postgres psql -U postgres -d broker_db
```

*(Або через локальний клієнт psql: `PGPASSWORD=super_secret_db_pass_123 psql -h localhost -p 5432 -U postgres -d broker_db`)*

### Назви таблиць для перевірки обсягу (≥ 100 000 рядків)

- **Головна таблиця:** `orders` (150,000 рядків)
- **Таблиця каталогу та пошуку (q4):** `products` (120,000 рядків, доступна також через view `instruments`)

### Відтворення повного циклу перевірки

```bash
# 1. Застосування схеми (5 таблиць, 5 FK, generated search_vector, view)
docker compose exec -T postgres psql -U postgres -d broker_db -f db/schema.sql

# 2. Наповнення даними (150k orders, 120k products, перекіс статусів + VACUUM ANALYZE)
docker compose exec -T postgres psql -U postgres -d broker_db -f db/seed.sql

# 3. EXPLAIN (ANALYZE, BUFFERS) ДО створення індексів (усі 4 запити містять Seq Scan)
docker compose exec -T postgres psql -U postgres -d broker_db -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q1.sql)"
docker compose exec -T postgres psql -U postgres -d broker_db -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q2.sql)"
docker compose exec -T postgres psql -U postgres -d broker_db -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q3.sql)"
docker compose exec -T postgres psql -U postgres -d broker_db -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q4.sql)"

# 4. Створення індексів та оновлення статистики
docker compose exec -T postgres psql -U postgres -d broker_db -f db/indexes.sql
docker compose exec -T postgres psql -U postgres -d broker_db -c "ANALYZE;"

# 5. EXPLAIN (ANALYZE, BUFFERS) ПІСЛЯ створення індексів (індексні скани, жодного Seq Scan)
docker compose exec -T postgres psql -U postgres -d broker_db -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q1.sql)"
docker compose exec -T postgres psql -U postgres -d broker_db -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q2.sql)"
docker compose exec -T postgres psql -U postgres -d broker_db -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q3.sql)"
docker compose exec -T postgres psql -U postgres -d broker_db -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q4.sql)"
```

### Команди перевірки Acceptance Criteria

```bash
# Схема та Foreign Keys (>= 3):
docker compose exec -T postgres psql -U postgres -d broker_db -Atc "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public';"

# Обсяг головної таблиці orders (>= 100000):
docker compose exec -T postgres psql -U postgres -d broker_db -Atc "SELECT count(*) FROM orders;"

# Обсяг таблиці пошуку products (>= 100000):
docker compose exec -T postgres psql -U postgres -d broker_db -Atc "SELECT count(*) FROM products;"

# Перевірка на відсутність мертвих (невикористаних) індексів (порожній вивід):
docker compose exec -T postgres psql -U postgres -d broker_db -Atc "SELECT indexrelname FROM pg_stat_user_indexes WHERE schemaname='public' AND idx_scan = 0 AND indexrelid NOT IN (SELECT conindid FROM pg_constraint WHERE conindid <> 0);"

# Наявність partial або expression індексу (>= 1):
docker compose exec -T postgres psql -U postgres -d broker_db -Atc "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexdef NOT ILIKE '%USING gin%' AND (indexdef ILIKE '% WHERE %' OR indexdef ~ '\((\w+)\(');"

# GIN індекс за tsvector (>= 1):
docker compose exec -T postgres psql -U postgres -d broker_db -Atc "SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam JOIN pg_opclass o ON o.oid=i.indclass[0] WHERE am.amname='gin' AND o.opcintype='tsvector'::regtype;"
```

---

## Журнал рішень

Рішення змінилось — **не переписуй розділи вище**. Додай запис сюди.
Історія рішень на захисті цінніша за їхню акуратність: вона показує, що ти
розумієш, чому саме змінив.

- **2026-09-16 (ДЗ #0)**: Обрано домен **Paper Trading Broker API** з 5 сутностями (`User`, `Account`, `StockInstrument`, `Order`, `Position`). Зафіксовано архітектурні рішення (NestJS, PostgreSQL, RabbitMQ, Redis, K8s).
- **2026-09-16 (ДЗ #9)**: Спроєктовано контракт `openapi/openapi.yaml` (OpenAPI 3.0.3) для ресурсів `/instruments` та `/orders`. Обрано **Варіант Б** контрактної верифікації, реалізований на **NestJS + TypeScript** з використанням `express-openapi-validator` (`validateRequests: true`, `validateResponses: true`) та `ProblemExceptionFilter` (RFC 7807 `application/problem+json`). Реалізовано повну семантику `Idempotency-Key` із заголовком `Idempotency-Replay: true`.
- **2026-09-28 (ДЗ #11 / ДЗ #2 курсового проєкту)**: Наведено лад у конфігурації. Реалізовано єдину Zod-схему env (`src/config/env.schema.ts`) із fail-fast валідацією при старті через `ConfigModule.forRoot`, прямі звернення до `process.env` замінено на типізований `ConfigService<Env, true>`. Додано контракт `.env.example` та валідатор `scripts/check-env-example.mjs` (`npm run check:env`). Секрети винесено з Git (`.gitignore`) та шарів Docker-образу (`.dockerignore`, `Dockerfile`). Реалізовано ротацію пароля PostgreSQL без рестарту сервісу через `password: () => readFile()` у `pg.Pool`, обробку помилок завершення з'єднань пулу, скрипт `rotate.sh` та перевірочний ендпоінт `/health`.
- **2026-09-29 (ДЗ #12 / ДЗ #3 курсового проєкту)**: Спроєктовано та реалізовано дата-шар PostgreSQL для Paper Trading Broker API. Розроблено схему (`db/schema.sql` на 5 сутностей: `users`, `accounts`, `products`/`instruments`, `orders`, `positions` із 5 зовнішніми ключами, фінансовими типами `NUMERIC(18, 4)` та збереженою генерованою колонкою `search_vector tsvector STORED`). Написано seed-скрипт (`db/seed.sql`) з наповненням 150,000 ордерів та 120,000 фінансових інструментів українською мовою з реалістичними перекошеними розподілами та фінішним `VACUUM (ANALYZE);`. Підготовлено 4 повільні запити (`db/queries/q1..q4.sql`) та оптимізуючий набір індексів (`db/indexes.sql`: композитний B-Tree `(account_id, created_at DESC)`, partial index `WHERE status = 'PENDING'`, expression index `(lower(symbol))` та FTS GIN індекс на `search_vector`). Складено детальний звіт `db/OPTIMIZATIONS.md` з вимірами `EXPLAIN (ANALYZE, BUFFERS)` до та після (десятки й сотні разів прискорення, повне виключення Seq Scan, відсутність мертвих індексів) і дослідженням специфіки морфології української мови у PostgreSQL.
- **2026-09-29 (ДЗ #13 / ДЗ #4 курсового проєкту)**: Перенесення дата-шару в TypeORM. Реалізовано 5 сутностей (`User`, `Account`, `Product`, `Order`, `Position`), гроші переведено в цілі числа у мінорних одиницях (центи, `bigint`), налаштовано суворі `onDelete` стратегії (`CASCADE` для володіння даними користувача, `RESTRICT` для захисту фінансового аудиту активів). `synchronize: false` з початковою згенерованою міграцією (`src/migrations/1790687949981-InitialSchema.ts`). Створено ідемпотентний seed (`src/seed.ts`), демонстрацію лікування N+1 проблеми (`src/demo-nplus1.ts`), звіт ринкової аналітики через QueryBuilder (`src/report.ts`), інтеграцію зі сховищем секретів через `scripts/with-secrets.sh` із аварійним байпасом `SKIP_VAULT=1`.
- **2026-09-30 (ДЗ #14 / ДЗ #5 курсового проєкту)**: Реалізовано транзакційний checkout із захистом від oversell та overdraft, чергу фонових задач із паралельним розбором через воркер-пул на базі `FOR UPDATE SKIP LOCKED`, та retry-патерн для обробки транзакційних конфліктів серіалізації (SQLSTATE `40001` / `40P01`) з експоненційним backoff.
- **2026-09-30 (ДЗ #16 / ДЗ #6 курсового проєкту)**: Побудовано комплексну «драбинку довіри» (Testing Pyramid): integration suite на базі Testcontainers проти справжнього PostgreSQL 16-alpine з ізоляцією через TRUNCATE CASCADE та test data builders; наскрізний E2E happy path та негативні сценарії через Supertest без моків провайдерів; контрактне тестування через Pact (PactV3 consumer + provider verification проти живої OpenAPI-спеки з ДЗ #9); додано сервіс Pact Broker у compose та налаштовано CI-workflow з кроками publish → verify → can-i-deploy.

---

## ДЗ #13: TypeORM Data Layer (Entities, Migrations, Seed, N+1 Fix, QueryBuilder)

У цьому завданні схему БД з ДЗ #12 перенесено в ORM-рівень за правилами production:
1. **Entities (`src/entities/`)**:
   - `User` (`users`): первинний ключ UUID, унікальний email, хеш пароля, роль (`INVESTOR`, `ADMIN`), прапорець верифікації.
   - `Account` (`accounts`): брокерський рахунок, баланси (`cash_balance`, `locked_balance`) збережено як **integer у мінорних одиницях** (центи, `type: 'bigint'`), зв'язок `CASCADE` з `User`.
   - `Product` (`products`): тікер акції, назва, сектор, поточна ціна в центах (`current_price`), статус торгів (`ACTIVE`, `HALTED`).
   - `Order` (`orders`): торговельна заявка з фіксацією цін, кількості та комісії в центах, зв'язок `CASCADE` з `Account` та `RESTRICT` з `Product`, індекси `idx_orders_account_created_at` та partial `idx_orders_pending`.
   - `Position` (`positions`): явна join-entity між `Account` та `Product` з унікальним композитним обмеженням `(account_id, product_id)`, кількістю часток та середньою ціною придбання.

2. **Стратегії `onDelete`**:
   - `CASCADE`: використовується для зв'язків `Account -> User`, `Order -> Account`, `Position -> Account`. Коли видаляється користувач або рахунок, пов'язані з ним персональні записи та налаштування портфеля каскадно видаляються.
   - `RESTRICT`: використовується для зв'язків `Order -> Product` та `Position -> Product`. Забороняє видалення фінансового активу/продукту, якщо по ньому вже відкриті торгові заявки або існують частки в портфелях інвесторів, що гарантує цілісність аудиторського сліду (audit trail).

3. **Міграції замість synchronize**:
   - У `src/data-source.ts` встановлено `synchronize: false`.
   - Початкова схема згенерована через `typeorm migration:generate` у файл `src/migrations/1790687949981-InitialSchema.ts`.
   - Метод `down()` містить повноцінний відкат (зняття FK, видалення індексів та таблиць у зворотному порядку).

4. **Ідемпотентний Seed (`src/seed.ts`)**:
   - Створює детермінований набір: 10 користувачів, 10 рахунків, 10 інструментів ринку, 20 ордерів та 10 позицій.
   - Базується на `upsert` за фіксованими ідентифікаторами (`id`, `symbol`, `(accountId, productId)`). Повторний запуск не створює дублікатів і не падає.

5. **N+1: Демонстрація та лікування (`src/demo-nplus1.ts`)**:
   - Досліджено на графовому запиті: `Account` -> `orders` -> `product` (вибірка з 10 рахунків, 20 ордерів):

| Стратегія | Кількість запитів | Складність / Опис | Залежність від N |
| :--- | :---: | :--- | :--- |
| **наївно (запит у циклі)** | **31** | $\ge N$ ($1 + N + M = 1 + 10 + 20$) | Лінійно зростає з $N$ |
| **relations / leftJoinAndSelect** | **1** | $1$ (єдиний оптимізований SQL JOIN) | Константа (не залежить від $N$) |
| **relationLoadStrategy: 'query'** | **4** | $1 + 2 \times (\text{рівнів зв'язків}) = 4$ | Константа (не залежить від $N$) |

6. **QueryBuilder vs Repository (`src/report.ts`)**:
   - Реалізовано звіт з обсягів торгів за секторами ринку для виконаних заявок (`status = 'FILLED'`), що містить `INNER JOIN`, агрегатні функції `COUNT`, `SUM`, `AVG`, `ROUND` та `.groupBy('product.sector')`.
   - **Межа між Repository та QueryBuilder у проєкті:**
     - **Repository** застосовується для типових CRUD-операцій доменної моделі, завантаження конкретної сутності за ID з простими зв'язками, де потрібна повна гідрація об'єктів для виконання методів бізнес-логіки.
     - **QueryBuilder** застосовується для складних вибірок, аналітики, звітів, агрегацій (`GROUP BY`, `SUM`, `COUNT`), підзапитів та масових операцій без зайвого оверхеду гідрації цілих класів сутностей через `.getRawMany()`.

7. **Підключення та секрети (`scripts/with-secrets.sh`)**:
   - Усі npm-скрипти, що взаємодіють з базою, загорнуті у виклик `bash scripts/with-secrets.sh dev ...`.
   - Додано аварійний вхід `if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi` перед зверненням до файлу `.secrets/infisical.env`.

---

---

## ДЗ #14: Конкурентність і транзакції

У цьому завданні реалізовано повноцінний конкурентний data-layer, здатний витримувати паралельні шквали запитів без втрачених оновлень (lost updates), овербукінгу (oversell) чи відʼємних балансів (overdraft), побудовано чергу фонових задач на `FOR UPDATE SKIP LOCKED`, а також реалізовано retry-обгортку для транзакційних serialization failures.

### Конкурентність

#### 1. Числа зі своїх запусків
- **Конкурентний checkout (`npm run demo:race`)**:
  - Кількість паралельних спроб: **50**
  - Кількість успішних: **10** (рівно відповідає початковому `stock = 10` при `quantity = 1`)
  - Кількість відхилених запитів: **40** (через вичерпання залишку товару)
  - Фінальний stock: **0**
  - Кількість рядків із відʼємним stock: **0**
  - Час виконання конкурентного шквалу: **~72 мс**
- **Воркер-пул задач (`npm run demo:workers`)**:
  - Загальна кількість задач у черзі: **20**
  - Кількість активних воркерів: **4**
  - Задач оброблено двічі: **0** (`оброблено двічі: 0`)
  - Розподіл задач по воркерах: **worker-1: 5**, **worker-2: 5**, **worker-3: 5**, **worker-4: 5**
  - Загальний час паралельної обробки: **284 мс** проти розрахункового послідовного часу **1000 мс** (прискорення у 3.5 рази)
- **Retry-патерн при serialization failure (`npm run demo:retry`)**:
  - Початковий баланс: **1 000 000 центів** ($10,000.00)
  - Депозит транзакції Tx1: **+5 000 центів**
  - Депозит транзакції Tx2: **+7 000 центів**
  - Піймано конфліктів серіалізації (`40001`): **1**
  - Кількість повторів транзакції (retries): **1**
  - Фінальний баланс: **1 012 000 центів** (арифметично коректний, повний збіг)

#### 2. Вибір: Atomic UPDATE vs Pessimistic Lock (`SELECT ... FOR UPDATE`)
Для операції checkout обрано **атомарний UPDATE із предикатом та поверненням значень**:
```sql
UPDATE "products" 
SET "stock" = "stock" - $1, "updated_at" = NOW() 
WHERE "id" = $2 AND "stock" >= $1 
RETURNING "id", "stock", "current_price", "trading_status"
```

**Обґрунтування вибору:**
1. **Мінімізація часу утримання блокування (Lock Contention Window):** `SELECT ... FOR UPDATE` захоплює row-level exclusive lock на самому початку транзакції та утримує його протягом усього життєвого циклу — включно з мережевими затримками між Node.js і PostgreSQL, формуванням об'єктів у JS та наступними INSERT-запитами. Атомарний `UPDATE` блокує рядок виключно на мікросекунди виконання самої інструкції в рушії PostgreSQL, що мінімізує очікування інших паралельних запитів.
2. **Відсутність вікна для race condition (Zero-Race Window):** Предикат `WHERE stock >= $n` оцінюється атомарно рушієм PostgreSQL в момент захоплення рядкового локу. Якщо залишок менший за запитаний, операція повертає 0 рядків, що одразу сигналізує додатку про брак товару без необхідності проміжних читань у пам'ять Node.js.
3. **Економія мережевих round-trips:** Об'єднання перевірки та декременту в одну команду заощаджує цілий round-trip до бази даних на кожну транзакцію.

*(У коді `src/checkout.ts` також реалізовано підтримку прапорця `usePessimisticLock: true` через `QueryBuilder.setLock('pessimistic_write')` для можливості прямого порівняння обох підходів).*

#### 3. Чому retry-обгортка ловить виключно коди `40001` та `40P01`
- **`40001` (`serialization_failure`)** та **`40P01` (`deadlock_detected`)** — це специфічні транзитивні (transient) інфраструктурні помилки PostgreSQL, що виникають через часові перетини конкурентних транзакцій за умов рівнів ізоляції `REPEATABLE READ` / `SERIALIZABLE` або перехресного блокування ресурсів. Запит і бізнес-дані є абсолютно валідними, а невдача зумовлена виключно діями паралельного процесу. Перезапуск транзакції цілком з самого початку (з новим снапшотом) після короткого backoff гарантовано має найвищий шанс на успішний коміт.
- **Усі інші помилки** (наприклад, `23505` — порушення унікальності, `23503` — порушення foreign key, `22003` — переповнення діапазону чисел, помилки валідації схеми або бізнес-правил на кшталт браку коштів/товару) є **детермінованими**. Повторення транзакції з тими самими вхідними даними неминуче завершиться тією ж самою помилкою. Їх перехоплення призвело б до нескінченних retry-циклів, маскування реальних дефектів у коді або виснаження пулу з'єднань.

---

## ДЗ #15: Data layer ops (PgBouncer, Backup Script, Restore Drill)

### Data layer ops

#### 1. Архітектура та запуск
Перед PostgreSQL розгорнуто пулер з'єднань **PgBouncer** (`edoburu/pgbouncer`), сконфігурований у режимі `pool_mode = transaction`. Додаток підключається до бази через порт PgBouncer (`6432`), а не напряму.
- **Підняття стека:**
  ```bash
  docker compose up -d --wait
  ```
- **Перевірка роботи PgBouncer та статусу пулів:**
  ```bash
  psql -h 127.0.0.1 -p 6432 -U postgres -d broker_db -c "SELECT 1"
  psql -p 6432 -U postgres -d pgbouncer -c "SHOW POOLS"
  ```

#### 2. Резервне копіювання (Backup)
Резервна копія створюється у форматі PostgreSQL Custom (`pg_dump -Fc`) зі штампом дати в імені файлу. Скрипт виконується через обгортку `scripts/with-secrets.sh`:
```bash
export DATABASE_URL=postgres://postgres:super_secret_db_pass_123@127.0.0.1:6432/broker_db
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh
```
Розклад щонічного запуску зафіксовано у файлі [backup.cron](file:///Users/dmitro/Documents/Projects/courses/robot_dreams-nodejs_pro_hw/backup.cron) (`0 2 * * *`, щоночі о 02:00 UTC).

#### 3. Аварійне відновлення (Restore Drill)
Процедура перевірки відновлення автоматизована в `scripts/restore-drill.sh`: скрипт піднімає чистий ізольований Docker-контейнер із порожнім volume, відновлює останній створений дамп (`pg_restore --no-owner`), порівнює контрольні суми ключових таблиць (`count(*)` + агрегат `sum(current_price)`) до і після відновлення, друкує `MATCH` та повністю видаляє тимчасовий контейнер і volume.
```bash
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```
Детальний протокол випробування зафіксовано у [RESTORE-DRILL.md](file:///Users/dmitro/Documents/Projects/courses/robot_dreams-nodejs_pro_hw/RESTORE-DRILL.md).

#### 4. Чому `pool_mode = transaction` і що він ламає
У режимі `transaction` PgBouncer утримує фізичне серверне з'єднання до PostgreSQL виключно на час виконання активної транзакції (між `BEGIN` та `COMMIT`/`ROLLBACK`). Як тільки транзакція завершується, з'єднання негайно повертається в пул і може обслуговувати іншого клієнта, що дозволяє підтримувати сотні й тисячі конкурентних клієнтських підключень без роздування пам'яті та процесорних витрат PostgreSQL на підтримку окремих процесів під кожне з'єднання. Проте transaction pooling ламає такі сесійні механізми:
1. **Named Prepared Statements (іменовані підготовлені вирази):** Оскільки наступна транзакція того ж клієнта може виконуватися на іншому серверному процесі PostgreSQL, іменовані вирази, створені на рівні попереднього підключення, стають недоступними (`prepared statement does not exist`), якщо не налаштовано підтримку `max_prepared_statements` (у PgBouncer ≥ 1.21) або анонімні вирази в ORM.
2. **Сесійні параметри та стан (`SET`, `LISTEN`/`NOTIFY`, `TEMP TABLE`):** Будь-які модифікації параметрів через `SET timezone` або `SET search_path`, тимчасові таблиці (`CREATE TEMP TABLE`) та підписки pub/sub (`LISTEN / NOTIFY`) прив'язані до конкретного серверного бекенду: у transaction mode вони або губляться між транзакціями, або небезпечно «забруднюють» сесії інших клієнтів.
3. **Session-level блокування та курсори (`pg_advisory_lock`, `WITH HOLD` cursors):** Консультативні блокування сесійного рівня (`pg_advisory_lock`) і курсори, оголошені з параметром `WITH HOLD` (для збереження після коміту), знищуються або стають некерованими при поверненні з'єднання в пул після `COMMIT`.

---

## ДЗ #16: Тестування (Integration Testcontainers, E2E Supertest, Pact Contract & can-i-deploy)

У цьому завданні реалізовано повноцінну **драбинку довіри (Testing Pyramid)** без використання неправдивих моків даних:

1. **Integration suite з Testcontainers (`test/integration/`)**:
   - Інтеграційні тести репозиторіїв (`ProductRepository`, `OrderRepository`) виконуються проти справжнього PostgreSQL `postgres:16-alpine`, який піднімається кодом прямо з тесту через `@testcontainers/postgresql`.
   - Покрито критичну поведінку, недоступну звичайним unit-мокам:
     - Обмеження унікальності `UNIQUE` (`symbol` у продуктах, `idempotency_key` в ордерах — перехоплення PostgreSQL SQLSTATE `23505` / `duplicate key`).
     - Обмеження зовнішнього ключа `FOREIGN KEY` (`account_id` та `product_id` в ордерах — перехоплення PostgreSQL SQLSTATE `23503` / `foreign_key_violation`).
     - Поведінку, що залежить від реального рушія SQL: атомарний декремент залишку товару через `UPDATE ... WHERE stock >= $1 RETURNING ...`, `ON CONFLICT DO UPDATE` upsert, `GROUP BY` агрегації, partial index (`idx_orders_pending`), та складний SQL `INNER JOIN` з агрегацією фінансового обігу за секторами ринку (`getVolumeBySector`).

2. **Ізоляція тестів**:
   - **Обрана стратегія:** швидке очищення таблиць через `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` у хуку `beforeEach` між тестами.
   - **Чому саме вона:** На відміну від стратегії транзакцій з ROLLBACK, `TRUNCATE` дозволяє тестувати операції, які самі використовують власні транзакції, пули з'єднань або блокування рядків (як-от конкурентний checkout або `RETURNING`), де зовнішня тестова транзакція блокувала б або викривляла поведінку рушія. Порівняно зі стратегією «контейнер-на-файл», `TRUNCATE` відпрацьовує за мілісекунди без кількасекундного оверхеду на рестарт контейнерів та повторний прогін міграцій, забезпечуючи 100% чистий та ізольований стан БД для кожного тесту і гарантуючи зелені повторні запуски (`npm run test:integration && npm run test:integration`) без ручної чистки.

3. **Test Data Builders (`test/integration/testkit/builders.ts`)**:
   - Реалізовано builder-функції `aUser()`, `anAccount()`, `aProduct()`, `anOrder()` з валідними унікальними дефолтами (автоінкрементні тікери, унікальні номери рахунків, валідні UUID, хеші паролів).
   - Тести залишаються лаконічними й виразними, перевизначаючи виключно ті атрибути, які суттєві для конкретного тест-кейсу, позбавляючи код «стіни фікстур».

4. **E2E happy path через Supertest (`test/e2e/`)**:
   - Повний реальний екземпляр NestJS-додатку (`Test.createTestingModule({ imports: [AppModule] })`) без підміни провайдерів.
   - Підключення до БД забезпечується через рядок підключення `DB_URL` від тест-контейнера.
   - Наскрізний happy path: створення торгового ордера через `POST /api/v1/orders` (201) → читання створеного ордера через `GET /api/v1/orders/:id` (200) → перевірка каталогу інструментів `GET /api/v1/instruments` (200) → повтор того самого запиту з заголовком `Idempotency-Replay: true` (201).
   - Негативні кейси: відсутність обов'язкового `Idempotency-Key` (400), невалідний `quantity: 0` (400), неіснуючий ордер (404), колізія ідемпотентності з іншим тілом (422).

5. **Contract-тест через Pact та узгодженість зі спекою #9**:
   - **Consumer тест (`test/contract/consumer.spec.ts`)**: описує взаємодії уявного фронтенду `PaperTradingFrontend` із бекендом `PaperTradingBrokerApi` на базі Pact V3 з MatchersV3 (`like`, `regex`).
   - Генерує контракт у `pacts/PaperTradingFrontend-PaperTradingBrokerApi.json` з наявними `providerStates`.
   - Шляхи (`/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`, `/instruments/AAPL`) та структура відповідей суворо відповідають ресурсам `/orders/{id}` та `/instruments/{symbol}` зі специфікації `openapi/openapi.yaml`.
   - **Provider verification (`test/contract/provider.verify.spec.ts`)**: піднімає справжній застосунок NestJS і верифікує реальні HTTP-відповіді через `stateHandlers`. Кожен interaction успішно проходить перевірку зі статусом `has a matching body (OK)`.

6. **Pact Broker + can-i-deploy гейт у compose та CI**:
   - Сервіс `pact-broker` додано у `docker-compose.yml` з перевіркою працездатності `healthcheck` через IPv4 `127.0.0.1:9292`.
   - **Як підняти брокер локально:**
     ```bash
     docker compose up -d --wait
     ```
   - **Керування секретами:** Адреса та токен брокера приходять виключно з оточення (`process.env.PACT_BROKER_URL`, `process.env.PACT_BROKER_TOKEN`). Локально — через сховище ДЗ #11 (`bash scripts/with-secrets.sh dev npm run verify:provider`) або аварійний байпас (`SKIP_VAULT=1 PACT_BROKER_URL=... npm run verify:provider`), у CI — через secrets репозиторію. У коді немає захардкодних токенів.
   - **CI Workflow (`.github/workflows/ci.yml`)**: містить job `contract` із повним конвеєром: генерація контракту → публікація в брокер (`publish`) → верифікація провайдером (`verify`) з `publishVerificationResult: true` → тегування версії провайдера → обов'язковий гейт `can-i-deploy`, який валить збірку у разі неготовності до релізу.

### Демонстрація роботи deployment gate (can-i-deploy)

Справжній гейт не є завжди-зеленим: доки версія провайдера не помічена як `prod`, контракт не вважається перевіреним для середовища, і брокер повертає `deployable: null` (`unknown: 1`). Щойно встановлюється тег `prod`, гейт стає `deployable: true`.

#### 1. Стан ДО встановлення тегу `prod` (деплой заборонено):
```bash
curl -s "http://127.0.0.1:9292/can-i-deploy?pacticipant=PaperTradingFrontend&version=1.0.0&to=prod"
```
**Вивід:**
```json
{
  "summary": {
    "deployable": null,
    "reason": "There is no verified pact between version 1.0.0 of PaperTradingFrontend and the latest version of PaperTradingBrokerApi with tag prod (no such version exists)",
    "success": 0,
    "failed": 0,
    "unknown": 1
  },
  "notices": [
    {
      "type": "error",
      "text": "There is no verified pact between version 1.0.0 of PaperTradingFrontend and the latest version of PaperTradingBrokerApi with tag prod (no such version exists)"
    }
  ],
  "matrix": [
    {
      "consumer": {
        "name": "PaperTradingFrontend",
        "version": { "number": "1.0.0" }
      },
      "provider": {
        "name": "PaperTradingBrokerApi",
        "version": null
      },
      "verificationResult": null
    }
  ]
}
```

#### 2. Встановлення тегу `prod` на версію провайдера:
```bash
curl -i -X PUT "http://127.0.0.1:9292/pacticipants/PaperTradingBrokerApi/versions/1.0.0/tags/prod" \
  -H 'Content-Type: application/json'
```
**Відповідь:** `HTTP/1.1 201 Created`

#### 3. Стан ПІСЛЯ встановлення тегу `prod` (деплой дозволено):
```bash
curl -s "http://127.0.0.1:9292/can-i-deploy?pacticipant=PaperTradingFrontend&version=1.0.0&to=prod"
```
**Вивід:**
```json
{
  "summary": {
    "deployable": true,
    "reason": "All required verification results are published and successful",
    "success": 1,
    "failed": 0,
    "unknown": 0
  },
  "notices": [
    {
      "type": "success",
      "text": "All required verification results are published and successful"
    }
  ],
  "matrix": [
    {
      "consumer": {
        "name": "PaperTradingFrontend",
        "version": { "number": "1.0.0" }
      },
      "provider": {
        "name": "PaperTradingBrokerApi",
        "version": {
          "number": "1.0.0",
          "tags": [{ "name": "prod", "latest": true }]
        }
      },
      "verificationResult": {
        "success": true,
        "verifiedAt": "2026-09-30T09:21:16+00:00"
      }
    }
  ]
}
```

---

## Grading (ДЗ #19 Acceptance Criteria)

```bash
# 1. Запуск інфраструктури (Postgres, PgBouncer, Pact Broker, RabbitMQ)
docker compose up -d --wait

# 2. Змінні оточення для грейдера
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export SKIP_VAULT=1

# 3. Встановлення залежностей та перевірка збірки
npm ci
npx tsc --noEmit

# 4. Демо 1 (Happy path + prefetch): published=5, effect=5, dlq=0, prefetch=10
npm run demo:publish | tee /tmp/p.txt; echo "exit=${PIPESTATUS[0]}"
for k in published=5 effect=5 dlq=0; do
  grep -qx "$k" /tmp/p.txt || echo "НЕМАЄ: $k"
done
awk -F= '/^prefetch=/{ok=($2+0>=1 && $2+0<=2000)} END{exit !ok}' /tmp/p.txt \
  && echo "prefetch у діапазоні OK" || echo "prefetch поза 1..2000 (дефолт 0 не рахується)"

# 5. Демо 2 (Отруєне повідомлення в DLQ): work=0, dlq=1, dlq-reason=rejected
npm run demo:dlq | tee /tmp/d.txt; echo "exit=${PIPESTATUS[0]}"
for k in work=0 dlq=1; do grep -qx "$k" /tmp/d.txt || echo "НЕМАЄ: $k"; done
grep -qxE 'dlq-reason=(rejected|expired|maxlen|delivery_limit)' /tmp/d.txt \
  && echo "причина прочитана з x-death" || echo "НЕМАЄ читабельної причини"

# 6. Демо 3 (Дубль доставлено, ефект застосовано 1 раз): deliveries>=2, effect=1
npm run demo:duplicate | tee /tmp/u.txt; echo "exit=${PIPESTATUS[0]}"
awk -F= '/^deliveries=/{ok=($2>=2)} END{exit !ok}' /tmp/u.txt && echo "deliveries>=2 OK"
grep -qx 'effect=1' /tmp/u.txt || echo "НЕМАЄ: effect=1"

# 7. Статична перевірка конфігурації DLX (dead letter exchange/routing)
grep -rniE --include='*.ts' --include='*.js' --include='*.mjs' --include='*.cjs' \
  --include='*.json' --include='*.sh' --include='*.yml' --include='*.yaml' --include='*.sql' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  "dead[ _-]*letter[ _-]*(exchange|routing)" .

# 8. Статична перевірка виставлення prefetch в коді
grep -rniE --include='*.ts' --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.json' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  "prefetch|basic[._-]?qos" .

# 9. Перевірка обгортки зі сховищем для демо-скриптів
node -e "const s=require('./package.json').scripts;const bad=['demo:publish','demo:dlq','demo:duplicate'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"

# 10. Перевірка наявності розділу Grading
grep -rlE '^#{1,3} +Grading' --include='README.md' --exclude-dir=node_modules . | wc -l

# 11. Перевірка відсутності незахищених підключень у tracked env файлах
for f in $(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.(example|sample|template|dist)$'); do
  grep -lE '=(amqps?|postgres(ql)?|redis|https?)://[^ ]*:[^ @]+@' "$f"
done
```

---

## Async-події через RabbitMQ

### 1. Результати трьох прогонів демо-скриптів

#### `demo:publish` (Happy path + prefetch)
```text
published=5
delivered=5
effect=5
acked=5
work=0
dlq=0
prefetch=10
```
*Усі 5 подій з бізнес-операції оформлення замовлення (`checkout`) успішно опубліковані через confirm-канал, доставлені споживачу, збережені в базі даних та підтверджені (`manual ack`). Жодне повідомлення не потрапило в DLQ.*

#### `demo:dlq` (Отруєне повідомлення в Dead Letter Queue)
```text
rejected=1
work=0
dlq=1
dlq-reason=rejected
effect=0
```
*Отруєне повідомлення з невалідним контрактом (`isPoison: true`) було відхилено споживачем через `channel.reject(msg, false)`. Завдяки конфігурації `x-dead-letter-exchange` та `x-dead-letter-routing-key` повідомлення автоматично перемістилося в окремий контур DLQ (`orders.order-placed.dlq`). Причина смерті прочитана безпосередньо з заголовка `x-first-death-reason` / `x-death` і становить `rejected`.*

#### `demo:duplicate` (Дубль доставки та ідемпотентний ефект)
```text
deliveries=2
effect=1
skipped=1
```
*Повідомлення було доставлено споживачу двічі (`deliveries=2`), проте завдяки персистентному дедуплікатору на базі PostgreSQL природного ключа бізнес-ефект застосовано рівно 1 раз (`effect=1`), а повторну доставку безпечно пропущено (`skipped=1`).*

---

### 2. Обґрунтування значення `prefetch`

**Формула вибору:**
$$\text{prefetch} \times \text{час обробки} < \text{consumer\_timeout}$$

У RabbitMQ стандартний таймаут очікування підтвердження споживача (`consumer_timeout`) становить 30 хвилин (1800 секунд). Якщо сумарний час утримання непідтверджених повідомлень перевищить цей поріг, брокер примусово закриває канал споживача (`basic.cancel` з помилкою `PRECONDITION_FAILED - consumer timeout`).

У нашому сервісі середня тривалість обробки події `order.placed` (валідація, перевірка унікальності в PostgreSQL та створення запису сповіщення) становить $\approx 10\text{–}20\text{ мс}$.
Ми встановили **`prefetch = 10`**:
$$10 \times 0.02\text{ с} = 0.2\text{ с} \ll 1800\text{ с}$$
Навіть за екстремального навантаження або деградації бази даних до 1 с на транзакцію, пачка з 10 повідомлень обробляється за 10 секунд, що в 180 разів швидше за аварійний таймаут.

- **Чому дефолтний `prefetch = 0` небезпечний:** значення `0` означає «без ліміту». У такому разі брокер вивантажує весь буфер черги в пам'ять першого ж підключеного інстансу споживача. Це створює загрозу OOM-крашу процесу та призводить до простоювання інших вільних реплік/воркерів (starvation).
- **Чому `prefetch = 1` є найгіршим для швидких задач (по 2 мс):** при `prefetch = 1` споживач змушений чекати підтвердження кожного окремого повідомлення через мережевий roundtrip перед тим, як отримати наступне. Затримка мережі (1–5 мс) переважає час виконання корисної бізнес-логіки (2 мс), різко знижуючи пропускну здатність (throughput) усього кластера. Значення `10` забезпечує оптимальний баланс локального пайплайнінгу та рівномірного розподілу між воркерами.

---

### 3. Чому це at-least-once, а не exactly-once

Гарантії **exactly-once доставки** на рівні мережевого транспорту або брокера повідомлень не існує. Будь-який брокер (включно з RabbitMQ, Kafka або SQS) у розподіленому середовищі через мережеві обриви, ретраї, аварійні рестарти чи таймаути може доставити повідомлення більше одного разу.

Позитивний `ack` від споживача до брокера означає не «робота виконана успішно», а **«я більше не вимагаю повторної доставки цього повідомлення»**:
1. Якщо увімкнути автоматичне підтвердження (`noAck: true`, `autoAck`), брокер списує повідомлення з черги в момент відправки в TCP-сокет. Якщо процес споживача падає під час виконання коду — робота зникає назавжди (data loss).
2. Якщо використовувати ручний `ack` (`noAck: false`), підтвердження відправляється **строго після успішного збереження ефекту**. Але якщо процес падає між коммітом у базі та відправкою `ack` (або падає сам сокет з'єднання), брокер зафіксує розрив сесії і поверне непідтверджене повідомлення в чергу. Наступний споживач отримає дубль (`redelivered: true`).

Таким чином, RabbitMQ дає **at-least-once доставку**. Для отримання **exactly-once результату** ми поєднали at-least-once доставку з **ідемпотентним ефектом у споживачі**:
- Кожна подія має стабільний ідентифікатор `eventId` (UUID).
- Застосування ефекту виконується через природний первинний ключ у персистентному сховищі: `INSERT INTO "processed_events" ("event_id", ...) ON CONFLICT ("event_id") DO NOTHING RETURNING "event_id"`.
- Якщо рядок повернувся — це перша доставка, застосовуємо бізнес-ефект (`effect++`). Якщо конфлікт (0 рядків) — це дубль, ефект повторно не виконується (`skipped++`), і споживач безпечно підтверджує повідомлення (`channel.ack(msg)`).
- **Разом: at-least-once доставка + ідемпотентний споживач = exactly-once результат.**

---

### 4. Ідемпотентність vs Ключ ідемпотентності

- **Ідемпотентність** — це математична/алгоритмічна властивість самої операції: властивість давати той самий кінцевий стан системи незалежно від кількості повторних викликів з тими самими аргументами ($f(f(x)) = f(x)$).
  - *Ідемпотентні:* `UPDATE orders SET status = 'FILLED' WHERE id = 42`, `DELETE FROM items WHERE id = 10`, `INSERT ... ON CONFLICT DO NOTHING`.
  - *Неідемпотентні:* `UPDATE accounts SET cash_balance = cash_balance - 100`, `stock = stock - 1` (повторний виклик призводить до повторного списання грошей чи залишків).
- **Ключ ідемпотентності (Idempotency Key)** — це прикладний інструмент (унікальний токен, UUID або `eventId`), за допомогою якого початково неідемпотентну операцію роблять безпечною для повторного виконання шляхом збереження стану попередніх обробок у сховищі та відсікання дублікатів.

---

### 5. Сховище дедуплікації: чому Set/Map у пам'яті неприпустимий

Збереження списку оброблених ідентифікаторів у локальній пам'яті процесу (`Set` або `Map` у пам'яті Node.js) **не є валідним дедуплікатором**:
- Така гарантія існує лише до першого рестарту процесу або падіння контейнера (OOM, редеплой). Після рестарту стан втрачається.
- Вона взагалі не існує між двома паралельними репліками сервісу (у двох подах у Kubernetes `Set` у кожного свій).
- Саме тому ідентифікатори подій та їх статус зберігаються в спільній персистентній реляційній базі даних (`processed_events` у PostgreSQL) з первинним ключем `PRIMARY KEY (event_id)`.

---

### 6. Як викликано повторну доставку в `demo:duplicate`

Для демонстрації повторної доставки обрано **найреалістичнішу форму продакшн-збою: аварійне падіння процесу через `kill -9` (`SIGKILL`) після застосування ефекту, але до відправки `ack`**:
1. Головний процес публікує подію зі стабільним `eventId` і породжує окремий дочірній процес воркера через `child_process.fork()`.
2. Воркер отримує доставку #1, успішно виконує запис у PostgreSQL (`processed_events` та `order_notifications`).
3. Замість відправки `ack` воркер виконує `process.kill(process.pid, 'SIGKILL')`.
4. Ядро операційної системи миттєво вбиває процес воркера та скидає TCP-з'єднання. RabbitMQ фіксує аварійний розрив зв'язку з непідтвердженим повідомленням у стані `unacknowledged` і негайно повертає його в чергу (`requeue`).
5. Другий споживач (Consumer 2) підключається, забирає повернене повідомлення (`deliveries = 2`), намагається виконати запис у PostgreSQL, отримує `ON CONFLICT DO NOTHING`, фіксує дублікат, пропускає повторний ефект (`effect = 1`, `skipped = 1`) та штатно відправляє `ack`.

*(Примітка: виклик `channel.close()` свідомо не використовувався, оскільки він є коректним закриттям протоколу AMQP і не відтворює реальну поведінку аварійного падіння контейнера в продакшені).*

---

### 7. Межа поточної реалізації та місток до ДЗ #22

У поточному рішенні залишається зазор:
1. На стороні продюсера: транзакція замовлення в базі даних та виклик `publish` у RabbitMQ не є атомарними (падіння процесу між ними призведе до збереженого замовлення без опублікованої події).
2. На стороні споживача: відмітка про обробку в `processed_events` та зовнішній ефект (наприклад, надсилання email або виклик стороннього API) можуть розійтися, якщо процес впаде між ними.

Закриття цієї межі здійснюється не зменшенням зазору, а патерном **Transactional Outbox**: запис бізнес-сутності та збереження події в outbox-таблицю фіксуються **єдиним спільним `COMMIT` в одній транзакції PostgreSQL**. Цей патерн буде реалізовано в ДЗ #22.

---

### 8. Нотатки про конфігурацію RabbitMQ

- **Dead Letter Exchange (DLX):** Робоча черга `orders.order-placed` сконфігурована з аргументами `'x-dead-letter-exchange': 'shop.dlx'` та `'x-dead-letter-routing-key': 'order.placed.dlq'`. При виклику `channel.reject(msg, false)` брокер скеровує відхилені повідомлення в окремий контур DLQ.
- **dead-letter-strategy: at-least-once без overflow: reject-publish:** Якщо в політиці RabbitMQ задано стратегію `at-least-once`, але не налаштовано `overflow: reject-publish`, брокер мовчки відкочується до стратегії `at-most-once` і повідомляє про це виключно в логах.
- **Причини Dead Letter:** У RabbitMQ існує рівно 4 причини: `rejected`, `expired`, `maxlen`, `delivery_limit`. У нашому `demo:dlq` причина успішно зчитується з `x-first-death-reason` як `rejected`.

---

## Outbox та ідемпотентність (ДЗ #22)

### 1. Результати трьох демо-прогонів

#### А. Happy path та ключ ідемпотентності на API-краю (`npm run demo:outbox`)
Два однакових запити на купівлю акцій із спільним заголовком `Idempotency-Key` надсилаються на сервер. Перший запит створює замовлення і в тій самій транзакції вставляє подію в `outbox`. Другий запит повертає збережений результат (`isReplay = true`), не створюючи повторних замовлень чи записів у чергу. Після цього relay-воркер вичитує та публікує подію в RabbitMQ, а споживач обробляє її рівно один раз:
```
requests=2
orders=1
outbox=1
published=1
deliveries=1
effect=1
processed=1
```

#### Б. Фейл бізнес-запису не випускає подію назовні (`npm run demo:crash-write`)
Транзакція створення замовлення та вставки запису в `outbox` аварійно падає вже **після** вставки рядка в `outbox`, але **до** `COMMIT`. Обидва рядки відкочуються разом у межах єдиної транзакції PostgreSQL. Relay-воркер не знаходить жодного запису для публікації, споживач не отримує жодного повідомлення:
```
write-failed=1
orders=0
outbox=0
published=0
deliveries=0
effect=0
```

#### В. Подія публікується вдруге після фейлу службового запису (`npm run demo:crash-relay`)
Замовлення та outbox-запис успішно закомічені в базу. Relay-воркер вичитує повідомлення, успішно відправляє його в RabbitMQ, але перед оновленням `published_at` у базі даних імітується аварійне падіння процесу (ROLLBACK транзакції relay). У результаті в базі статус лишається `published_at IS NULL`. Під час другого прогону (recovery) relay повторно вичитує те саме повідомлення і публікує його вдруге. Брокер доставляє дві копії повідомлення (`deliveries=2`), проте завдяки дворівневій ідемпотентності споживача (таблиця `processed_messages` та природний ключ у `order_notifications`) ефект застосовується рівно один раз:
```
published=2
deliveries=2
applied=1
effect=1
processed=1
```

---

### 2. Чому не можна просто поміняти місцями `publish` і `UPDATE published_at`

Порядок дій у relay-воркері є фундаментальним архітектурним вибором: **спочатку `publish` у брокер, і лише після успішного підтвердження — `UPDATE outbox SET published_at = NOW()`**.

Якщо спробувати поміняти цей порядок місцями — тобто спочатку зафіксувати `UPDATE published_at = NOW()` у базі даних, а вже потім викликати публікацію в брокер, — будь-яке аварійне падіння процесу, мережевий збій або перезавантаження брокера між цими двома операціями призведе до **непоправної втрати повідомлення (silent message loss)**. Оскільки запис у таблиці outbox уже помічений як опублікований (`published_at IS NOT NULL`), фоновий polling-воркер (`WHERE published_at IS NULL`) більше ніколи не прочитає його і не повторить відправку. Зовнішній світ ніколи не дізнається про факт створення замовлення, а автоматично відновити втрачену подію неможливо.

Порядок `publish → UPDATE` обирає між дублем і втратою на користь дубля: якщо збій стається після публікації в чергу, але до фіксації `published_at` у базі, подія буде вичитана і надіслана повторно (**гарантія at-least-once**). Повторна доставка надійно та штатно нейтралізується дедуплікацією на ідемпотентному консюмері (рівень природного ключа та inbox `processed_messages`), тоді як втрату повідомлення компенсувати неможливо. Дубль лікується дедуплікацією, а втрата не лікується нічим.

---

### 3. Моделювання падіння relay у `demo:crash-relay`

Для `demo:crash-relay` обрано **змодельований обрив транзакції relay** (виняток та відкат транзакції `ROLLBACK`) рівно в критичній точці: після того, як `publisher.publishOrderPlaced(event)` успішно отримав підтвердження від RabbitMQ Confirm Channel, але до виконання `UPDATE outbox SET published_at = NOW()`. 

Це на 100% повторює наслідки реального аварійного крашу процесу чи обриву мережевого з'єднання з базою даних у продакшені: брокер уже прийняв повідомлення і помістив його в чергу, а транзакція в PostgreSQL скасована, тому `published_at` залишається `NULL`. Під час наступної ітерації relay-воркер вичитує той самий рядок і публікує повторну копію події.

---

### 4. Стратегія очищення таблиці `outbox` (Retention & Index Maintenance)

Таблиця `outbox` неперервно наповнюється з кожною бізнес-операцією. Якщо її не очищати, вона розростається до мільйонів рядків, що створює значний bloat таблиці та навантажує сховище.

Для вирішення цієї проблеми в проєкті реалізовано комбінований підхід:
1. **Частковий індекс (Partial Index):** Індекс побудовано з фільтром `WHERE published_at IS NULL` (`idx_outbox_unpublished ON outbox (created_at, id) WHERE published_at IS NULL`). Розмір цього індексу пропорційний виключно поточному невинесеному беклогу подій (зазвичай десятки чи сотні рядків), тому швидкість вибірки relay-воркера не деградує з часом, навіть коли в таблиці накопичено мільйони записів.
2. **Retention Policy (Очищення):** Для видалення вже доставлених повідомлень застосовується регламентний фоновий процес (cron job), який у години мінімального навантаження видаляє старі записи батчами (щоб уникнути довгих блокувань таблиці):
   ```sql
   DELETE FROM "outbox"
   WHERE "id" IN (
     SELECT "id" FROM "outbox"
     WHERE "published_at" < NOW() - INTERVAL '7 days'
     LIMIT 5000
   );
   ```
3. Для високоінтенсивного продакшену рекомендується партиціонування за часом (`PARTITION BY RANGE (created_at)`) із швидким відкиданням старих секцій через `DROP TABLE outbox_y2026m09` без транзакційного навантаження на диск.

---

### 5. Порядок повідомлень: `ORDER BY` vs `SKIP LOCKED` та партиціонування

У relay-воркері використовується запит `SELECT ... WHERE published_at IS NULL ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT N`. Сортування `ORDER BY` визначає лише черговість вибірки в межах одного потоку.

При запуску декількох паралельних релей-воркерів прапорець `SKIP LOCKED` розподіляє різні незаблоковані пачки рядків між конкурентними процесами без взаємного очікування. Через різну тривалість мережевих викликів до брокера глобальний порядок публікації та доставки подій між паралельними воркерами не гарантується. Строгий FIFO-порядок можливий лише в межах **ключа партиціонування** (`aggregate_id` / routing key у RabbitMQ) шляхом маршрутизації подій одного агрегата в конкретну чергу або використання механізму `Single Active Consumer`.

---

## Grading (ДЗ #19 Acceptance Criteria) (ДЗ #22 Acceptance Criteria)

```bash
docker compose up -d --wait

export DATABASE_URL=postgres://postgres:super_secret_db_pass_123@127.0.0.1:5432/broker_db
export BROKER_URL=amqp://app:app@127.0.0.1:5672
export SKIP_VAULT=1

npm ci
npm run migrate

# 1. Чиста компіляція
npm ci && npx tsc --noEmit

# 2. Happy path + ключ ідемпотентності на API-краю: requests=2, orders=1, outbox=1, published=1, effect=1, processed=1
npm run demo:outbox | tee /tmp/o.txt; echo "exit=${PIPESTATUS[0]}"
for k in requests=2 orders=1 outbox=1 published=1 effect=1 processed=1; do
  grep -qx "$k" /tmp/o.txt || echo "НЕМАЄ: $k"
done

# 3. Фейл бізнес-запису не випускає подію назовні: write-failed=1, orders=0, outbox=0, published=0, deliveries=0, effect=0
npm run demo:crash-write | tee /tmp/cw.txt; echo "exit=${PIPESTATUS[0]}"
for k in write-failed=1 orders=0 outbox=0 published=0 deliveries=0 effect=0; do
  grep -qx "$k" /tmp/cw.txt || echo "НЕМАЄ: $k"
done

# 4. Подія публікується вдруге після фейлу службового запису: deliveries >= 2, applied=1, effect=1, processed=1
npm run demo:crash-relay | tee /tmp/c.txt; echo "exit=${PIPESTATUS[0]}"
awk -F= '/^deliveries=/{ok=($2>=2)} END{exit !ok}' /tmp/c.txt && echo "deliveries>=2 OK"
for k in applied=1 effect=1 processed=1; do
  grep -qx "$k" /tmp/c.txt || echo "НЕМАЄ: $k"
done

# 5. SKIP LOCKED у коді relay
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "skip[ _-]*locked" .

# 6. Дедуп через конфлікт (ON CONFLICT DO NOTHING)
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist \
  "on[ _]*conflict|do[ _]+nothing|or[ _]*ignore|skip[ _]*duplicates|ignore[ _]*duplicates|23505|P2002" .

# 7. Демо викликаються через scripts/with-secrets.sh
node -e "const s=require('./package.json').scripts;const bad=['demo:outbox','demo:crash-write','demo:crash-relay'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"

# 8. Наявність розділу Grading у README
grep -rlE '^#{1,3} +Grading' --include='README.md' --exclude-dir=node_modules . | wc -l

# 9. Відсутність трекнутих env-файлів із живими кредами
for f in $(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.(example|sample|template|dist)$'); do
  grep -lE '=(amqps?|postgres(ql)?|redis|https?)://[^ ]*:[^ @]+@' "$f"
done
```

---

### Архівні критерії оцінки (ДЗ #16)

```bash
# 1. Чиста компіляція
npm ci && npx tsc --noEmit

# 2. Integration suite на testcontainers (≥6 тестів: 2 репозиторії по 3+ тести, unique/FK constraints, SQL агрегації)
npm run test:integration

# 3. Перевірка репортера (має містити 'default')
grep -n "reporters" jest.config.*

# 4. Перевірка реальної ізоляції (повторний запуск зелений без ручної чистки)
npm run test:integration && npm run test:integration

# 5. E2E тести через Supertest (≥2 тести: happy path create -> read + негативні кейси 400, 404, 422)
npm run test:e2e

# 6. Статична перевірка негативних статусів в E2E
grep -rnE "\b(400|404|409|422)\b|HttpStatus\.(BAD_REQUEST|NOT_FOUND|CONFLICT|UNPROCESSABLE_ENTITY)" test/e2e/

# 7. Генерація контракту Pact (створює pacts/*.json з providerStates)
npm run test:contract
ls pacts/*.json
grep providerStates pacts/*.json

# 8. Provider verification (справжній застосунок відповідає на interactions)
npm run verify:provider 2>&1 | sed -E $'s/\x1b\\[[0-9;]*m//g' | grep -F "has a matching body (OK)"

# 9. Узгодженість контракту зі спекою OpenAPI з ДЗ #9 (друкує OK)
node -e 'const p=require("./pacts/PaperTradingFrontend-PaperTradingBrokerApi.json");const spec=require("fs").readFileSync("openapi.yaml","utf8");const sp=[...spec.matchAll(/^\s+(\/\S*):\s*$/gm)].map(m=>m[1]);const seg=s=>s.split("?")[0].replace(/\/+$/,"").split("/");const fit=(a,b)=>{a=seg(a);b=seg(b);return a.length===b.length&&a.every((x,i)=>/^\{[^}]+\}$/.test(x)?b[i]!=="":x===b[i])};const bad=p.interactions.filter(i=>!sp.some(x=>fit(x,i.request.path)));console.log(bad.length?"НЕМАЄ У СПЕЦІ: "+bad.map(i=>i.request.path).join(", "):"OK");process.exit(bad.length?1:0)'

# 10. Перевірка workflow CI (валідний YAML та наявність кроку can-i-deploy)
grep -rn "can-i-deploy" .github/workflows/
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"

# 11. Перевірка обгортки сховища та аварійного входу
test -f scripts/with-secrets.sh && grep -q 'SKIP_VAULT' scripts/with-secrets.sh

# 12. Перевірка відсутності секретного токена брокера в репозиторії
grep -rnE "PACT_BROKER_TOKEN[[:space:]]*[:=][[:space:]]*['\"][^'\"$]" --include='*.ts' --include='*.js' --include='*.yml' --include='*.yaml' --include='*.json' . | grep -v node_modules

# 13. Запуск верифікатора через обгортку зі сховищем (змінні приходять із secret store або env)
SKIP_VAULT=1 bash scripts/with-secrets.sh dev npm run verify:provider
```

---

## Trade-offs: WebSocket vs SSE

Для продакшн-нотифікацій про зміну статусу замовлення я б обрав **Server-Sent Events (SSE)**. Оскільки цей потік за своєю природою є виключно однонаправленим (сервер інформує клієнта), SSE ідеально лягає на стандартний HTTP/2 стек, не потребує кастомного рукостискання чи збереження бідирекційного стану з'єднання, та з коробки підтримує автоматичний реконект браузера з заголовком `Last-Event-ID` для відновлення втрачених подій без сторонніх бібліотек. WebSocket доцільно використовувати лише там, де потрібен повнодуплексний двосторонній обмін з високою частотою (наприклад, чати, колаб-редактори чи біржові торгові термінали з частими клієнтськими діями).

При горизонтальному масштабуванні застосунку до двох і більше інстансів локальна пам'ять та вбудовані кімнати Socket.io перестають працювати між інстансами: клієнт, підключений до інстансу №1, не отримає подію, якщо зміна статусу була оброблена інстансом №2; це вирішується підключенням спільних черг або брокера повідомлень із Redis Pub/Sub адаптером (`@socket.io/redis-adapter` або RabbitMQ), який транслює події між усіма нодами кластера.

| Критерій | WebSocket | Server-Sent Events (SSE) |
| :--- | :--- | :--- |
| **Напрям каналу** | Повнодуплексний (двосторонній бідирекційний канал клієнт ↔ сервер) | Однонаправлений (сервер → клієнт) поверх стандартного HTTP потоку |
| **Реконект та відновлення** | Ручний менеджмент на рівні протоколу/бібліотеки (потребує власної логіки backlog buffer) | Нативний механізм у стандарті браузера (`EventSource`), авто-повтор та заголовок `Last-Event-ID` |
| **Вимоги до інфраструктури** | Специфічний апгрейд `101 Switching Protocols`, чутливий до проксі, фаєрволів та балансувальників | Стандартний HTTP/1.1 або HTTP/2, без проблем проходить крізь будь-які корпоративні проксі та CDN |
| **Ціна на подію** | Мінімальний оверхед фреймінгу (2–10 байт на фрейм поверх TCP), але дорожче утримання стану з'єднань | Текстовий формат UTF-8 (`data: ...\n\n`), проте чудово стискається та мультиплексується через HTTP/2 |
| **Обмеження підключень** | Обмежено ресурсами пам'яті/дескрипторів сервера | У HTTP/1.1 обмеження 6 з'єднань на домен у браузері; усувається переходом на HTTP/2 мультиплексування |

### Інструкція запуску та перевірки (ДЗ #18)

#### 1. Збірка та запуск сервера
```bash
# Збірка TypeScript
npm run build

# Запуск сервера
node dist/src/main.js
```

#### 2. Перевірка SSE-заголовка
```bash
curl -sN --max-time 2 -D - -o /dev/null http://localhost:3000/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/events | grep -i '^content-type'
# Очікуваний вивід:
# Content-Type: text/event-stream
```

#### 3. Перевірка формату подій SSE
```bash
# В окремому терміналі запустити прослуховування:
curl -sN --max-time 5 http://localhost:3000/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/events

# В іншому терміналі змінити статус замовлення:
curl -s -X PATCH http://localhost:3000/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"CANCELLED"}'
```

#### 4. Перевірка відновлення подій через Last-Event-ID
```bash
# Виконати щонайменше 4 зміни статусу (1..N, N >= 4):
curl -s -X PATCH http://localhost:3000/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/status -H 'Content-Type: application/json' -d '{"status":"PENDING"}'
curl -s -X PATCH http://localhost:3000/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/status -H 'Content-Type: application/json' -d '{"status":"FILLED"}'
curl -s -X PATCH http://localhost:3000/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/status -H 'Content-Type: application/json' -d '{"status":"CANCELLED"}'
curl -s -X PATCH http://localhost:3000/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/status -H 'Content-Type: application/json' -d '{"status":"FILLED"}'

# Запит з Last-Event-ID: 3 має повернути першу пропущену подію з id > 3:
curl -sN --max-time 2 -H 'Last-Event-ID: 3' http://localhost:3000/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/events | grep '^id:' | head -1
# Очікуваний вивід:
# id: 4
```

#### 5. Перевірка ізоляції кімнат WebSocket (headless-демо)
```bash
# Основний прогін: клієнти в різних кімнатах (B не має чути подію замовлення A)
node scripts/realtime-demo.mjs; echo "exit=$?"
# A_RECEIVED=1
# B_RECEIVED=0
# exit=0

# Контрольний прогін: обидва клієнти в кімнаті замовлення A (B мусить почути)
node scripts/realtime-demo.mjs --same-room; echo "exit=$?"
# A_RECEIVED=1
# B_RECEIVED=1
# exit=0
```

---

## Redis: кеш, сесії, ліміти, черга

### Чому два інстанси Redis (`redis-cache` і `redis-queue`)

У `docker-compose.yml` піднято два окремі контейнери Redis, оскільки кеш і черга мають взаємовиключні вимоги до памʼяті, а `SELECT 1` не ізолює `maxmemory` та `maxmemory-policy` (вони спільні на весь процес Redis):
- `redis-cache` (`127.0.0.1:6379`): `--maxmemory 64mb --maxmemory-policy allkeys-lru`. Витісняє старі ключі при заповненні памʼяті; помилки запису (включно з `OOM`) перехоплюються в `CacheAsideService`, щоб кеш ніколи не роняв користувацький запит.
- `redis-queue` (`127.0.0.1:6380`): `--maxmemory-policy noeviction --appendonly yes --appendfsync everysec`. BullMQ прямо забороняє витіснення ключів (`noeviction`), інакше довільне видалення ключів ламає стан черги й метадані задач.

### Де живуть сесії та чому

Сесії (`SessionService`, rolling TTL через атомарний `GETEX key EX 30`) зберігаються в інстансі **`redis-queue` (`noeviction`)**, а не в `redis-cache`. Якщо покласти сесії в `allkeys-lru`, Redis під тиском памʼяті почне витісняти активні сесії, що призведе до випадкових розлогінень користувачів.

### Модель rate-limit

Обрано **ковзне вікно (Sliding Window Log)** на одному атомарному Lua-скрипті (`ZREMRANGEBYSCORE` + `ZCARD` + `ZADD` + `PEXPIRE`) — він забороняє подвійний сплеск на межі хвилини (2× burst, властивий фіксованому вікну) і гарантує атомарність лічильника між кількома подами. При перевищенні ліміту повертається HTTP `429` та заголовок `Retry-After`.

### Що станеться, якщо stampede-лок зламається, і чому саме тут це прийнятно

Якщо single-flight лок (`SET lock:... <token> NX PX`) протухне під час довгої паузи процесу (GC, page fault) або зламається, два чи більше запитів одночасно не знайдуть значення в кеші й підуть у PostgreSQL. Наслідком буде лише зайвий ідемпотентний `SELECT` (кілька зайвих мілісекунд і копійок на навантаження БД), але бізнес-стан системи залишиться коректним. Саме тому для захисту кеша достатньо звичайного Redis-лока без fencing token, на відміну від критичних бізнес-інваріантів (списання балансу чи залишку), де зламаний лок псує дані й потрібна транзакція або унікальний індекс у БД.

### Власні числа прогонів

- `npm run demo:cache`: `cache-lru=1`, `cache-maxmemory=1`, `warmed=60`, `ttl-distinct=36` (діапазон TTL `300 + random(0..60)` сек), `concurrent=25`, `db-calls=1`, `db-calls-warm=0`
- `npm run demo:session`: `requests=4`, `sessions=1`, `in-redis=1`, `ttl-renewed=1`
- `npm run demo:ratelimit`: `instances=2`, `limit=5`, `requests=8`, `allowed=5`, `blocked=3`, `status=429`, `retry-after=1`
- `npm run demo:queue`: `queue-noeviction=1`, `attempts=3`, `completed=1`, `added=2`, `queued=1`, `schedulers=1`, `scheduled-runs=2`

---

## Auth

### 1. Змінні оточення

| Змінна | Що це | Джерело | Формат |
|---|---|---|---|
| `JWT_PRIVATE_KEY` | Приватний ключ підпису access-токенів (ES256) | сховище (#11) | base64(PKCS8 PEM), без дефолту |
| `JWT_PUBLIC_KEY` | Публічний ключ верифікації access-токенів (ES256) | сховище (#11) | base64(SPKI PEM), без дефолту |
| `REFRESH_TOKEN_PEPPER` | Секретний «перець» для HMAC-SHA256 хешування refresh-токенів | сховище (#11) | рядок >= 32 байти, без дефолту |
| `JWT_KID` | Ідентифікатор активного ключа підпису | оточення / compose | рядок (дефолт `dev-1`) |
| `JWT_ISSUER` | Видавець токенів (`iss`) | оточення / compose | рядок |
| `JWT_AUDIENCE` | Аудиторія токенів (`aud`) | оточення / compose | рядок |
| `ACCESS_TOKEN_TTL_SECONDS` | Час життя access-токена в секундах | оточення / compose | ціле число (дефолт `900` = 15 хв) |
| `REFRESH_TOKEN_TTL_SECONDS` | Час життя refresh-токена в секундах | оточення / compose | ціле число (дефолт `604800` = 7 діб) |
| `DB_URL` | Рядок підключення до PostgreSQL | compose / оточення | URI без зашитих прод-секретів |
| `REDIS_QUEUE_URL` | Redis (`noeviction` + AOF) для денилиста `jti` | compose / оточення | URI |

### 2. Вибір алгоритму та allowlist

Для підпису access-токенів обрано **ES256** (ECDSA на кривій P-256 із SHA-256). OWASP позначає RS256 як «Not recommended» і радить ES256 / PS256 / EdDSA, оскільки ES256 дає компактніші ключі й підписи за вищої криптостійкості на біт. У `JwtService.verifyAccessToken` передається явний allowlist `algorithms: ['ES256']` (вимога RFC 8725 §3.1), який відхиляє токени з `alg: none` або `HS256` ще до перевірки підпису.

### 3. Overlap-ротація ключа підпису та роль `kid`

Кожен виданий access-токен містить у захищеному заголовку поле `kid` (Key ID). Під час планової ротації ключа:
1. Новий публічний ключ (`kid=prod-2`) додається до набору ключів верифікатора **поруч** зі старим (`kid=prod-1`).
2. Сервіс перемикає підпис нових токенів на новий приватний ключ (`kid=prod-2`).
3. Протягом `ACCESS_TOKEN_TTL_SECONDS` (15 хв) обидва ключі залишаються валідними для перевірки — клієнти не отримують 401.
4. Після спливу TTL старий публічний ключ (`kid=prod-1`) видаляється з верифікатора.

Відбитки публічних ключів (SHA-256 від SPKI DER, перші 16 hex-символів):
- `dev` (`kid=dev-1`): `45b58d719917aa5a`
- `prod` (`kid=prod-1`): `9c4e18a20b7f31d4` (окремий ключ у prod-середовищі Vault, відмінний від dev)

### 4. Чому логаут — це дві дії

Refresh-токен є непрозорим випадковим рядком, чий HMAC-хеш (`REFRESH_TOKEN_PEPPER`) зберігається в таблиці `refresh_tokens` у PostgreSQL — тому при логауті достатньо проставити `revoked_at = now()` на всю сімʼю (`family_id`). Access-токен натомість є self-contained JWT і лишається криптографічно валідним до `exp`, тому його `jti` записується в Redis-денилист (`noeviction` інстанс із ДЗ #23) із `TTL = exp - now`. Використовується два незалежні сховища (PostgreSQL для стану сесійних сімей + Redis для ефемерного денилиста з авто-експірацією), без ілюзії атомарного dual-write.

### 5. Гонка на клієнті при рефреші

У цьому API обрано **серіалізацію рефрешу на клієнті** (один in-flight проміс на всі паралельні 401-запити) без grace window на сервері: будь-яке повторне предʼявлення вже використаного refresh-токена негайно трактується як компрометація й відкликає всю сімʼю (`family_id`) з логуванням `family_id`, `user_id` і `kid` (без жодних токенів у логах).

### 6. Межа між гардом, власністю та роллю в токені

- **Відповідність домену:** `orders` — ресурс із власником (`account_id` / `ownerUserId`); `instruments` — аналог `products`, куди можуть писати (`POST /instruments`) лише привілейовані ролі `ADMIN` або `BROKER`.
- **Межа перевірки власності:** `JwtAuthGuard` та `RolesGuard` виконуються до завантаження сутності і перевіряють лише автентифікацію (`401`) та роль (`403`). Перевірка власності (`order.account_id === user.sub`) навмисно виконана в `OrdersService.findById` **після** завантаження ордера, бо гард не має даних ресурсу і змушений був би робити зайвий запит у БД.
- **Роль у токені як кеш:** Поле `role` у JWT-payload є кешем на момент видачі токена, а не джерелом правди. Якщо адміністратора розжалувати в базі, він зберігатиме права `ADMIN` до завершення `exp` поточного access-токена (максимум 15 хв) або до явного логауту/відкликання.

## Files

### Змінні оточення

| Змінна | Опис | Джерело |
| --- | --- | --- |
| `STORAGE_ENDPOINT` | Endpoint S3-сумісного стореджу (порожньо для AWS S3) | env / `.env` |
| `STORAGE_REGION` | Регіон S3-стореджу (`us-east-1`) | env / `.env` |
| `STORAGE_BUCKET` | Імʼя приватного бакета (`hw26-files`) | env / `.env` |
| `STORAGE_ACCESS_KEY` | Access Key сховища | сховище (Infisical / `with-secrets.sh`) |
| `STORAGE_SECRET_KEY` | Secret Key сховища | сховище (Infisical / `with-secrets.sh`) |
| `PRESIGNED_PUT_TTL_SECONDS` | Строк дії presigned PUT URL у секундах (`300`) | env / `.env` |

### Свідомі рішення та обґрунтування

1. **Строк presigned URL (`300` секунд / 5 хвилин для PUT, `60` секунд для `GET /files/:id` 302-редіректа).**
   Presigned URL не можна відкликати — він не має `jti` чи реєстру, а `expiresIn: 7d` у продакшені під STS-роллю часто помирає через 1 годину разом із тимчасовими креденшелами. Для завантаження аватарки чи документа з форми 5 хвилин достатньо на старт PUT-запиту, і водночас це мінімізує вікно ризику при витоку URL. Для читання `GET /files/:id` виконує перевірку права доступу (JwtAuthGuard + власність/роль) і видає 302-редірект на presigned GET на 60 секунд; повний presigned URL ніколи не логується.

2. **Двокроковий контракт і серверний ключ (`uploads/{userId}/{uuid}.{ext}`).**
   `POST /api/v1/uploads/intent` валідує `contentType` за allowlist (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`, `application/octet-stream`, `text/css`, `application/javascript`, `text/plain`, `application/gzip`) і генерує ключ на сервері. Клієнтський `filename` (наприклад, `../../etc/passwd`) у ключ не потрапляє. У БД створюється запис `files` зі статусом `PENDING`. `POST /api/v1/uploads/commit` робить `HeadObject` у сховищі й звіряє існування та розмір обʼєкта; без фізичних байтів у сховищі повертається `409 Conflict`, а статус `COMPLETED` ставиться лише після підтвердження. Завислі `PENDING`-записи старші за 24 години доцільно прибирати фоновим BullMQ-воркером (`AbortMultipartUpload` → `DeleteObject` → видалення рядка), а на бакеті тримати lifecycle-правило `AbortIncompleteMultipartUpload: 7 days`.

3. **Поріг multipart та розрахунок розміру частини.**
   Поріг увімкнення multipart — `10 MiB` (`2 × 5 MiB`, щоб при спрацьовуванні було щонайменше 2 частини). Мінімальний розмір нефінальної частини в S3 — `5 MiB`, а максимум частин — `10 000`. Тому розмір частини обчислюється динамічно:
   `partSize = Math.max(5 * 1024 * 1024, Math.ceil(fileSize / 10_000))`.
   При обриві новий процес викликає `GET /api/v1/uploads/:id/parts` (всередині `ListPartsCommand`) і довантажує лише відсутні частини перед `POST /api/v1/uploads/:id/complete` (`CompleteMultipartUploadCommand`).

4. **Форма CDN та оновлення без інвалідації.**
   Обрана локальна форма OAC-стилю: легкий edge-сервер (`src/files/edge-cdn.ts`), який ходить у приватний бакет MinIO/S3 власними креденшелами, кешує відповіді в памʼяті лише за наявності origin-заголовка `Cache-Control: public, max-age=31536000, immutable` (без `Cache-Control` від origin кешування не відбувається) і віддає `X-Cache: HIT|MISS`. Ассети публікуються з контент-хешем в імені (`app.<sha256-8>.css`), тож після деплою новий вміст приїжджає під новим URL без жодної інвалідації. Для приватного контенту на справжньому CloudFront додатково застосовуються CloudFront Signed URLs або Signed Cookies.

5. **Bucket Policy для AWS CloudFront + OAC (довідкова конфігурація):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::hw26-files/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/E1234567890ABC"
        }
      }
    }
  ]
}
```

### Результати трьох прогонів

- `npm run demo:upload`:
  `intent=200`, `key-from-server=1`, `api-alive=0`, `put-offline=200`, `commit=200`, `commit-without-bytes=409`, `tampered=403`, `expired=403`
- `npm run demo:multipart` (прогін 1 і 2):
  `head-before-complete=404`, `resumed-parts=1`, `complete=200`, `size-match=1`, `etag-multipart=1`
- `npm run demo:cdn`:
  `direct=403`, `edge-miss=200`, `edge-hit=200`, `cache-hit=1`, `new-name=1`, `new-url=200`, `content-changed=1`

## Kubernetes

### Локальний кластер та ресурси

- **Кластер:** `kind` (одновузловий, конфіг у [`k8s/kind-config.yaml`](k8s/kind-config.yaml) з `extraPortMappings` `30080 -> 30080`).
- **Виділена памʼять:** Docker Desktop на хості має `~7.75 GiB` загальної памʼяті (`docker info | grep -i "total memory"`), вузол `kind` споживає `~520–550 MiB` RAM (значно менше за поріг `minikube` у `1800 MB`).

### Змінні оточення та секрети

| Змінна | Джерело | Навіщо |
|---|---|---|
| `DB_PASSWORD` | сховище (#11) | пароль до PostgreSQL, потрапляє в K8s `Secret` (`broker-secrets`) |
| `JWT_PRIVATE_KEY` | сховище (#11) | приватний ключ ES256 (base64 PEM), потрапляє в K8s `Secret` |
| `JWT_PUBLIC_KEY` | сховище (#11) | публічний ключ ES256 (base64 PEM), потрапляє в K8s `Secret` |
| `REFRESH_TOKEN_PEPPER` | сховище (#11) | секретний перець для HMAC-SHA256 refresh-токенів, потрапляє в K8s `Secret` |
| `STORAGE_ACCESS_KEY` | сховище (#11) | ключ доступу до S3/MinIO сховища, потрапляє в K8s `Secret` |
| `STORAGE_SECRET_KEY` | сховище (#11) | секретний ключ S3/MinIO сховища, потрапляє в K8s `Secret` |
| `PULUMI_CONFIG_PASSPHRASE` | сховище (#11) | ключ шифрування стану локального Pulumi-стеку |

### Конфлікт володіння `spec.replicas` та `HPA`

У локальному `kind` немає `metrics-server`, тому `HorizontalPodAutoscaler` (`autoscaling/v2`) показує `TARGETS: cpu: <unknown>/70%` і `REPLICAS: 0` — це очікувано, і саме тому `spec.replicas: 2` залишається в `Deployment`. У бойовому кластері з увімкненим `metrics-server` одночасне задання `spec.replicas` у Pulumi-маніфесті та `HPA` створює **конфлікт володіння полем** (`field ownership conflict`): HPA масштабує кількість подів під навантаженням, а наступний `pulumi up` відкочує `replicas` назад до статичного значення. У проді це вирішується або виключенням `replicas` зі `spec` після першого деплою, або `ignoreChanges: ["replicas"]` у `CustomResourceOptions`.

### Промислові шляхи доставки секретів (ESO та CSI)

У цьому ДЗ секрет зі сховища (`scripts/with-secrets.sh`) потрапляє у кластер через Pulumi-ресурс `k8s.core.v1.Secret` (`data` у base64, без відкритого тексту в `Deployment`), а `Deployment` споживає його через `envFrom.secretRef`. У продакшені секрети не ганяють через CI/CD-раннер напряму — натомість використовують:
- **External Secrets Operator (ESO)** — оператор у кластері, який періодично синхронізує секрети із зовнішнього сховища (Infisical, AWS Secrets Manager, HashiCorp Vault) у нативні K8s `Secret`.
- **Secrets Store CSI Driver** — монтує секрети безпосередньо в `tmpfs`-том пода з зовнішнього сховища в момент старту контейнера, взагалі не записуючи їх у `etcd`.

### Повільний старт (`startupProbe`) та sidecar

Якщо сервіс має довгий і нерівномірний старт (міграції БД, прогрів кешу, наприклад до `30 с`), замість роздування `initialDelaySeconds` у `livenessProbe` варто додати `startupProbe`:
- З `initialDelaySeconds: 30` на `livenessProbe` (`periodSeconds: 5, failureThreshold: 3`) перший рестарт станеться через `30 + 3×5 = 45 с` незалежно від того, чи сервіс стартував за `4 с`, чи завис.
- З `startupProbe` (`periodSeconds: 2, failureThreshold: 15`, тобто вікно `30 с`) `livenessProbe` (`periodSeconds: 5, failureThreshold: 3`) та `readinessProbe` не запускаються, доки `startupProbe` не відповість `200`, а одразу після успіху `startupProbe` вимикається назавжди і далі працює швидкий `livenessProbe` (`15 с` на виявлення зависання).
- Якщо у поді є другий контейнер (**sidecar**, наприклад збирач логів або проксі), готовність пода є конʼюнкцією готовностей усіх його контейнерів: неналаштований або неготовий sidecar робить весь под `NotReady` і знімає трафік навіть зі здорового основного застосунку.

## Grading

```bash
docker compose up -d --wait

export REDIS_URL=redis://127.0.0.1:6379
export REDIS_QUEUE_URL=redis://127.0.0.1:6380
export DATABASE_URL=postgres://postgres:super_secret_db_pass_123@127.0.0.1:5432/broker_db
export STORAGE_ENDPOINT=http://127.0.0.1:22650
export STORAGE_REGION=us-east-1
export STORAGE_BUCKET=hw26-files
export STORAGE_ACCESS_KEY=hw26user
export STORAGE_SECRET_KEY=hw26secretpass
export SKIP_VAULT=1

# Одноразова пара ES256 (P-256) для прогону; PEM передається в base64
node -e 'const {generateKeyPairSync}=require("node:crypto");
const k=generateKeyPairSync("ec",{namedCurve:"P-256",
  privateKeyEncoding:{type:"pkcs8",format:"pem"},
  publicKeyEncoding:{type:"spki",format:"pem"}});
const fs=require("node:fs");
fs.writeFileSync("/tmp/priv.b64",Buffer.from(k.privateKey).toString("base64"));
fs.writeFileSync("/tmp/pub.b64",Buffer.from(k.publicKey).toString("base64"));'

export JWT_KID=grader
export JWT_PRIVATE_KEY="$(cat /tmp/priv.b64)"
export JWT_PUBLIC_KEY="$(cat /tmp/pub.b64)"
export REFRESH_TOKEN_PEPPER=grader-pepper-at-least-32-bytes-long

npm ci
npm run migrate

# 1. Компіляція чиста
npx tsc --noEmit

# 2. Ключі йдуть через обгортку сховища
node -e "const s=require('./package.json').scripts;const need=['start:vault','demo:auth','demo:reuse','demo:rbac'];const bad=need.filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"
grep -q 'SKIP_VAULT' scripts/with-secrets.sh && echo "аварійний вхід є"

# 3. Без ключа зі сховища застосунок не стартує і називає змінну
VARS=$(grep -rhE '^[[:space:]]*\|' --include='README.md' --exclude-dir=node_modules . \
       | awk -F'|' '
           { hit=0
             for (i=2; i<=NF; i++) if ($i ~ /сховищ/) hit=i
             if (!hit) next
             for (i=2; i<=NF; i++) {
               if (i==hit) continue
               if (match($i, /`[A-Za-z_][A-Za-z0-9_]*`/)) { print substr($i, RSTART+1, RLENGTH-2); break }
               c=$i; gsub(/[ \t*`]/, "", c)
               if (c ~ /^[A-Za-z_][A-Za-z0-9_]*$/) { print c; break }
             } }' | sort -u)
echo "змінні зі сховища: $(echo $VARS)"
node -e '
const {spawnSync}=require("child_process");
const vars=process.argv.slice(1);
if (vars.length===0) { console.log("exit=— названо=— (таблиці змінних у README не знайдено)"); process.exit(1); }
const env={...process.env}; for(const v of vars) delete env[v];
const r=spawnSync("npm",["run","start"],{env,encoding:"utf8",timeout:60000});
const out=(r.stdout||"")+(r.stderr||"");
const named=vars.filter(v=>out.includes(v));
console.log("exit="+r.status+" названо="+(named.join(",")||"—"));
process.exit(r.status!==0 && r.status!==null && named.length>0 ? 0 : 1);
' $VARS

# 4. Логін, доступ і логаут (денилист + відкликання сімʼї)
npm run demo:auth | tee /tmp/a.txt; echo "exit=${PIPESTATUS[0]}"
for k in login=200 no-token=401 with-token=200 refresh=200 after-logout=401 refresh-after-logout=401; do
  grep -qx "$k" /tmp/a.txt || echo "НЕМАЄ: $k"
done
awk -F= '/^logout=/{ok=($2==200||$2==204)} END{exit !ok}' /tmp/a.txt && echo "logout OK"

# 5. Reuse detection валить усю сімʼю
npm run demo:reuse | tee /tmp/r.txt; echo "exit=${PIPESTATUS[0]}"
for k in login=200 r1-refresh=200 r1-reuse=401 r2-after-reuse=401; do
  grep -qx "$k" /tmp/r.txt || echo "НЕМАЄ: $k"
done

# 6. 401 != 403, власність, роль і перевірка підпису
npm run demo:rbac | tee /tmp/b.txt; echo "exit=${PIPESTATUS[0]}"
for k in anon=401 own=200 foreign=403 role-denied=403 tampered=401; do
  grep -qx "$k" /tmp/b.txt || echo "НЕМАЄ: $k"
done
awk -F= '/^role-allowed=/{ok=($2==200||$2==201)} END{exit !ok}' /tmp/b.txt && echo "role-allowed OK"

# 7. Allowlist алгоритмів у коді верифікації
grep -rniE --include='*.ts' --include='*.js' --exclude-dir=node_modules --exclude-dir=dist "algorithms[[:space:]]*[:=,}]|['\"]algorithms['\"]|algorithms\(" .

# 8. Розділи ## Grading і ## Auth у README
grep -rlE '^#{1,3} +Grading' --include='README.md' --exclude-dir=node_modules . | wc -l
grep -rlE '^#{1,3} +Auth' --include='README.md' --exclude-dir=node_modules . | wc -l

# --- ДЗ #26: Object Storage, Presigned, Multipart, CDN ---

# 26.2. Креденшели сховища через with-secrets.sh
node -e "const s=require('./package.json').scripts;const need=['demo:upload','demo:multipart','demo:cdn'];const bad=need.filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"
grep -q 'SKIP_VAULT' scripts/with-secrets.sh && echo "аварійний вхід є"

# 26.3. Presigned upload (байти повз API)
npm run demo:upload | tee /tmp/u.txt; echo "exit=${PIPESTATUS[0]}"
for k in intent=200 key-from-server=1 api-alive=0 put-offline=200 commit=200 tampered=403 expired=403; do
  grep -qx "$k" /tmp/u.txt || echo "НЕМАЄ: $k"
done
awk -F= '/^commit-without-bytes=/{o=($2>=400 && $2<500)} END{exit !o}' /tmp/u.txt && echo "commit-without-bytes 4xx OK"

# 26.4. Multipart із довантаженням (два прогони поспіль)
for run in 1 2; do
  npm run demo:multipart | tee /tmp/m$run.txt; echo "прогін $run exit=${PIPESTATUS[0]}"
  for k in head-before-complete=404 resumed-parts=1 complete=200 size-match=1 etag-multipart=1; do
    grep -qx "$k" /tmp/m$run.txt || echo "прогін $run НЕМАЄ: $k"
  done
done

# 26.5. Приватний бакет, кеш-шар, оновлення без інвалідації
npm run demo:cdn | tee /tmp/c.txt; echo "exit=${PIPESTATUS[0]}"
for k in direct=403 edge-miss=200 edge-hit=200 cache-hit=1 new-name=1 new-url=200 content-changed=1; do
  grep -qx "$k" /tmp/c.txt || echo "НЕМАЄ: $k"
done

# 26.7. Розділ ## Files у README
grep -rlE '^#{1,3} +(Files|Файли)' --include='README.md' --exclude-dir=node_modules . | wc -l

# --- ДЗ #28: Kubernetes, Zero-Downtime Rolling Update, Pulumi, Distroless ---

export SKIP_VAULT=1
export DB_PASSWORD=grader-db-secret
export STORAGE_ACCESS_KEY=hw26user
export STORAGE_SECRET_KEY=hw26secretpass
export REFRESH_TOKEN_PEPPER=grader-pepper-at-least-32-bytes-long
export PULUMI_BACKEND_URL="file://$PWD/.pulumi"
export PULUMI_CONFIG_PASSPHRASE=hw28-grading

node -e 'const {generateKeyPairSync}=require("node:crypto"),fs=require("node:fs");
const k=generateKeyPairSync("ec",{namedCurve:"P-256",
  privateKeyEncoding:{type:"pkcs8",format:"pem"},
  publicKeyEncoding:{type:"spki",format:"pem"}});
fs.writeFileSync("/tmp/priv.b64",Buffer.from(k.privateKey).toString("base64"));
fs.writeFileSync("/tmp/pub.b64",Buffer.from(k.publicKey).toString("base64"));'
export JWT_PRIVATE_KEY="$(cat /tmp/priv.b64)"
export JWT_PUBLIC_KEY="$(cat /tmp/pub.b64)"

npm --prefix infra ci
printf 'dummy-npm-token' > .npm_token

npm run image:build
npm run cluster:up
npm run up

# 1. Pulumi-програма типізується
(cd infra && npx tsc --noEmit); echo "exit=$?"

# 2. Образ production-grade та 3. Секрет збірки не осів в образі
npm run demo:image | tee /tmp/img.txt
awk -F= '/^stages=/{s=$2}/^shell-inside=/{sh=$2}/^runtime-uid=/{u=$2}
         END{print (s>=2 && sh==0 && u!=0 && u!="") ? "OK" : "НЕ production"}' /tmp/img.txt
awk -F= '/^token-in-/{t+=$2} END{print (t==0) ? "чисто" : "витік: "t}' /tmp/img.txt

# 4. Поріг сканера обчислюється
SCAN_MAX=-1 npm run scan; echo "exit(max=-1)=$?"
SCAN_MAX=99999 npm run scan; echo "exit(max=99999)=$?"

# 5. Без значення зі сховища розгортання падає і називає змінну
VARS=$(grep -rhE '^[[:space:]]*\|' --include='README.md' --exclude-dir=node_modules . \
  | awk -F'|' '{ hit=0
      for (i=2;i<=NF;i++) if ($i ~ /сховищ/) hit=i
      if (!hit) next
      for (i=2;i<=NF;i++){ if (i==hit) continue
        if (match($i, /`[A-Za-z_][A-Za-z0-9_]*`/)) { print substr($i, RSTART+1, RLENGTH-2); break }
        c=$i; gsub(/[ \t*`]/,"",c); if (c ~ /^[A-Za-z_][A-Za-z0-9_]*$/) { print c; break } } }' | sort -u)
[ -n "$VARS" ] || { echo "у README немає рядків зі словом «сховище»"; exit 1; }
for v in $VARS; do
  OUT=$(cd infra && env -u "$v" pulumi preview --non-interactive 2>&1); RC=$?
  case "$OUT" in *"$v"*) N=так;; *) N=НІ;; esac
  echo "без $v -> exit=$RC названо=$N"
done

# 6. Zero-downtime rolling update під навантаженням
npm run demo:rollout | tee /tmp/roll.txt; echo "exit=${PIPESTATUS[0]}"

# 7. Проби розділені й стратегія maxUnavailable=0
kubectl -n broker-hw28 get deploy broker-api -o json > /tmp/dep.json
node -e '
const d=require("/tmp/dep.json"), c=d.spec.template.spec.containers[0];
const rp=c.readinessProbe?.httpGet?.path, lp=c.livenessProbe?.httpGet?.path;
const mu=d.spec.strategy?.rollingUpdate?.maxUnavailable;
console.log(`readiness=${rp||"—"} liveness=${lp||"—"} maxUnavailable=${mu}`);
process.exit((rp&&lp&&rp!==lp&&(mu===0||mu==="0"))?0:1)'

# 8. PDB дозволяє перше виселення (201) і блокує друге (429)
kubectl -n broker-hw28 get pdb broker-pdb -o jsonpath='{.status.disruptionsAllowed}{"\n"}'
npm run demo:pdb | tee /tmp/pdb.txt

# 9. HPA autoscaling/v2
kubectl -n broker-hw28 get hpa broker-hpa -o json > /tmp/hpa.json
node -e '
const h=require("/tmp/hpa.json");
console.log(`apiVersion=${h.apiVersion} min=${h.spec.minReplicas} max=${h.spec.maxReplicas}`);
process.exit((/autoscaling\/v2/.test(h.apiVersion) && h.spec.minReplicas>=2 && h.spec.maxReplicas>h.spec.minReplicas)?0:1)'

# 10. Секрет доїхав у K8s Secret, у маніфесті лише посилання
node -e '
const c=require("/tmp/dep.json").spec.template.spec.containers[0];
const refs=(c.env||[]).filter(e=>e.valueFrom?.secretKeyRef).length + (c.envFrom||[]).filter(e=>e.secretRef).length;
console.log("посилань на Secret =", refs); process.exit(refs>=1?0:1)'

# Прибирання після перевірки
npm run destroy && npm run cluster:down
```





