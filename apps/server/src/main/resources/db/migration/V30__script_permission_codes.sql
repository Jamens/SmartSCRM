-- V24: B8 炒群引擎 · 权限码（供 P9-1 CRUD 端点接 A16 判定，同 B28 knowledge:read/write 做法）。
-- 规则/剧本属业务配置面，读=script:read 写=script:write。授予内置角色，admin 现有用户零影响。
--
-- Idempotent: INSERT IGNORE ... SELECT 按唯一 code 命中，重跑不新增不重复。

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '炒群引擎', 'script', 1, '/script', 110 FROM `sys_menu` WHERE code = 'biz';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '剧本引擎', 'script:read', 2, '/script', 111 FROM `sys_menu` WHERE code = 'script';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'script:write', 3, 112 FROM `sys_menu` WHERE code = 'script:read';

-- 授予内置角色：super_admin 走 CROSS JOIN 拿全量，tenant_admin 拿 script 两码。
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m WHERE r.code = 'super_admin';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin' AND (m.code = 'script' OR m.code = 'script:read' OR m.code = 'script:write');
