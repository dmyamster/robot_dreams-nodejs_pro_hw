export interface RetryOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  backoffFactor?: number;
  onRetry?: (error: any, attempt: number, delayMs: number) => void;
}

/**
 * Executes a transactional operation with an automatic retry pattern.
 *
 * Strictly catches only transient PostgreSQL concurrency error codes:
 * - '40001': serialization_failure (could not serialize access due to concurrent update/dependencies)
 * - '40P01': deadlock_detected (deadlock detected between concurrent transactions)
 *
 * Any other error (e.g. 23505 unique violation, 23503 foreign key violation,
 * check constraint or business validation failures) is immediately rethrown.
 *
 * The wrapped operation repeats from the very beginning, including fresh reads
 * under a new transaction snapshot.
 */
export async function withTransactionRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<{ result: T; retries: number }> {
  const maxRetries = options.maxRetries ?? 5;
  let delayMs = options.initialBackoffMs ?? 50;
  const backoffFactor = options.backoffFactor ?? 2;

  let attempt = 0;
  while (true) {
    try {
      const result = await operation(attempt);
      return { result, retries: attempt };
    } catch (error: any) {
      const pgCode = error?.code || error?.driverError?.code;

      // Strictly catch only 40001 or 40P01
      if (pgCode === '40001' || pgCode === '40P01') {
        attempt++;
        if (attempt > maxRetries) {
          console.error(
            `❌ [Retry] Перевищено ліміт спроб (${maxRetries}) для транзакції з кодом ${pgCode}`,
          );
          throw error;
        }

        const errorLabel =
          pgCode === '40001' ? '40001 (serialization_failure)' : '40P01 (deadlock_detected)';
        console.log(
          `🔄 [Retry] Піймано транзакційну колізію: ${errorLabel}. Спроба ${attempt}/${maxRetries}. Backoff затримка: ${delayMs} мс...`,
        );

        if (options.onRetry) {
          options.onRetry(error, attempt, delayMs);
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.round(delayMs * backoffFactor);
        continue;
      }

      // All other errors are non-retryable and must fail fast
      throw error;
    }
  }
}
