-- B13 代理池 · 权限码（供 P11 CRUD + test 端点接 A16 判定，同 V37 cloudphone:read/write 做法）。
-- 代理池属业务面，读=proxy:read 写=proxy:write。授予内置角色，admin 现有用户零影响。
-- Idempotent: INSERT IGNORE ... SELECT 按唯一 code 命中，重跑不新增不重复。

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '代理池', 'proxy', 1, '/proxy-pool', 140 FROM `sys_menu` WHERE code = 'biz';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '代理列表', 'proxy:read', 2, '/proxy-pool', 141 FROM `sys_menu` WHERE code = 'proxy';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'proxy:write', 3, 142 FROM `sys_menu` WHERE code = 'proxy:read';

-- 授予内置角色：super_admin 走 CROSS JOIN 拿全量，tenant_admin 拿 proxy 三码。
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m WHERE r.code = 'super_admin';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin' AND (m.code = 'proxy' OR m.code = 'proxy:read' OR m.code = 'proxy:write');
