import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Account } from './account.entity';
import { Product } from './product.entity';

@Entity('orders')
@Index('idx_orders_account_created_at', ['accountId', 'createdAt'])
@Index('idx_orders_pending', ['createdAt'], { where: "status = 'PENDING'" })
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'product_id', type: 'bigint' })
  productId!: string;

  @Column({ type: 'varchar', length: 4 })
  side!: 'BUY' | 'SELL';

  @Column({ type: 'varchar', length: 16 })
  type!: 'MARKET' | 'LIMIT';

  @Column({ type: 'varchar', length: 16 })
  status!: 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';

  @Column({ type: 'integer' })
  quantity!: number;

  // Money stored as integer in minor units (e.g. cents)
  @Column({ name: 'limit_price', type: 'bigint', nullable: true })
  limitPrice!: string | null;

  @Column({ name: 'execution_price', type: 'bigint', nullable: true })
  executionPrice!: string | null;

  @Column({ type: 'bigint', default: 0 })
  fee!: string;

  @Column({ name: 'total_amount', type: 'bigint' })
  totalAmount!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 64, unique: true, nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Account, (account) => account.orders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @ManyToOne(() => Product, (product) => product.orders, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;
}
