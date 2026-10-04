-- V15: seat quota for tenants. A NULL seat_limit means "unlimited" so existing
-- tenants keep working without a migration-time default; the admin console reads
-- NULL as 不限 (unlimited) and writes a concrete number through tenant:quota.
--
-- Idempotent: the column is only added when information_schema reports it absent.
-- Flyway runs MySQL DDL in implicit-commit mode, so a half-applied previous run
-- would leave the column present and a bare ALTER would then fail with 1060
-- (duplicate column) on retry. The guard turns that into a no-op.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant' AND COLUMN_NAME = 'seat_limit');
SET @s := IF(@c = 0,
             'ALTER TABLE `tenant` ADD COLUMN `seat_limit` INT NULL COMMENT ''NULL=unlimited seat quota'' AFTER `status`',
             'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
