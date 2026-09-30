-- Course project initial PostgreSQL setup
-- Initial password must match starting value in secrets/db_password
ALTER ROLE postgres WITH PASSWORD 'super_secret_db_pass_123';
SELECT 'CREATE DATABASE pact_broker' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pact_broker')\gexec
