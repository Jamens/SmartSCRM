-- B21 云账号池 · 权限码（供 P12 CRUD + 批量转移 / 同步到本地端点接 A16 判定，同 V40/V42 做法）。
-- 号池属业务面，读=cloudaccount:read 写=cloudaccount:write。授予内置角色，admin 现有用户零影响。
-- Idempotent: INSERT IGNORE ... SELECT 按唯一 code 命中，重跑不新增不重复。

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '云账号池', 'cloudaccount', 1, '/cloud-accounts', 160 FROM `sys_menu` WHERE code = 'biz';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '云账号', 'cloudaccount:read', 2, '/cloud-accounts', 161 FROM `sys_menu` WHERE code = 'cloudaccount';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'cloudaccount:write', 3, 162 FROM `sys_menu` WHERE code = 'cloudaccount:read';

-- 授予内置角色：super_admin 走 CROSS JOIN 拿全量，tenant_admin 拿 cloudaccount 三码。
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m WHERE r.code = 'super_admin';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin' AND (m.code = 'cloudaccount' OR m.code = 'cloudaccount:read' OR m.code = 'cloudaccount:write');
