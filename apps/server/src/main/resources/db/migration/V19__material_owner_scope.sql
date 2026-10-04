-- V19: B17 P1 — material ownership scoping (个人 / 公共 / 联系人).
--
-- Before this, `material` had only tenant_id, so every material was visible to every
-- seat in the tenant. Three scopes:
--   public   — tenant-wide (owner_key NULL), the default so existing rows keep working
--   personal — owned by one seat (owner_key = app_user.id)
--   contact  — bound to one customer (owner_key = customer.id); shows up when composing
--              to that customer
--
-- Why a single `owner_key` column instead of two (owner_user_id + owner_customer_id):
-- MySQL unique indexes do not constrain NULL, so a two-column scheme cannot express
-- "one row per (tenant, scope, key)" at all — the public row would collide with itself
-- and personal/contact rows would each need their own partial index. One nullable key
-- column keeps a single lookup path for all three scopes. Same decision as
-- V9__conversation_setting_scope_key.sql, which this mirrors.
--
-- Deliberate difference from V9: V9's scope_key is COLLATE utf8mb4_bin because it holds
-- platform ids like 'A@c.us' that are case-sensitive. Here the key is always a numeric
-- app_user.id or customer.id, where binary collation buys nothing, so we keep the table
-- default. Revisit only if a non-numeric key is ever introduced.
--
-- Idempotent: guarded by information_schema so a re-run after a half-applied failure
-- (Flyway + MySQL DDL implicit commit means a bare ALTER would fail with 1060) is a no-op.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'material' AND COLUMN_NAME = 'owner_scope');
SET @s := IF(@c = 0,
             'ALTER TABLE `material` '
             'ADD COLUMN `owner_scope` VARCHAR(16)  NOT NULL DEFAULT ''public'' COMMENT ''public | personal | contact'', '
             'ADD COLUMN `owner_key`   VARCHAR(160) NULL     COMMENT ''personal: app_user.id; contact: customer.id; public: NULL'', '
             'ADD KEY `idx_material_owner` (`tenant_id`, `owner_scope`, `owner_key`)',
             'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
