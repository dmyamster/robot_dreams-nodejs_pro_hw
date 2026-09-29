import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Account } from './account.entity';
import { Product } from './product.entity';

@Entity('positions')
@Unique('uq_positions_account_product', ['accountId', 'productId'])
export class Position {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'product_id', type: 'bigint' })
  productId!: string;

  @Column({ name: 'shares_count', type: 'integer' })
  sharesCount!: number;

  // Money stored as integer in minor units (e.g. cents)
  @Column({ name: 'average_buy_price', type: 'bigint' })
  averageBuyPrice!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Account, (account) => account.positions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @ManyToOne(() => Product, (product) => product.positions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;
}
