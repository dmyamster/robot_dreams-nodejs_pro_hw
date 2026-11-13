import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokens1790693000000 implements MigrationInterface {
  name = 'AddRefreshTokens1790693000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "family_id" uuid NOT NULL,
        "token_hash" character varying(128) NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_refresh_tokens_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "FK_refresh_tokens_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_token_hash"
      ON "refresh_tokens" ("token_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_family_id"
      ON "refresh_tokens" ("family_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_tokens_family_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_tokens_token_hash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
  }
}
