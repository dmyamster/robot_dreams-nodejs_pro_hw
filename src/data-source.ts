import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User, Account, Product, Order, Position } from './entities';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  username: process.env.DB_USER || process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || process.env.DB_DATABASE || 'broker_db',
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: [User, Account, Product, Order, Position],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
});

export default AppDataSource;
