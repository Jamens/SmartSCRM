-- V53: B14 浏览器指纹注入——账号 ↔ 指纹档案的绑定关系 + Client Hints 三列。
-- 档案（`fingerprint_profile`）此前只有 CRUD 与模拟生成，生成结果从未下发到客户端，
-- 只用于展示。要让账号真的带上自己的运行环境，缺两样东西：一是"这个账号用哪份档案"，
-- 二是"这份档案的 UA 平台与 brands 是什么"（Client Hints 只能由主进程随请求头发出，
-- 页内脚本改不了，见 spec R5）。本迁移补齐。
--
-- `platform_account.fingerprint_profile_id` 可空不是偷懒，是规则：NULL = 该账号不施加
-- 任何指纹（spec R2）。未绑定是合法状态，不是"绑定了一份空档案"，所以绝不做兜底生成。
--
-- Idempotent: 走仓库惯例的 information_schema 守卫 + PREPARE/EXECUTE，
-- 列已存在时 DO 0，重跑安全。

-- ---- 1a. platform_account.fingerprint_profile_id ----
SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_account' AND COLUMN_NAME = 'fingerprint_profile_id');
SET @s1 := IF(@c1 = 0,
             'ALTER TABLE `platform_account` ADD COLUMN `fingerprint_profile_id` BIGINT NULL COMMENT ''绑定的指纹档案；NULL = 不施加任何指纹（R2）'' AFTER `view_id`',
             'DO 0');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- 1b. fingerprint_profile.ua_platform ----
SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fingerprint_profile' AND COLUMN_NAME = 'ua_platform');
SET @s2 := IF(@c2 = 0,
             'ALTER TABLE `fingerprint_profile` ADD COLUMN `ua_platform` VARCHAR(32) NULL COMMENT ''Client Hints 平台（如 "Windows"），缺则不改（R7）'' AFTER `user_agent`',
             'DO 0');
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- 1c. fingerprint_profile.ua_platform_version ----
SET @c3 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fingerprint_profile' AND COLUMN_NAME = 'ua_platform_version');
SET @s3 := IF(@c3 = 0,
             'ALTER TABLE `fingerprint_profile` ADD COLUMN `ua_platform_version` VARCHAR(32) NULL COMMENT ''Client Hints 平台版本（如 "15.0.0"），缺则不改'' AFTER `ua_platform`',
             'DO 0');
PREPARE st FROM @s3; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- 1d. fingerprint_profile.brands_json ----
SET @c4 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fingerprint_profile' AND COLUMN_NAME = 'brands_json');
SET @s4 := IF(@c4 = 0,
             'ALTER TABLE `fingerprint_profile` ADD COLUMN `brands_json` VARCHAR(512) NULL COMMENT ''Client Hints brands JSON，形如 [{"brand":"Chromium","version":"140"}]'' AFTER `ua_platform_version`',
             'DO 0');
PREPARE st FROM @s4; EXECUTE st; DEALLOCATE PREPARE st;
