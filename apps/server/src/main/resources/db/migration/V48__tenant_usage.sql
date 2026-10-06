-- V48: tenant usage / plan model for B24 home-page usage card (and B12 usage model seed).
-- NULL limit means "unlimited" (same convention as seat_limit in V15); *used columns default 0.
-- Idempotent: each column is only added when information_schema reports it absent. Flyway runs MySQL
-- DDL in implicit-commit mode, so a half-applied previous run would leave the column present and a bare
-- ALTER would then fail with 1060 (duplicate column) on retry. The guard turns that into a no-op.

SET @t := 'tenant';

SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'plan_name');
SET @s1 := IF(@c1 = 0, 'ALTER TABLE `tenant` ADD COLUMN `plan_name` VARCHAR(64) NULL COMMENT ''套餐名称'' AFTER `name`', 'DO 0');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'ai_token_limit');
SET @s2 := IF(@c2 = 0, 'ALTER TABLE `tenant` ADD COLUMN `ai_token_limit` INT NULL COMMENT ''AI Token 上限, NULL=不限'' AFTER `seat_limit`', 'DO 0');
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;

SET @c3 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'ai_token_used');
SET @s3 := IF(@c3 = 0, 'ALTER TABLE `tenant` ADD COLUMN `ai_token_used` INT NOT NULL DEFAULT 0 COMMENT ''AI Token 已用'' AFTER `ai_token_limit`', 'DO 0');
PREPARE st FROM @s3; EXECUTE st; DEALLOCATE PREPARE st;

SET @c4 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'translation_char_limit');
SET @s4 := IF(@c4 = 0, 'ALTER TABLE `tenant` ADD COLUMN `translation_char_limit` INT NULL COMMENT ''翻译字符上限, NULL=不限'' AFTER `ai_token_used`', 'DO 0');
PREPARE st FROM @s4; EXECUTE st; DEALLOCATE PREPARE st;

SET @c5 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'translation_char_used');
SET @s5 := IF(@c5 = 0, 'ALTER TABLE `tenant` ADD COLUMN `translation_char_used` INT NOT NULL DEFAULT 0 COMMENT ''翻译字符已用'' AFTER `translation_char_limit`', 'DO 0');
PREPARE st FROM @s5; EXECUTE st; DEALLOCATE PREPARE st;
