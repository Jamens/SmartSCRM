-- V24: A16 桌面端授权判定——补业务侧菜单码（前置）。
--
-- 背景：A16 管理端侧已交付（V14 sys_menu/sys_role/sys_role_menu + AdminPermissionInterceptor +
--   @EnableMethodSecurity），但拦截器**只对 /api/admin/** 查权限填 menuCodes（其头注明写
--   "Only /api/admin/** pays the lookup; every other path is untouched"）。桌面业务接口
--   （/api/materials、/api/messages…）的 principal 里 menuCodes 是空的，role 只签发不参与判定。
--
-- 本迁移**只补数据、不改行为**：把业务侧各模块的权限码 seed 进 sys_menu，并授予现有内置角色，
-- 让它们在管理端菜单树里可见、可被授权。为后续"业务端点按 menuCodes 判定"备好地基——
-- 有了码 + 已授权，将来开判定时不会把现有用户挡在门外。
--
-- 命名沿用 V18 约定 `<模块>:<动作>`，type 1=dir / 2=menu / 3=button(侧栏隐藏)。
-- 每个模块一条 :read（菜单，type=2，带 path）+ 一条 :write（按钮，type=3，path=NULL）。
--
-- Idempotent: 全部 INSERT IGNORE ... SELECT 按唯一 code 命中，重跑不新增不重复；
-- 角色授予同样 INSERT IGNORE。super_admin 再走一次 CROSS JOIN 拿全量（含本批新码）。

-- 业务功能总目录（侧栏一组）
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
VALUES (0, '业务功能', 'biz', 1, 90);

-- 各业务模块：:read 菜单（带路由）
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '客户管理', 'customer:read', 2, '/customers', 10 FROM `sys_menu` WHERE code = 'biz';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '标签', 'label:read', 2, '/labels', 20 FROM `sys_menu` WHERE code = 'biz';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '人群包', 'audience:read', 2, '/audiences', 30 FROM `sys_menu` WHERE code = 'biz';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '快捷回复', 'quick_reply:read', 2, '/quick-replies', 40 FROM `sys_menu` WHERE code = 'biz';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '素材库', 'material:read', 2, '/materials', 50 FROM `sys_menu` WHERE code = 'biz';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '批量群发', 'broadcast:read', 2, '/broadcast', 60 FROM `sys_menu` WHERE code = 'biz';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '聊天记录', 'message:read', 2, '/messages', 70 FROM `sys_menu` WHERE code = 'biz';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '翻译中心', 'translation:read', 2, '/translation', 80 FROM `sys_menu` WHERE code = 'biz';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '消息中心', 'notification:read', 2, '/notifications', 90 FROM `sys_menu` WHERE code = 'biz';

-- 各业务模块：:write 按钮（侧栏隐藏，path=NULL），挂在对应 :read 菜单下
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'customer:write', 3, 11 FROM `sys_menu` WHERE code = 'customer:read';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'label:write', 3, 21 FROM `sys_menu` WHERE code = 'label:read';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'audience:write', 3, 31 FROM `sys_menu` WHERE code = 'audience:read';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'quick_reply:write', 3, 41 FROM `sys_menu` WHERE code = 'quick_reply:read';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'material:write', 3, 51 FROM `sys_menu` WHERE code = 'material:read';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'broadcast:write', 3, 61 FROM `sys_menu` WHERE code = 'broadcast:read';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'message:write', 3, 71 FROM `sys_menu` WHERE code = 'message:read';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'translation:write', 3, 81 FROM `sys_menu` WHERE code = 'translation:read';

-- 授予内置角色：super_admin 走 CROSS JOIN 拿全量（含本批），tenant_admin 拿整组业务码。
-- 这样"码已存在 + 现有角色已授权"，将来开判定时不会把当前用户挡在门外。
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m
WHERE r.code = 'super_admin';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin' AND (m.code = 'biz' OR m.code LIKE 'customer:%' OR m.code LIKE 'label:%'
  OR m.code LIKE 'audience:%' OR m.code LIKE 'quick_reply:%' OR m.code LIKE 'material:%'
  OR m.code LIKE 'broadcast:%' OR m.code LIKE 'message:%' OR m.code LIKE 'translation:%'
  OR m.code LIKE 'notification:%');
