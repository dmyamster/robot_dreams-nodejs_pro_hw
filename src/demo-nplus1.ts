import 'reflect-metadata';
import { DataSource, Logger, QueryRunner } from 'typeorm';
import { User, Account, Product, Order, Position } from './entities';

class QueryCountLogger implements Logger {
  public queryCount = 0;
  private logQueries: boolean;

  constructor(logQueries = true) {
    this.logQueries = logQueries;
  }

  logQuery(query: string, _parameters?: any[], _queryRunner?: QueryRunner) {
    this.queryCount++;
    if (this.logQueries) {
      const singleLine = query.replace(/\s+/g, ' ').trim();
      const truncated = singleLine.length > 100 ? singleLine.substring(0, 100) + '...' : singleLine;
      console.log(`  [SQL #${this.queryCount}] ${truncated}`);
    }
  }

  logQueryError(error: string | Error, query: string, _parameters?: any[], _queryRunner?: QueryRunner) {
    console.error(`  [SQL ERROR] ${error} for query: ${query}`);
  }

  logQuerySlow(time: number, query: string, _parameters?: any[], _queryRunner?: QueryRunner) {
    console.warn(`  [SLOW SQL ${time}ms] ${query}`);
  }

  logSchemaBuild(_message: string, _queryRunner?: QueryRunner) {}
  logMigration(_message: string, _queryRunner?: QueryRunner) {}
  log(_level: 'log' | 'info' | 'warn', _message: any, _queryRunner?: QueryRunner) {}

  reset() {
    this.queryCount = 0;
  }
}

async function createLoggedDataSource(logger: QueryCountLogger): Promise<DataSource> {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    username: process.env.DB_USER || process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || process.env.DB_DATABASE || 'broker_db',
    synchronize: false,
    logger,
    logging: ['query'],
    entities: [User, Account, Product, Order, Position],
  });

  return ds.initialize();
}

export async function runDemo(): Promise<void> {
  const logger = new QueryCountLogger(true);
  const ds = await createLoggedDataSource(logger);

  try {
    const accountRepo = ds.getRepository(Account);
    const orderRepo = ds.getRepository(Order);
    const productRepo = ds.getRepository(Product);

    console.log(`\n===============================================================`);
    console.log(`  N+1 DEMO & FIX: Domain Graph (Account -> Orders -> Product)   `);
    console.log(`===============================================================\n`);

    // -------------------------------------------------------------------------
    // 1. НАЇВНИЙ ПІДХІД (Запити у циклі: N+1 проблема)
    // -------------------------------------------------------------------------
    console.log(`--- [1] Стратегія: Наївно (запити у циклі) ---`);
    logger.reset();

    const accounts = await accountRepo.find();
    const N = accounts.length;

    for (const acc of accounts) {
      const orders = await orderRepo.find({ where: { accountId: acc.id } });
      for (const ord of orders) {
        await productRepo.findOne({ where: { id: ord.productId } });
      }
    }

    const naiveQueryCount = logger.queryCount;
    console.log(`\n👉 Кількість SQL-запитів (наївно): ${naiveQueryCount}`);
    console.log(`   (1 запит на рахунки + ${N} запитів на ордери + запити на продукти для кожного ордера)\n`);

    // -------------------------------------------------------------------------
    // 2. ФІКС: relations / leftJoinAndSelect (Єдиний SQL-запит з JOIN)
    // -------------------------------------------------------------------------
    console.log(`--- [2] Стратегія: relations / leftJoinAndSelect ---`);
    logger.reset();

    await accountRepo
      .createQueryBuilder('account')
      .leftJoinAndSelect('account.orders', 'orders')
      .leftJoinAndSelect('orders.product', 'product')
      .getMany();

    const joinQueryCount = logger.queryCount;
    console.log(`\n👉 Кількість SQL-запитів (leftJoinAndSelect): ${joinQueryCount}`);
    console.log(`   (Всі дані графа завантажуються рівно за 1 оптимізований SQL-запит)\n`);

    // -------------------------------------------------------------------------
    // 3. ФІКС: relationLoadStrategy: 'query' (Батч-запити на рівні зв'язків)
    // -------------------------------------------------------------------------
    console.log(`--- [3] Стратегія: relationLoadStrategy: 'query' ---`);
    logger.reset();

    await accountRepo.find({
      relations: {
        orders: {
          product: true,
        },
      },
      relationLoadStrategy: 'query',
    });

    const batchQueryCount = logger.queryCount;
    console.log(`\n👉 Кількість SQL-запитів (relationLoadStrategy: 'query'): ${batchQueryCount}`);
    console.log(`   (Фіксована кількість запитів: 1 + рівні зв'язків, незалежно від розміру N)\n`);

    // -------------------------------------------------------------------------
    // ПІДСУМКОВА ЗВІТНА ТАБЛИЦЯ
    // -------------------------------------------------------------------------
    console.log(`===============================================================`);
    console.log(`                     РЕЗУЛЬТАТИ ВИМІРІВ                        `);
    console.log(`===============================================================`);
    console.table([
      {
        'Стратегія': 'наївно (запит у циклі)',
        'Кількість запитів': naiveQueryCount,
        'Опис складності': `≥ N (1 + N + M = ${naiveQueryCount})`,
        'Залежність від вибірки': 'Лінійно зростає з N',
      },
      {
        'Стратегія': 'relations / leftJoinAndSelect',
        'Кількість запитів': joinQueryCount,
        'Опис складності': '1',
        'Залежність від вибірки': 'Константа (не залежить від N)',
      },
      {
        'Стратегія': "relationLoadStrategy: 'query'",
        'Кількість запитів': batchQueryCount,
        'Опис складності': "1 + 2 × (рівнів зв'язків) = 4",
        'Залежність від вибірки': 'Константа (не залежить від N)',
      },
    ]);
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  runDemo()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Demo failed:', err);
      process.exit(1);
    });
}
