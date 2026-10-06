-- B23 客户跟进记录 · 权限码（供 P13 跟进记录 CRUD / 标签变更流水 / 批量打·撤标签接 A16 判定，同 V40/V42/V44 做法）。
-- 跟进属业务面，读=customerfollow:read 写=customerfollow:write。授予内置角色，admin 现有用户零影响。
-- Idempotent: INSERT IGNORE ... SELECT 按唯一 code 命中，重跑不新增不重复。

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '客户跟进', 'customerfollow', 1, '/customer-follow-ups', 170 FROM `sys_menu` WHERE code = 'biz';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '跟进记录', 'customerfollow:read', 2, '/customer-follow-ups', 171 FROM `sys_menu` WHERE code = 'customerfollow';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'customerfollow:write', 3, 172 FROM `sys_menu` WHERE code = 'customerfollow:read';

-- 授予内置角色：super_admin 走 CROSS JOIN 拿全量，tenant_admin 拿 customerfollow 三码。
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m WHERE r.code = 'super_admin';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin' AND (m.code = 'customerfollow' OR m.code = 'customerfollow:read' OR m.code = 'customerfollow:write');
