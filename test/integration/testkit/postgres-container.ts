import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { User, Account, Product, Order, Position, OrderTask } from '../../../src/entities';
import * as path from 'node:path';

let container: StartedPostgreSqlContainer | null = null;
let dataSource: DataSource | null = null;

export async function startPostgresContainer(): Promise<{
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
  uri: string;
}> {
  if (container && dataSource && dataSource.isInitialized) {
    return { container, dataSource, uri: container.getConnectionUri() };
  }

  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('broker_db')
    .withUsername('postgres')
    .withPassword('super_secret_db_pass_123')
    .start();

  const uri = container.getConnectionUri();

  dataSource = new DataSource({
    type: 'postgres',
    url: uri,
    entities: [User, Account, Product, Order, Position, OrderTask],
    migrations: [path.resolve(__dirname, '../../../src/migrations/*{.ts,.js}')],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();

  return { container, dataSource, uri };
}

export async function truncateAllTables(ds: DataSource): Promise<void> {
  // Fast TRUNCATE of all tables to guarantee clean test isolation
  await ds.query(
    'TRUNCATE TABLE "order_tasks", "orders", "positions", "accounts", "users", "products" RESTART IDENTITY CASCADE;',
  );
}

export async function stopPostgresContainer(): Promise<void> {
  if (dataSource && dataSource.isInitialized) {
    await dataSource.destroy();
    dataSource = null;
  }
  if (container) {
    await container.stop();
    container = null;
  }
}
