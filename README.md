# Домашнє завдання: Docker multi-stage & Postgres service

Цей проєкт містить сервіс на Express (TypeScript) та базу даних PostgreSQL 17, оптимізовані для контейнеризації з multi-stage build, кешуванням шарів, non-root користувачем та healthcheck.

---

## 🚀 Команди запуску

### 1. Запуск у Production/CI режимі (одною командою)

Запуск сервісу та PostgreSQL у фоновому режимі:
```bash
docker compose -f docker-compose.yml up -d --build
```
Або без явного вказання файлу (якщо не потрібен dev override):
```bash
docker compose -f docker-compose.yml up -d
```

### 2. Запуск у Development режимі (з hot-reload та bind-mount)
```bash
docker compose up -d
```
У dev-режимі автоматично підключається `docker-compose.override.yml`, прокидаючи папку `./src` всередину контейнера з підтримкою `tsx watch`.

### 3. Перевірка статусу Healthcheck
```bash
docker inspect --format '{{.State.Health.Status}}' hw5_api
# Очікуваний результат: healthy
```

### 4. Зупинка сервісів
```bash
docker compose down
```

---

## 📦 Розміри образів та аналіз

| Образ | Опис | Розмір |
|---|---|---|
| `hw5-api:multi-stage` | Multi-stage збірка (`node:22-slim`, лише production dependencies, скомпільований `dist/`, non-root) | **~356 MB** (compressed size: ~81 MB) |
| `hw5-api:single-stage` | Збірка «в лоб» з однієї стадії (`node:22`, dev-залежності, вихідний код, typescript toolchain, кеш npm) | **~1.7 GB** (compressed size: ~421 MB) |

### 💡 Пояснення різниці у розмірі:
> Multi-stage build дозволяє використовувати легкий базовий образ `node:22-slim`, виконувати компіляцію у проміжній стадії `builder` та копіювати у фінальний образ `runner` виключно скомпільовані JS-файли та production-залежності (`npm ci --omit=dev`), повністю відкидаючи важкий TypeScript-компілятор, dev-залежності, кеш npm та інструменти збірки.

---

## 💾 Перевірка збереження даних (Persistence) у Postgres

Дані PostgreSQL зберігаються у іменованому volume `postgres_data` і не зникають при перезапуску контейнерів через `docker compose down`.

### Кроки перевірки:

1. **Створення нового запису через API**:
   ```bash
   curl -X POST http://localhost:3000/users \
     -H "Content-Type: application/json" \
     -d '{"name":"John Doe","email":"john@example.com"}'
   ```

2. **Перевірка наявності даних**:
   ```bash
   curl http://localhost:3000/users
   # Відповідь: [{"id":1,"name":"John Doe","email":"john@example.com","created_at":"..."}]
   ```

3. **Зупинка та видалення контейнерів (без прапорця `-v`)**:
   ```bash
   docker compose -f docker-compose.yml down
   ```

4. **Повторний запуск контейнерів**:
   ```bash
   docker compose -f docker-compose.yml up -d
   ```

5. **Повторна перевірка наявності даних**:
   ```bash
   curl http://localhost:3000/users
   # Дані успішно збереглися: [{"id":1,"name":"John Doe","email":"john@example.com","created_at":"..."}]
   ```

---

## 🛠 Ендпоінти сервісу

- `GET /health` — статус сервісу та перевірка з'єднання з Postgres (200 OK).
- `GET /users` — отримання списку користувачів із БД.
- `POST /users` — створення нового користувача (`{ "name": "...", "email": "..." }`).
