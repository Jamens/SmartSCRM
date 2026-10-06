-- V25: A16 桌面端授权判定（续）——补平台账号模块权限码。
--
-- V24 seed 了 customer/label/audience/quick_reply/material/broadcast/message/translation/notification
-- 的业务码，唯独漏了平台账号（/api/platform-accounts），导致 PlatformAccountController 至今无法接
-- @PreAuthorize（没有对应码，标注=所有人 403）。本迁移补上 account:read / account:write 并授予内置角色。
--
-- Idempotent: INSERT IGNORE ... SELECT 按唯一 code 命中，重跑不新增不重复。

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '平台账号', 'account:read', 2, '/workspace', 5 FROM `sys_menu` WHERE code = 'biz';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'account:write', 3, 6 FROM `sys_menu` WHERE code = 'account:read';

-- 授予内置角色：super_admin 走 CROSS JOIN 拿全量，tenant_admin 拿 account 两码。
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m
WHERE r.code = 'super_admin';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin' AND (m.code = 'account:read' OR m.code = 'account:write');
