import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOutboxAndProcessedMessages1790692000000 implements MigrationInterface {
  name = "AddOutboxAndProcessedMessages1790692000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "outbox" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "aggregate_type" character varying(64) NOT NULL,
        "aggregate_id" character varying(64) NOT NULL,
        "type" character varying(64) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "published_at" TIMESTAMP WITH TIME ZONE,
        "attempts" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_outbox_id" PRIMARY KEY ("id")
      )`
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_outbox_unpublished" 
       ON "outbox" ("created_at", "id") 
       WHERE "published_at" IS NULL`
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "processed_messages" (
        "message_id" character varying(128) NOT NULL,
        "consumer" character varying(64) NOT NULL,
        "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processed_messages_message_consumer" PRIMARY KEY ("message_id", "consumer")
      )`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "processed_messages"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_unpublished"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox"`);
  }
}

