import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User, Account, Product, Order, Position, OrderTask } from './entities';

const dbUrl = process.env.DATABASE_URL || process.env.DB_URL;

const AppDataSource = new DataSource({
  type: 'postgres',
  ...(dbUrl
    ? { url: dbUrl }
    : {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
        username: process.env.DB_USER || process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'super_secret_db_pass_123',
        database: process.env.DB_NAME || process.env.DB_DATABASE || 'broker_db',
      }),
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: [User, Account, Product, Order, Position, OrderTask],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  extra: {
    max: 60,
  },
});

export default AppDataSource;
