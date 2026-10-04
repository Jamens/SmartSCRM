-- V18: B28 P3 — admin-console permission codes for the AI transfer-to-human rules.
-- The rule table (V17) is tenant business data, so this subtree is a top-level
-- directory of its own rather than a child of the 'access' (RBAC) directory:
-- granting a tenant admin 'ai_rule' must not imply any role/team/user authority,
-- and the reverse must hold too.
--
-- Idempotent: every insert is INSERT IGNORE ... SELECT against a unique code, and
-- the role grants are INSERT IGNORE, so re-running adds nothing and duplicates nothing.

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT NULL, 'AI 应答', 'ai', 1, '/ai', 3
WHERE NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `code` = 'ai');

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '转人工规则', 'ai_rule', 2, '/ai/rules', 1 FROM `sys_menu` WHERE `code` = 'ai';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '规则列表', 'ai_rule:list', 3, 1 FROM `sys_menu` WHERE `code` = 'ai_rule';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '规则详情', 'ai_rule:view', 3, 2 FROM `sys_menu` WHERE `code` = 'ai_rule';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '规则新增', 'ai_rule:create', 3, 3 FROM `sys_menu` WHERE `code` = 'ai_rule';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '规则编辑', 'ai_rule:update', 3, 4 FROM `sys_menu` WHERE `code` = 'ai_rule';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '规则删除', 'ai_rule:delete', 3, 5 FROM `sys_menu` WHERE `code` = 'ai_rule';

-- super_admin already holds every menu via the CROSS JOIN in V14, but that grant ran
-- before these rows existed, so re-apply it for the new subtree.
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id
FROM `sys_role` r
CROSS JOIN `sys_menu` m
WHERE r.code = 'super_admin'
  AND m.code IN ('ai', 'ai_rule', 'ai_rule:list', 'ai_rule:view', 'ai_rule:create', 'ai_rule:update', 'ai_rule:delete');

-- tenant_admin manages its own tenant's transfer rules, so it gets the whole ai_rule
-- menu. platform_ops stays out: it holds only tenant:list and is a read-only
-- platform role by design.
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id
FROM `sys_role` r
JOIN `sys_menu` m ON m.code IN ('ai', 'ai_rule', 'ai_rule:list', 'ai_rule:view', 'ai_rule:create', 'ai_rule:update', 'ai_rule:delete')
WHERE r.code = 'tenant_admin';
