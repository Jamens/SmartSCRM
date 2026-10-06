-- B14 浏览器指纹配置 · 权限码（供 P11 CRUD + generate 端点接 A16 判定，同 V40 proxy:read/write 做法）。
-- 指纹属业务面，读=fingerprint:read 写=fingerprint:write。授予内置角色，admin 现有用户零影响。
-- Idempotent: INSERT IGNORE ... SELECT 按唯一 code 命中，重跑不新增不重复。

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '浏览器指纹', 'fingerprint', 1, '/fingerprint-profiles', 150 FROM `sys_menu` WHERE code = 'biz';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '指纹档案', 'fingerprint:read', 2, '/fingerprint-profiles', 151 FROM `sys_menu` WHERE code = 'fingerprint';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'fingerprint:write', 3, 152 FROM `sys_menu` WHERE code = 'fingerprint:read';

-- 授予内置角色：super_admin 走 CROSS JOIN 拿全量，tenant_admin 拿 fingerprint 三码。
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m WHERE r.code = 'super_admin';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin' AND (m.code = 'fingerprint' OR m.code = 'fingerprint:read' OR m.code = 'fingerprint:write');
