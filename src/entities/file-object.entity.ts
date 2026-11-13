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
import { User } from './user.entity';

@Entity('files')
@Index('idx_files_owner_id', ['ownerId'])
export class FileObject {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 512, unique: true })
  key!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status!: 'PENDING' | 'COMPLETED' | 'FAILED';

  @Column({ type: 'bigint', nullable: true })
  size!: string | null;

  @Column({ name: 'upload_id', type: 'varchar', length: 255, nullable: true })
  uploadId!: string | null;

  @Column({ name: 'content_type', type: 'varchar', length: 128, default: 'application/octet-stream' })
  contentType!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  etag!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner!: User;
}
