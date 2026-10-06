-- V49: B25 media translation switches on translation_setting (OCR / ASR).
-- BOOLEAN NOT NULL DEFAULT 0 follows the existing voice_enabled convention; false = off.
-- Idempotent: each column is only added when information_schema reports it absent. Flyway runs
-- MySQL DDL in implicit-commit mode, so a half-applied previous run would leave the column
-- present and a bare ALTER would then fail with 1060 (duplicate column) on retry. The guard
-- turns that into a no-op.

SET @t := 'translation_setting';

SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'ocr_enabled');
SET @s1 := IF(@c1 = 0, 'ALTER TABLE `translation_setting` ADD COLUMN `ocr_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''图片翻译(OCR)开关'' AFTER `disable_chinese_prevent_send`', 'DO 0');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'asr_enabled');
SET @s2 := IF(@c2 = 0, 'ALTER TABLE `translation_setting` ADD COLUMN `asr_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''语音翻译(ASR)开关'' AFTER `ocr_enabled`', 'DO 0');
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;
