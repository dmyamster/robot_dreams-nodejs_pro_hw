import 'reflect-metadata';
import AppDataSource from './data-source';
import { Account } from './entities';
import { withTransactionRetry } from './retry';

export async function runRetryDemo(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  console.log('🔄 Підготовка до тесту retry-патерну (demo:retry)...');

  // 1. Pick test account and reset known starting balance
  const accountRepo = dataSource.getRepository(Account);
  const account = await accountRepo.findOneOrFail({
    where: {},
    order: { accountNumber: 'ASC' },
  });

  const INITIAL_BALANCE = 1000000n; // 1,000,000 minor units ($10,000.00)
  await dataSource.query(
    `UPDATE "accounts" SET "cash_balance" = $1 WHERE "id" = $2`,
    [INITIAL_BALANCE.toString(), account.id],
  );

  const DELTA_TX1 = 5000n; // +5000 ($50.00)
  const DELTA_TX2 = 7000n; // +7000 ($70.00)
  const EXPECTED_FINAL_BALANCE = INITIAL_BALANCE + DELTA_TX1 + DELTA_TX2; // 1,012,000

  console.log(`💰 Рахунок: ${account.accountNumber}`);
  console.log(`   Початковий баланс: ${INITIAL_BALANCE} центів`);
  console.log(`   Депозит Tx1: +${DELTA_TX1} центів`);
  console.log(`   Депозит Tx2: +${DELTA_TX2} центів`);
  console.log(`   Очікуваний баланс: ${EXPECTED_FINAL_BALANCE} центів`);
  console.log('⚡ Провокація serialization failure під ISOLATION LEVEL REPEATABLE READ...');

  // Barrier signals to orchestrate the race condition reliably
  let resolveTx1ReadDone: () => void;
  const tx1ReadPromise = new Promise<void>((r) => {
    resolveTx1ReadDone = r;
  });

  let resolveTx2ReadDone: () => void;
  const tx2ReadPromise = new Promise<void>((r) => {
    resolveTx2ReadDone = r;
  });

  let resolveTx1Committed: () => void;
  const tx1CommitPromise = new Promise<void>((r) => {
    resolveTx1Committed = r;
  });

  let serializationErrorsCaught = 0;

  // Transaction 1: Simple transaction under REPEATABLE READ
  const executeTx1 = async () => {
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction('REPEATABLE READ');
    try {
      const [row] = await qr.query(
        `SELECT "cash_balance" FROM "accounts" WHERE "id" = $1`,
        [account.id],
      );
      const balance = BigInt(row.cash_balance);

      // Signal Tx1 read complete
      resolveTx1ReadDone();

      // Wait until Tx2 reads with old snapshot
      await tx2ReadPromise;

      // Update and commit
      const updatedBalance = balance + DELTA_TX1;
      await qr.query(
        `UPDATE "accounts" SET "cash_balance" = $1, "updated_at" = NOW() WHERE "id" = $2`,
        [updatedBalance.toString(), account.id],
      );
      await qr.commitTransaction();
      resolveTx1Committed();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  };

  // Transaction 2: Protected with withTransactionRetry
  const executeTx2Operation = async (attempt: number) => {
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction('REPEATABLE READ');
    try {
      if (attempt === 0) {
        // Wait until Tx1 starts and reads
        await tx1ReadPromise;
      }

      // Read snapshot
      const [row] = await qr.query(
        `SELECT "cash_balance" FROM "accounts" WHERE "id" = $1`,
        [account.id],
      );
      const balance = BigInt(row.cash_balance);

      if (attempt === 0) {
        // Signal Tx2 read complete
        resolveTx2ReadDone();
        // Wait until Tx1 updates and commits!
        await tx1CommitPromise;
      }

      // Try updating. In attempt 0, this row was modified by Tx1 after Tx2's snapshot began!
      // PostgreSQL detects concurrent update under REPEATABLE READ and raises error 40001!
      const updatedBalance = balance + DELTA_TX2;
      await qr.query(
        `UPDATE "accounts" SET "cash_balance" = $1, "updated_at" = NOW() WHERE "id" = $2`,
        [updatedBalance.toString(), account.id],
      );
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  };

  // Run Tx1 in background and Tx2 with retry wrapper concurrently
  const tx1Promise = executeTx1();

  const retryResult = await withTransactionRetry(executeTx2Operation, {
    maxRetries: 5,
    initialBackoffMs: 50,
    backoffFactor: 2,
    onRetry: () => {
      serializationErrorsCaught++;
    },
  });

  await tx1Promise;

  // 3. Check final balance in database
  const [finalRow] = await dataSource.query(
    `SELECT "cash_balance" FROM "accounts" WHERE "id" = $1`,
    [account.id],
  );
  const finalBalance = BigInt(finalRow.cash_balance);

  // 4. Print results
  console.log('\n======================================================');
  console.log('             РЕЗУЛЬТАТИ DEMO:RETRY                    ');
  console.log('======================================================');
  console.log(`Початковий баланс:           ${INITIAL_BALANCE}`);
  console.log(`Депозит Tx1:                 +${DELTA_TX1}`);
  console.log(`Депозит Tx2:                 +${DELTA_TX2}`);
  console.log(`Очікуваний фінальний баланс: ${EXPECTED_FINAL_BALANCE}`);
  console.log(`Фактичний фінальний баланс:  ${finalBalance}`);
  console.log(`Піймано 40001 / 40P01 колізій: ${serializationErrorsCaught}`);
  console.log(`Кількість повторів (retries):  ${retryResult.retries}`);
  console.log(
    `Арифметичний стан:            ${finalBalance === EXPECTED_FINAL_BALANCE ? 'КОРЕКТНИЙ (ЗБІГАЄТЬСЯ)' : 'НЕКОРЕКТНИЙ'}`,
  );
  console.log('======================================================\n');

  // 5. Check invariants
  const arithmeticCorrect = finalBalance === EXPECTED_FINAL_BALANCE;
  const caughtExpectedConflict = serializationErrorsCaught >= 1 && retryResult.retries >= 1;

  if (!arithmeticCorrect || !caughtExpectedConflict) {
    console.error('❌ ПОРУШЕННЯ ІНВАРІАНТУ в demo:retry!');
    if (!caughtExpectedConflict) {
      console.error(
        `Помилка: очікувався щонайменше 1 повтор через 40001/40P01, отримано ${retryResult.retries}`,
      );
    }
    if (!arithmeticCorrect) {
      console.error(
        `Помилка: баланс розійшовся (очікувано ${EXPECTED_FINAL_BALANCE}, отримано ${finalBalance})`,
      );
    }
    process.exit(1);
  }

  console.log('✅ Retry-патерн успішно підтверджено: піймано 40001, проведено повтор з backoff, фінальний баланс точний.');
}

if (require.main === module) {
  runRetryDemo()
    .then(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Помилка в demo:retry:', err);
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      process.exit(1);
    });
}
