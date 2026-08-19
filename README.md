# mini-nest: Custom IoC Container (Part 1)

Власний IoC-контейнер на TypeScript з підтримкою автоматичного збирання графа залежностей за метаданими конструктора (`design:paramtypes`), явного впровадження через `@Inject(token)`, скоупів (`singleton`, `transient`) та захисту від циклічних залежностей.

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

## 📂 Структура проєкту

- `src/decorators/injectable.ts` — декоратор класу `@Injectable(options?)`
- `src/decorators/inject.ts` — параметр-декоратор `@Inject(token)`
- `src/container.ts` — ядро IoC-контейнера (`register`, `resolve`, детекція циклів, скоупи)
- `src/tokens.ts` — типи та утиліти токенів (`Token`, `Constructor`, `getTokenName`)
- `src/types.ts` — типи провайдерів та скоупів
- `src/index.ts` — точка входу бібліотеки
- `test/container.test.ts` — набір тестів
- `test/setup.ts` — ініціалізація `reflect-metadata` для тестового середовища
