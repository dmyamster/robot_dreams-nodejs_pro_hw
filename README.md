# mini-nest: Custom IoC Container & HTTP Request Lifecycle (Parts 1, 2 & 3)

Власний IoC-контейнер та повноцінний життєвий цикл HTTP-запиту в стилі NestJS на чистому Node.js (`node:http`, `node:async_hooks`, `reflect-metadata`, `zod@4`) без використання сторонніх вебфреймворків (`@nestjs/*`, `express`, `fastify`).

---

## 🔄 Життєвий цикл запиту (Request Lifecycle)

Кожен HTTP-запит у фреймворку проходить через суворо визначену послідовність етапів:

```
                  ┌────────────────────────────────────────────────────────┐
                  │                   Incoming HTTP Request                │
                  └───────────────────────────┬────────────────────────────┘
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │    RequestContext (AsyncLocalStorage + X-Request-Id)   │
                  └───────────────────────────┬────────────────────────────┘
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │                      1. Middleware                     │
                  └───────────────────────────┬────────────────────────────┘
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │                        2. Guard                        │
                  │              (Authorization check -> 403)              │
                  └───────────────────────────┬────────────────────────────┘
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │                 3. Interceptor (Before)                │
                  │                 (Start duration timer)                 │
                  └───────────────────────────┬────────────────────────────┘
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │                        4. Pipe                         │
                  │             (Zod 4 schema validation -> 400)           │
                  └───────────────────────────┬────────────────────────────┘
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │                       5. Handler                       │
                  │               (Controller method execution)            │
                  └───────────────────────────┬────────────────────────────┘
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │                 6. Interceptor (After)                 │
                  │             (Log METHOD /path — XX.X ms)               │
                  └───────────────────────────┬────────────────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      │                                               │
             [ Success Response ]                            [ Exception Thrown ]
                      │                                               │
                      ▼                                               ▼
         ┌─────────────────────────┐                     ┌─────────────────────────┐
         │ HTTP 200/201 (JSON Body)│                     │ 7. Exception Filter     │
         │ X-Request-Id Header     │                     │ NotFoundError -> 404    │
         └─────────────────────────┘                     │ ValidationError -> 400  │
                                                         │ Any other -> 500 (Safe) │
                                                         └─────────────────────────┘
```

### Послідовність викликів:
$$\text{Middleware} \to \text{Guard} \to \text{Interceptor (before)} \to \text{Pipe} \to \text{Handler} \to \text{Interceptor (after)} \to \text{Exception Filter}$$

---

## 🧠 Чому AsyncLocalStorage, а не глобальна змінна?

У Node.js використовується однопотоковий цикл подій (**Event Loop**) з асинхронним неблокуючим вводом/виводом. Коли сервер одночасно обробляє кілька HTTP-запитів, виконання коду перемикається між ними на кожній асинхронній операції (`await`, звернення до бази даних, читання файлу чи мережевий запит).

Якщо зберігати контекст запиту (наприклад, `requestId`, авторизованого користувача чи транзакцію) у звичайній **глобальній змінній** (або статичному полі класу):
1. **Запит A** записує свій `requestId = "AAA"` у глобальну змінну і робить `await db.findUser()`.
2. Поки Запит A чекає на відповідь від бази даних, надходить **Запит B**, який перезаписує ту саму глобальну змінну значенням `requestId = "BBB"`.
3. Коли Запит A відновлює виконання після `await`, він читає глобальну змінну і бачить уже чужий `requestId = "BBB"`. В результаті логер, сервіси та репозиторії Запиту A виводять дані Запиту B — відбувається критичний **витік контексту між паралельними запитами** (Cross-Request Context Leak).

**`AsyncLocalStorage`** із модуля `node:async_hooks` вирішує цю проблему на рівні рушія V8. Метод `RequestContext.run(store, callback)` прив'язує ізольоване сховище до поточного асинхронного ланцюга виконання (Async Execution Context). Коли потік виконання перемикається між асинхронними завданнями через `await`, Node.js автоматично відновлює правильний екземпляр сховища. Будь-який сервіс чи репозиторій на довільній глибині стеку викликів може безпечно отримати `RequestContext.getRequestId()` без явної передачі параметром у кожну функцію.

---

## 🚀 Як запустити

### Локально

1. **Встановлення залежностей**:
   ```bash
   npm install
   ```

2. **Запуск тестів**:
   ```bash
   npm test
   ```

3. **Компіляція TypeScript**:
   ```bash
   npm run build
   ```

### У Docker

Запуск тестів в ізольованому Docker-контейнері:
```bash
docker compose run --rm api npm test
```

---

## 🔍 Компоненти архітектури

### 1. IoC-контейнер (`src/container.ts`)
- Декларативна реєстрація залежностей через `@Injectable({ scope: 'singleton' | 'transient' })`.
- Ін'єкція залежностей за токенами через `@Inject(token)`.
- Автоматичний резолв дерева залежностей із детекцією циклічних посилань.

### 2. Guard (`src/guards/auth.guard.ts`)
- Реалізує інтерфейс `CanActivate`.
- Виконується **до** валідації в Pipe та обробника. Якщо `canActivate` повертає `false` — запит негайно відхиляється з кодом `403 Forbidden`, а контролер не викликається.

### 3. Interceptor (`src/interceptors/logging.interceptor.ts`)
- Реалізує інтерфейс `NestInterceptor`.
- Обгортає виклик обробника (`next.handle()`), дозволяючи виконувати логіку до і після виконання дії.
- `LoggingInterceptor` вимірює точну тривалість виконання та логує: `GET /users/1 — 1.2 ms`.

### 4. Pipe на Zod 4 (`src/pipes/zod-validation.pipe.ts`)
- Валідує та трансформує аргументи безпосередньо перед передачею в метод контролера.
- Використовує `zod@4` (`schema.safeParse`, `error.issues`).
- При помилці валідації викидає `ValidationError` (400) із детальним списком некоректних полів.

### 5. Exception Filter (`src/filters/exception.filter.ts`)
- Найвищий рівень перехоплення помилок усього ланцюга.
- Мапить:
  - `NotFoundError` $\to$ `404 Not Found` з інформативним повідомленням.
  - `ValidationError` $\to$ `400 Bad Request` зі списком полів.
  - `ForbiddenError` $\to$ `403 Forbidden`.
  - Невідомі помилки (`new Error('boom')`) $\to$ `500 Internal Server Error` без витоку внутрішнього тексту помилки та стек-трейсу назовні.

---

## 📂 Структура проєкту

- `src/context/request-context.ts` — обгортка над `AsyncLocalStorage` для контексту запиту
- `src/guards/auth.guard.ts` — перевірка заголовка Authorization (`AuthGuard`, `CanActivate`)
- `src/interceptors/logging.interceptor.ts` — вимірювання часу виконання (`LoggingInterceptor`, `NestInterceptor`)
- `src/pipes/zod-validation.pipe.ts` — пайп валідації схем Zod 4 (`ZodValidationPipe`, `PipeTransform`)
- `src/filters/exception.filter.ts` — обробка помилок та мапінг у HTTP-статуси (`DefaultExceptionFilter`, `ExceptionFilter`)
- `src/errors/http-errors.ts` — класи помилок (`HttpException`, `NotFoundError`, `ForbiddenError`, `ValidationError`)
- `src/services/users.service.ts` — сервіс і репозиторій, що демонструють отримання `requestId` з `RequestContext`
- `src/decorators/injectable.ts` — декоратор класу `@Injectable()`
- `src/decorators/inject.ts` — параметр-декоратор `@Inject()`
- `src/decorators/controller.ts` — декоратор класу `@Controller()`
- `src/decorators/methods.ts` — декоратори методів `@Get()`, `@Post()`
- `src/decorators/params.ts` — параметр-декоратори `@Body()`, `@Param()`, `@Query()`
- `src/container.ts` — ядро IoC-контейнера
- `src/router.ts` — збір та зіставлення маршрутів
- `src/dispatcher.ts` — HTTP-диспетчер запитів та виконання повного життєвого циклу
- `src/dto/create-user.dto.ts` — DTO на базі Zod-схеми
- `test/lifecycle-order.test.ts` — тест на точну послідовність 6 етапів життєвого циклу
- `test/lifecycle.test.ts` — тести Guard, Interceptor, Zod Pipe, Exception Filter, ALS та 10 паралельних запитів
- `test/http.test.ts` — тести маршрутизації та DTO
- `test/container.test.ts` — тести IoC-контейнера
