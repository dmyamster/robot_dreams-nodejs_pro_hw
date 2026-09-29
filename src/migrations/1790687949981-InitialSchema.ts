import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1790687949981 implements MigrationInterface {
    name = 'InitialSchema1790687949981'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "positions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "account_id" uuid NOT NULL, "product_id" bigint NOT NULL, "shares_count" integer NOT NULL, "average_buy_price" bigint NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_positions_account_product" UNIQUE ("account_id", "product_id"), CONSTRAINT "PK_17e4e62ccd5749b289ae3fae6f3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "products" ("id" BIGSERIAL NOT NULL, "symbol" character varying(16) NOT NULL, "name" character varying(255) NOT NULL, "description" text NOT NULL DEFAULT '', "sector" character varying(64) NOT NULL, "current_price" bigint NOT NULL, "trading_status" character varying(16) NOT NULL DEFAULT 'ACTIVE', "logo_url" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_9d0b826f53db84b8e4a90665646" UNIQUE ("symbol"), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "account_id" uuid NOT NULL, "product_id" bigint NOT NULL, "side" character varying(4) NOT NULL, "type" character varying(16) NOT NULL, "status" character varying(16) NOT NULL, "quantity" integer NOT NULL, "limit_price" bigint, "execution_price" bigint, "fee" bigint NOT NULL DEFAULT '0', "total_amount" bigint NOT NULL, "idempotency_key" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_59d6b7756aeb6cbb43a093d15a1" UNIQUE ("idempotency_key"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_orders_pending" ON "orders"  ("created_at") WHERE status = 'PENDING'`);
        await queryRunner.query(`CREATE INDEX "idx_orders_account_created_at" ON "orders"  ("account_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "account_number" character varying(32) NOT NULL, "cash_balance" bigint NOT NULL DEFAULT '1000000', "locked_balance" bigint NOT NULL DEFAULT '0', "currency" character varying(3) NOT NULL DEFAULT 'USD', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ffd1ae96513bfb2c6eada0f7d31" UNIQUE ("account_number"), CONSTRAINT "PK_5a7a02c20412299d198e097a8fe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "role" character varying(32) NOT NULL DEFAULT 'INVESTOR', "is_verified" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "positions" ADD CONSTRAINT "FK_0ed8ab557a8fb4125b8948bd79b" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "positions" ADD CONSTRAINT "FK_b14cd806b99fb8d15d13261e8ac" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_83e17453a20deec5b0bc9de55a9" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_ac832121b6c331b084ecc4121fd" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "accounts" ADD CONSTRAINT "FK_3000dad1da61b29953f07476324" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "accounts" DROP CONSTRAINT "FK_3000dad1da61b29953f07476324"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_ac832121b6c331b084ecc4121fd"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_83e17453a20deec5b0bc9de55a9"`);
        await queryRunner.query(`ALTER TABLE "positions" DROP CONSTRAINT "FK_b14cd806b99fb8d15d13261e8ac"`);
        await queryRunner.query(`ALTER TABLE "positions" DROP CONSTRAINT "FK_0ed8ab557a8fb4125b8948bd79b"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "accounts"`);
        await queryRunner.query(`DROP INDEX "public"."idx_orders_account_created_at"`);
        await queryRunner.query(`DROP INDEX "public"."idx_orders_pending"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TABLE "positions"`);
    }

}
