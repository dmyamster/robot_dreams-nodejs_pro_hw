import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFiles1790694000000 implements MigrationInterface {
  name = 'AddFiles1790694000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "files" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying(512) NOT NULL,
        "owner_id" uuid NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'PENDING',
        "size" bigint,
        "upload_id" character varying(255),
        "content_type" character varying(128) NOT NULL DEFAULT 'application/octet-stream',
        "etag" character varying(128),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_files_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_files_key" UNIQUE ("key"),
        CONSTRAINT "FK_files_owner_id" FOREIGN KEY ("owner_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_files_owner_id"
      ON "files" ("owner_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_files_owner_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "files"`);
  }
}
