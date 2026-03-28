-- Normalize template dialect to engine family + persist sandbox wire target
UPDATE schema_templates SET dialect = 'postgresql' WHERE dialect = 'postgresql-16';
UPDATE schema_templates SET dialect = 'mysql' WHERE dialect = 'mysql-8';
UPDATE schema_templates SET dialect = 'sqlite' WHERE dialect = 'sqlite-3';

ALTER TABLE schema_templates ALTER COLUMN dialect SET DEFAULT 'postgresql';

ALTER TABLE sandbox_instances
  ADD COLUMN IF NOT EXISTS sandbox_engine varchar(32) NOT NULL DEFAULT 'postgresql';
ALTER TABLE sandbox_instances
  ADD COLUMN IF NOT EXISTS sandbox_db_port integer NOT NULL DEFAULT 5432;
