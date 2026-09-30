import 'reflect-metadata';
import AppDataSource from './data-source';

export async function runWorkersDemo(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  console.log('⚙️ Підготовка до тесту воркер-пулу (demo:workers)...');

  // 1. Prepare batch of 20 tasks to ensure deterministic evaluation
  const TOTAL_TASKS = 20;
  const TASK_DURATION_MS = 50;
  const NUM_WORKERS = 4;

  // Clear previous test tasks or reset
  await dataSource.query(`DELETE FROM "order_tasks"`);

  for (let i = 1; i <= TOTAL_TASKS; i++) {
    await dataSource.query(
      `INSERT INTO "order_tasks" ("id", "type", "payload", "status", "processed", "created_at", "updated_at")
       VALUES (uuid_generate_v4(), 'SEND_RECEIPT', $1, 'PENDING', 0, NOW(), NOW())`,
      [JSON.stringify({ taskIndex: i, item: `OrderConfirmation-${i}` })],
    );
  }

  console.log(`📦 Створено ${TOTAL_TASKS} задач у статусі PENDING.`);
  console.log(`👷 Запуск пулу з ${NUM_WORKERS} паралельних воркерів (імітація роботи: ${TASK_DURATION_MS} мс/задача)...`);

  const sequentialTimeMs = TOTAL_TASKS * TASK_DURATION_MS;
  const startTime = Date.now();

  // 2. Define worker runner utilizing FOR UPDATE SKIP LOCKED
  async function worker(workerId: string): Promise<void> {
    while (true) {
      let taskHandled = false;

      // Keep transaction open for the duration of task processing
      await dataSource.transaction(async (manager) => {
        // Fetch 1 available pending task, skipping any locked by concurrent workers
        const tasks: { id: string }[] = await manager.query(
          `SELECT "id" FROM "order_tasks" 
           WHERE "status" = 'PENDING' 
           ORDER BY "created_at" ASC 
           LIMIT 1 
           FOR UPDATE SKIP LOCKED`,
        );

        if (tasks.length === 0) {
          // No free tasks locked right now
          return;
        }

        taskHandled = true;
        const taskId = tasks[0].id;

        // Simulate asynchronous external I/O (e.g. sending email, generating PDF)
        await new Promise((resolve) => setTimeout(resolve, TASK_DURATION_MS));

        // Mark task done, increment processed counter, save worker id
        await manager.query(
          `UPDATE "order_tasks" 
           SET "status" = 'COMPLETED', 
               "processed" = "processed" + 1, 
               "processed_by" = $1, 
               "updated_at" = NOW() 
           WHERE "id" = $2`,
          [workerId, taskId],
        );
      });

      if (!taskHandled) {
        // Check if there are any remaining PENDING tasks in the queue
        const [{ count }] = await dataSource.query(
          `SELECT COUNT(*) AS count FROM "order_tasks" WHERE "status" = 'PENDING'`,
        );
        if (Number(count) === 0) {
          // Queue is completely empty
          break;
        }
        // Other tasks might still be processing in concurrent transactions; pause and re-check
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }

  // 3. Launch all workers concurrently
  const workers = Array.from({ length: NUM_WORKERS }, (_, i) => `worker-${i + 1}`);
  await Promise.all(workers.map((id) => worker(id)));

  const totalTimeMs = Date.now() - startTime;

  // 4. Verify outcomes directly in PostgreSQL
  const [{ count: twiceCount }] = await dataSource.query(
    `SELECT COUNT(*) AS count FROM "order_tasks" WHERE "processed" > 1`,
  );
  const processedTwice = Number(twiceCount);

  const distributionRows: { processed_by: string; count: string }[] = await dataSource.query(
    `SELECT "processed_by", COUNT(*) AS count 
     FROM "order_tasks" 
     WHERE "status" = 'COMPLETED' 
     GROUP BY "processed_by" 
     ORDER BY "processed_by"`,
  );

  const [{ count: totalCompletedCount }] = await dataSource.query(
    `SELECT COUNT(*) AS count FROM "order_tasks" WHERE "status" = 'COMPLETED'`,
  );
  const totalCompleted = Number(totalCompletedCount);

  // 5. Print required output
  console.log('\n======================================================');
  console.log('            РЕЗУЛЬТАТИ DEMO:WORKERS                   ');
  console.log('======================================================');
  console.log(`Загальна кількість задач: ${TOTAL_TASKS}`);
  console.log(`Успішно оброблено: ${totalCompleted}`);
  console.log(`оброблено двічі: ${processedTwice}`);
  console.log('Розподіл задач по воркерах:');
  for (const row of distributionRows) {
    console.log(`  - ${row.processed_by}: ${row.count} задач`);
  }
  console.log(`Загальний час виконання: ${totalTimeMs} мс`);
  console.log(`Розрахунковий послідовний час: ${sequentialTimeMs} мс`);
  console.log('======================================================\n');

  // 6. Check invariants
  const activeWorkersCount = distributionRows.length;
  const isFasterThanSequential = totalTimeMs < sequentialTimeMs;
  const invariantValid =
    processedTwice === 0 &&
    totalCompleted === TOTAL_TASKS &&
    activeWorkersCount >= 2 &&
    isFasterThanSequential;

  if (!invariantValid) {
    console.error('❌ ПОРУШЕННЯ ІНВАРІАНТУ воркер-пулу!');
    if (processedTwice !== 0) console.error(`- Помилка: оброблено двічі = ${processedTwice}`);
    if (activeWorkersCount < 2) console.error(`- Помилка: задіяно менше ніж 2 воркери (${activeWorkersCount})`);
    if (!isFasterThanSequential) console.error(`- Помилка: час (${totalTimeMs}ms) не менший за послідовний (${sequentialTimeMs}ms)`);
    process.exit(1);
  }

  console.log('✅ Воркер-пул відпрацював коректно: жодна задача не оброблена двічі, чесний розподіл між воркерами, прискорення зафіксовано.');
}

if (require.main === module) {
  runWorkersDemo()
    .then(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Помилка в demo:workers:', err);
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(1);
    });
}
