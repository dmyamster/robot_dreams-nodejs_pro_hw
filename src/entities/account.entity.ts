import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity.js';
import { Order } from './order.entity.js';
import { Position } from './position.entity.js';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'account_number', type: 'varchar', length: 32, unique: true })
  accountNumber!: string;

  // Money stored as integer in minor units (e.g., cents: 10000.00 USD = 1000000)
  @Column({ name: 'cash_balance', type: 'bigint', default: 1000000 })
  cashBalance!: string;

  @Column({ name: 'locked_balance', type: 'bigint', default: 0 })
  lockedBalance!: string;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => User, (user) => user.accounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany(() => Order, (order) => order.account)
  orders!: Order[];

  @OneToMany(() => Position, (position) => position.account)
  positions!: Position[];
}
