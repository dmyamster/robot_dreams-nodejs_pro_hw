# mini-nest: Custom IoC Container & HTTP Routing with Validation (Part 1 & 2)

Власний IoC-контейнер та HTTP-шар на TypeScript з підтримкою маршрутизації на декораторах (`@Controller`, `@Get`, `@Post`), вилучення параметрів (`@Body`, `@Param`, `@Query`), валідації DTO через `class-validator` та диспетчеризації запитів на базі вбудованого `node:http`.

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

## 🔍 Як це працює

### 1. IoC-контейнер (Частина 1)
У TypeScript за замовчуванням уся інформація про типи стирається під час компіляції (Type Erasure) і не потрапляє у вихідний JavaScript-код. Проте, якщо в `tsconfig.json` увімкнено опції `"experimentalDecorators": true` та `"emitDecoratorMetadata": true`, компілятор TypeScript (`tsc`) аналізує класи, до яких застосовано хоча б один декоратор (наприклад, `@Injectable()`), і генерує службові метадані:

- `design:type`: тип властивості або члена класу.
- `design:paramtypes`: масив конструкторів типів параметрів конструктора або методу.
- `design:returntype`: тип значення, що повертається методом.

Якщо прибрати `emitDecoratorMetadata` або якщо на класі немає жодного декоратора, TypeScript не згенерує `design:paramtypes`, і `Reflect.getMetadata('design:paramtypes', Target)` поверне `undefined`.

Контейнер працює за таким алгоритмом:
1. Під час виклику `container.resolve(TargetClass)` перевіряється поточний шлях резолву (`resolutionPath`) для детекції циклічних залежностей ($A \to B \to A$). Якщо виявлено цикл, викидається зрозуміла помилка з повним ланцюгом класів.
2. Контейнер зчитує типи параметрів конструктора через `Reflect.getMetadata('design:paramtypes', TargetClass)`.
3. Для параметрів, типом яких є інтерфейси (оскільки інтерфейси не існують у рантаймі та перетворюються на `Object`), або примітиви, використовується параметр-декоратор `@Inject(token)`. Контейнер перевіряє наявність явного токена (наприклад, `Symbol` або рядок) у метаданих класу.
4. Контейнер рекурсивно резолвить кожну залежність (`resolve(paramToken, nextPath)`).
5. На основі скоупу (`singleton` або `transient`), заданого в `@Injectable({ scope: '...' })`, контейнер або повертає вже створений раніше екземпляр із кешу, або створює новий екземпляр (`new TargetClass(...dependencies)`).

---

### 2. HTTP-маршрутизація та диспетчеризація (Частина 2)

- `@Controller(prefix)` записує базовий префікс шляху в метадані класу контролера.
- `@Get(path)` / `@Post(path)` реєструють HTTP-метод, підшлях та ім'я методу-обробника в метаданих класу.
- `Router` збирає всі зареєстровані маршрути, склеює префікс контролера та шлях методу у фінальний патерн (наприклад, `/users/:id`), створює регулярні вирази для зіставлення шляхів та вилучення динамічних параметрів.
- `Dispatcher` слухає HTTP-запити на базі `node:http`:
  1. Зчитує URL, метод запиту та query-параметри.
  2. Для методів із тілом (`POST` тощо) асинхронно збирає чанки з `req.on('data')` та парсить JSON у `req.on('end')`.
  3. Знаходить відповідний маршрут у `Router`. Якщо маршрут не знайдено — повертає 404.
  4. Отримує екземпляр контролера через `Container` (забезпечуючи ін'єкцію залежностей із Частини 1).
  5. Формує масив аргументів для виклику методу контролера та викликає його.
  6. Серіалізує результат у JSON та повертає статус `200` (або `201` для `POST`).
  7. При помилці валідації повертає `400 Bad Request` із переліком полів та обмежень.

---

### 💡 Як параметр-декоратор знає, куди підставити значення

У сигнатурі функції-декоратора параметра TypeScript передає три аргументи: `(target: object, propertyKey: string | symbol | undefined, parameterIndex: number)`. Аргумент `parameterIndex` — це точний порядковий числовий індекс параметра в списку аргументів методу (`0` для першого аргументу, `1` для другого тощо).

Параметр-декоратори (`@Body()`, `@Param(name)`, `@Query(name)`) не витягують дані самостійно в момент виконання коду декоратора — вони лише зберігають у метаданих методу мапу відповідності індексів:
```typescript
{
  0: { index: 0, type: 'param', name: 'id' },
  1: { index: 1, type: 'query', name: 'limit' },
  2: { index: 2, type: 'body' }
}
```

У TypeScript порядок виконання декораторів строго визначений: параметр-декоратори виконуються **до** декоратора методу, а декоратор методу — **до** декоратора класу.

Під час надходження HTTP-запиту наш `Dispatcher`:
1. Зчитує метадані параметрів для викликаного методу через `Reflect.getMetadata(PARAMS_METADATA, prototype, methodName)`.
2. Зчитує масив очікуваних типів параметрів через `Reflect.getMetadata('design:paramtypes', prototype, methodName)`.
3. Послідовно конструює масив значень аргументів `args: any[] = []` для кожного індексу `i`:
   - якщо для індексу `i` задано тип `param`: витягує значення `params[name]` з розпарсеного шляху URL;
   - якщо задано `query`: витягує значення `queryParams[name]` з query-рядка;
   - якщо задано `body`: передає розпарсений JSON у `ValidationPipe` разом із класом DTO з `design:paramtypes[i]`. `ValidationPipe` трансформує об'єкт через `plainToInstance(DtoClass, rawBody)` та валідує через `validate(instance)`. Якщо є помилки, викидається `ValidationException`, а диспетчер повертає HTTP 400. У разі успіху в масив аргументів підставляється валідований екземпляр DTO (`instanceof DtoClass`).
4. Викликає метод контролера зі зібраним масивом: `await controllerInstance[handlerName](...args)`.

Завдяки цьому методу контролера не потрібно знати про `req`, `res` чи структуру HTTP-пакета — він отримує чисті, типізовані та валідовані аргументи на своїх визначених позиціях.

---

## 📂 Структура проєкту

- `src/decorators/injectable.ts` — декоратор класу `@Injectable(options?)`
- `src/decorators/inject.ts` — параметр-декоратор `@Inject(token)`
- `src/decorators/controller.ts` — декоратор класу `@Controller(prefix?)`
- `src/decorators/methods.ts` — декоратори методів `@Get(path?)`, `@Post(path?)`
- `src/decorators/params.ts` — параметр-декоратори `@Body()`, `@Param(name?)`, `@Query(name?)`
- `src/container.ts` — ядро IoC-контейнера (`register`, `resolve`, детекція циклів, скоупи)
- `src/router.ts` — збір маршрутів із метаданих та зіставлення URL
- `src/dispatcher.ts` — HTTP-диспетчер запитів поверх `node:http`
- `src/pipes/validation.pipe.ts` — пайп валідації DTO через `class-validator` та `class-transformer`
- `src/dto/create-user.dto.ts` — DTO з правилами валідації
- `src/tokens.ts` — типи та утиліти токенів (`Token`, `Constructor`, `getTokenName`)
- `src/types.ts` — типи провайдерів та скоупів
- `src/index.ts` — головна точка входу бібліотеки
- `test/container.test.ts` — тести IoC-контейнера
- `test/http.test.ts` — тести HTTP-маршрутизації, декораторів параметрів та валідації
- `test/setup.ts` — ініціалізація `reflect-metadata` для тестового середовища
