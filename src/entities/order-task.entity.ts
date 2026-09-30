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
import { Order } from './order.entity';

@Entity('order_tasks')
@Index('idx_order_tasks_pending', ['createdAt'], { where: "status = 'PENDING'" })
export class OrderTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'SEND_RECEIPT' })
  type!: string;

  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, any>;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

  @Column({ type: 'integer', default: 0 })
  processed!: number;

  @Column({ name: 'processed_by', type: 'varchar', length: 64, nullable: true })
  processedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Order, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'order_id' })
  order?: Order;
}
