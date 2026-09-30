import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Order } from './order.entity';
import { Position } from './position.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 16, unique: true })
  symbol!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'varchar', length: 64 })
  sector!: string;

  // Price stored as integer in minor units (e.g., cents: 150.00 USD = 15000)
  @Column({ name: 'current_price', type: 'bigint' })
  currentPrice!: string;

  @Column({ name: 'trading_status', type: 'varchar', length: 16, default: 'ACTIVE' })
  tradingStatus!: string;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Order, (order) => order.product)
  orders!: Order[];

  @OneToMany(() => Position, (position) => position.product)
  positions!: Position[];
}
