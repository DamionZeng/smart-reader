-- Optional init scripts for the local smart-reader PostgreSQL instance.
-- This directory is mounted into the container as
-- /docker-entrypoint-initdb.d and *.sql files here are executed once on the
-- very first startup (when the data volume is empty).
--
-- `pg_trgm` and `uuid-ossp` are commonly useful for fuzzy text matching and
-- UUID generation, but feel free to delete this file if you don't need them.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
