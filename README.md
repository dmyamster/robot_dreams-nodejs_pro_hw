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

## Grading

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=postgres DB_PASSWORD=super_secret_db_pass_123 DB_NAME=broker_db
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
```

```bash
# 1. Чиста компіляція
npm ci && npx tsc --noEmit

# 2. Збірка
npm run build

# 3. Створення схеми міграцією з нуля
npm run migrate

# 4. Перевірка статусу міграцій (показує [X])
npm run migrate:show

# 5. Перевірка відкату схеми
npm run migrate:revert

# 6. Повторне застосування міграції
npm run migrate

# 7. Ідемпотентний seed (два запуски поспіль)
npm run seed && npm run seed

# 8. Демонстрація N+1 до та після
npm run demo:nplus1

# 9. Агрегований звіт через QueryBuilder
npm run report

# 10. Статична перевірка обгортки зі сховищем
node -e "const s=require('./package.json').scripts;const bad=['migrate','seed']
  .filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);
  console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));
  process.exit(bad.length===0?0:1)"
```

### Команда перевірки кількості рядків після повторного seed
```bash
docker compose exec -T postgres psql -U postgres -d broker_db -c "SELECT count(*) AS users_count FROM users;" -c "SELECT count(*) AS accounts_count FROM accounts;" -c "SELECT count(*) AS products_count FROM products;" -c "SELECT count(*) AS orders_count FROM orders;" -c "SELECT count(*) AS positions_count FROM positions;"
```
*(Очікуваний результат: Users: 10, Accounts: 10, Products: 10, Orders: 20, Positions: 10).*


