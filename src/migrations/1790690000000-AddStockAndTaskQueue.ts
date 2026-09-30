import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStockAndTaskQueue1790690000000 implements MigrationInterface {
  name = 'AddStockAndTaskQueue1790690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock" integer NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "order_tasks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" uuid,
        "type" character varying(32) NOT NULL DEFAULT 'SEND_RECEIPT',
        "payload" jsonb NOT NULL DEFAULT '{}',
        "status" character varying(16) NOT NULL DEFAULT 'PENDING',
        "processed" integer NOT NULL DEFAULT 0,
        "processed_by" character varying(64),
        "error" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_tasks_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_tasks_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_order_tasks_pending" ON "order_tasks" ("created_at") WHERE status = 'PENDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_order_tasks_pending"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_tasks"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "stock"`);
  }
}
