import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('processed_messages')
export class ProcessedMessage {
  @PrimaryColumn({ name: 'message_id', type: 'varchar', length: 128 })
  messageId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  consumer!: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt!: Date;
}

