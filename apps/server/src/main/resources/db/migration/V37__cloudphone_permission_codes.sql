-- B10 云手机 · 权限码（供 P12 CRUD 端点接 A16 判定，同 V30 script:read/write 做法）。
-- 设备管理属业务面，读=cloudphone:read 写=cloudphone:write。授予内置角色，admin 现有用户零影响。
--
-- Idempotent: INSERT IGNORE ... SELECT 按唯一 code 命中，重跑不新增不重复。

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '云手机', 'cloudphone', 1, '/cloud-phone', 130 FROM `sys_menu` WHERE code = 'biz';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '设备管理', 'cloudphone:read', 2, '/cloud-phone', 131 FROM `sys_menu` WHERE code = 'cloudphone';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'cloudphone:write', 3, 132 FROM `sys_menu` WHERE code = 'cloudphone:read';

-- 授予内置角色：super_admin 走 CROSS JOIN 拿全量，tenant_admin 拿 cloudphone 三码。
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m WHERE r.code = 'super_admin';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin' AND (m.code = 'cloudphone' OR m.code = 'cloudphone:read' OR m.code = 'cloudphone:write');
