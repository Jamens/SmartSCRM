-- B22 收尾：部门三字段 + 子账号端口上限 + 重置密码权限码。
-- 1) sys_team 加 type(1=NORMAL/2=DC) / is_push_ticket(0/1) / powers(VARCHAR 权限串)；
-- 2) app_user 加 port_limit(INT NULL，NULL=不限量，受租户 seat_limit 约束)；
-- 3) 新增菜单码 user:resetPassword 并授予内置角色。
-- 全部幂等：ALTER 用 information_schema 守卫（Flyway DDL 隐式提交，半途失败重试会变 1060，
-- 守卫转 no-op）；菜单码用 INSERT IGNORE + SELECT 按 code 命中，角色授权用 INSERT IGNORE。

-- ---- 1a. sys_team.type ----
SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_team' AND COLUMN_NAME = 'type');
SET @s1 := IF(@c1 = 0,
             'ALTER TABLE `sys_team` ADD COLUMN `type` TINYINT NOT NULL DEFAULT 1 COMMENT ''1=NORMAL 2=DC'' AFTER `status`',
             'DO 0');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- 1b. sys_team.is_push_ticket ----
SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_team' AND COLUMN_NAME = 'is_push_ticket');
SET @s2 := IF(@c2 = 0,
             'ALTER TABLE `sys_team` ADD COLUMN `is_push_ticket` TINYINT NOT NULL DEFAULT 0 COMMENT ''1=推送工单'' AFTER `type`',
             'DO 0');
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- 1c. sys_team.powers ----
SET @c3 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_team' AND COLUMN_NAME = 'powers');
SET @s3 := IF(@c3 = 0,
             'ALTER TABLE `sys_team` ADD COLUMN `powers` VARCHAR(255) NULL COMMENT ''部门权限串(逗号分隔)'' AFTER `is_push_ticket`',
             'DO 0');
PREPARE st FROM @s3; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- 2a. app_user.port_limit ----
SET @c4 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'port_limit');
SET @s4 := IF(@c4 = 0,
             'ALTER TABLE `app_user` ADD COLUMN `port_limit` INT NULL COMMENT ''NULL=unlimited; bounded by tenant.seat_limit'' AFTER `status`',
             'DO 0');
PREPARE st FROM @s4; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- 3a. 菜单码 user:resetPassword（挂在 user 菜单下，type=3 按钮） ----
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '重置密码', 'user:resetPassword', 3, 8 FROM `sys_menu` WHERE `code` = 'user';

-- ---- 3b. 授权：super_admin 拿全量（含本行新增） ----
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m WHERE r.code = 'super_admin';

-- ---- 3c. 授权：tenant_admin 拿 user 子树（含本行新增的 resetPassword） ----
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin'
  AND m.code IN ('user', 'user:list', 'user:view', 'user:create', 'user:update', 'user:delete',
                 'user:assignRole', 'user:assignTeam', 'user:resetPassword');
