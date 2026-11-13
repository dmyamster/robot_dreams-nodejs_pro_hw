import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProcessedEvents1790691000000 implements MigrationInterface {
  name = "AddProcessedEvents1790691000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "processed_events" (
        "event_id" character varying(64) NOT NULL,
        "event_type" character varying(64) NOT NULL,
        "order_id" uuid,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processed_events_event_id" PRIMARY KEY ("event_id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "order_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "event_id" character varying(64) NOT NULL,
        "order_id" uuid,
        "message" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_notifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_order_notifications_event_id" UNIQUE ("event_id")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "processed_events"`);
  }
}
