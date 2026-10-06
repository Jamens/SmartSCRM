-- V50: session credential import for B29.
-- Stores a platform session (an exported localStorage JSON blob) on a platform account so the
-- embedded view can be seeded to "already logged in" without scanning a QR code.
-- Idempotent per V48 style: the column is only added when information_schema reports it absent.

SET @t := 'platform_account';

SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'session_credential');
SET @s1 := IF(@c1 = 0,
  'ALTER TABLE `platform_account` ADD COLUMN `session_credential` MEDIUMTEXT NULL COMMENT ''导入的会话凭据(localStorage JSON), 替代扫码登录'' AFTER `view_id`',
  'DO 0');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;
