-- V14: admin console RBAC. The sys_ prefix keeps platform-side tables physically
-- separated from tenant business tables inside the same schema, so platform
-- queries never mix with the tenant-scoped tables that carry a tenant_id filter.
--
-- app_user.tenant_id becomes nullable to hold platform-scope accounts (platform
-- administrators are not bound to a tenant). MySQL treats NULL as distinct in a
-- unique index, so a dedicated scope column is required to keep usernames unique
-- across both scopes.
--
-- Every statement below is guarded so a partially applied run can be re-executed
-- cleanly. MySQL commits each DDL implicitly, so a failure mid-script leaves a
-- half-migrated schema; unguarded DDL would then fail on the retry with errors
-- 1060 (duplicate column) or 1061 (duplicate key) instead of completing.
-- Flyway is configured for MySQL, so a failed version is not rolled back for us.

-- 1. tenant_id must accept NULL for platform accounts. MODIFY is idempotent.
ALTER TABLE `app_user`
    MODIFY COLUMN `tenant_id` BIGINT NULL COMMENT 'null for platform-scope accounts';

-- 2. scope column, added only when missing.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'scope');
SET @s := IF(@c = 0,
             'ALTER TABLE `app_user` ADD COLUMN `scope` TINYINT NOT NULL DEFAULT 2 COMMENT ''1=platform 2=tenant'' AFTER `tenant_id`',
             'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3. The FK on tenant_id leans on uk_user_tenant_username for its supporting
--    index, so MySQL rejects dropping that key with error 1553. Give the FK an
--    index of its own first, then drop the old composite unique key.
SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND INDEX_NAME = 'idx_user_tenant');
SET @s := IF(@i = 0, 'ALTER TABLE `app_user` ADD KEY `idx_user_tenant` (`tenant_id`)', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND INDEX_NAME = 'uk_user_tenant_username');
SET @s := IF(@i > 0, 'ALTER TABLE `app_user` DROP INDEX `uk_user_tenant_username`', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 4. Username uniqueness becomes scope-aware: a NULL tenant_id would otherwise
--    defeat the old key, since MySQL allows repeated NULLs in a unique index.
SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND INDEX_NAME = 'uk_user_scope_username');
SET @s := IF(@i = 0,
             'ALTER TABLE `app_user` ADD UNIQUE KEY `uk_user_scope_username` (`scope`, `username`)',
             'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `sys_menu`
(
    `id`         BIGINT       NOT NULL AUTO_INCREMENT,
    `parent_id`  BIGINT       NOT NULL DEFAULT 0 COMMENT '0=root',
    `name`       VARCHAR(64)  NOT NULL COMMENT 'menu label',
    `code`       VARCHAR(96)  NOT NULL COMMENT 'permission code, e.g. tenant:list',
    `type`       TINYINT      NOT NULL COMMENT '1=dir 2=menu 3=button(hidden from sidebar)',
    `path`       VARCHAR(191) NULL COMMENT 'route path, null for dir/button',
    `icon`       VARCHAR(64)  NULL,
    `sort`       INT          NOT NULL DEFAULT 0,
    `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_menu_code` (`code`),
    KEY `idx_menu_parent` (`parent_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='admin menu tree and permission source';

CREATE TABLE IF NOT EXISTS `sys_role`
(
    `id`         BIGINT      NOT NULL AUTO_INCREMENT,
    `tenant_id`  BIGINT      NULL COMMENT 'null for platform-scope roles',
    `name`       VARCHAR(64) NOT NULL,
    `code`       VARCHAR(64) NOT NULL,
    `scope`      TINYINT     NOT NULL COMMENT '1=platform 2=tenant',
    `builtin`    TINYINT     NOT NULL DEFAULT 0 COMMENT '1=undeletable',
    `status`     TINYINT     NOT NULL DEFAULT 1 COMMENT '1=active 0=disabled',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_role_scope_code` (`scope`, `code`),
    KEY `idx_role_tenant` (`tenant_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='admin role; tenant_id null for platform scope';

CREATE TABLE IF NOT EXISTS `sys_role_menu`
(
    `role_id` BIGINT NOT NULL,
    `menu_id` BIGINT NOT NULL,
    PRIMARY KEY (`role_id`, `menu_id`),
    KEY `idx_role_menu_menu` (`menu_id`),
    CONSTRAINT `fk_role_menu_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_role_menu_menu` FOREIGN KEY (`menu_id`) REFERENCES `sys_menu` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='role to menu grant';

CREATE TABLE IF NOT EXISTS `sys_team`
(
    `id`           BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`    BIGINT       NULL COMMENT 'null for platform-scope teams',
    `parent_id`    BIGINT       NOT NULL DEFAULT 0 COMMENT '0=root',
    `name`         VARCHAR(64)  NOT NULL,
    `leader_id`    BIGINT       NULL COMMENT 'app_user.id of the team lead',
    `scope`        TINYINT      NOT NULL COMMENT '1=platform 2=tenant',
    `status`       TINYINT      NOT NULL DEFAULT 1,
    `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_team_tenant` (`tenant_id`),
    KEY `idx_team_parent` (`parent_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='admin team; tenant_id null for platform scope';

CREATE TABLE IF NOT EXISTS `sys_user_role`
(
    `user_id` BIGINT NOT NULL,
    `role_id` BIGINT NOT NULL,
    PRIMARY KEY (`user_id`, `role_id`),
    KEY `idx_user_role_role` (`role_id`),
    CONSTRAINT `fk_user_role_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_user_role_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='user to role assignment';

CREATE TABLE IF NOT EXISTS `sys_user_team`
(
    `user_id` BIGINT NOT NULL,
    `team_id` BIGINT NOT NULL,
    PRIMARY KEY (`user_id`, `team_id`),
    KEY `idx_user_team_team` (`team_id`),
    CONSTRAINT `fk_user_team_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_user_team_team` FOREIGN KEY (`team_id`) REFERENCES `sys_team` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='user to team membership';

-- Menu seed. One tree; visibility differs by role binding, not by separate
-- definitions. :list guards route entry, :view guards a single record, so
-- "may browse the list but not open a record" is expressible.
-- Seeds are idempotent: uk_menu_code turns a re-run into a no-op instead of error 1062.
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
VALUES (0, '平台管理', 'platform', 1, NULL, 1),
       (0, '权限管理', 'access', 1, NULL, 2);

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '租户管理', 'tenant', 2, '/tenant', 1 FROM `sys_menu` WHERE `code` = 'platform';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '租户列表', 'tenant:list', 3, 1 FROM `sys_menu` WHERE `code` = 'tenant';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '租户详情', 'tenant:view', 3, 2 FROM `sys_menu` WHERE `code` = 'tenant';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '租户新增', 'tenant:create', 3, 3 FROM `sys_menu` WHERE `code` = 'tenant';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '租户编辑', 'tenant:update', 3, 4 FROM `sys_menu` WHERE `code` = 'tenant';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '租户启停', 'tenant:status', 3, 5 FROM `sys_menu` WHERE `code` = 'tenant';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '租户删除', 'tenant:delete', 3, 6 FROM `sys_menu` WHERE `code` = 'tenant';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '配额设置', 'tenant:quota', 3, 7 FROM `sys_menu` WHERE `code` = 'tenant';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '角色管理', 'role', 2, '/role', 1 FROM `sys_menu` WHERE `code` = 'access';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '角色列表', 'role:list', 3, 1 FROM `sys_menu` WHERE `code` = 'role';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '角色详情', 'role:view', 3, 2 FROM `sys_menu` WHERE `code` = 'role';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '角色新增', 'role:create', 3, 3 FROM `sys_menu` WHERE `code` = 'role';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '角色编辑', 'role:update', 3, 4 FROM `sys_menu` WHERE `code` = 'role';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '角色删除', 'role:delete', 3, 5 FROM `sys_menu` WHERE `code` = 'role';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '权限分配', 'role:grant', 3, 6 FROM `sys_menu` WHERE `code` = 'role';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '团队管理', 'team', 2, '/team', 2 FROM `sys_menu` WHERE `code` = 'access';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '团队列表', 'team:list', 3, 1 FROM `sys_menu` WHERE `code` = 'team';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '团队详情', 'team:view', 3, 2 FROM `sys_menu` WHERE `code` = 'team';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '团队新增', 'team:create', 3, 3 FROM `sys_menu` WHERE `code` = 'team';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '团队编辑', 'team:update', 3, 4 FROM `sys_menu` WHERE `code` = 'team';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '团队删除', 'team:delete', 3, 5 FROM `sys_menu` WHERE `code` = 'team';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '成员管理', 'user', 2, '/user', 3 FROM `sys_menu` WHERE `code` = 'access';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '成员列表', 'user:list', 3, 1 FROM `sys_menu` WHERE `code` = 'user';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '成员详情', 'user:view', 3, 2 FROM `sys_menu` WHERE `code` = 'user';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '成员新增', 'user:create', 3, 3 FROM `sys_menu` WHERE `code` = 'user';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '成员编辑', 'user:update', 3, 4 FROM `sys_menu` WHERE `code` = 'user';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '成员删除', 'user:delete', 3, 5 FROM `sys_menu` WHERE `code` = 'user';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '角色分配', 'user:assignRole', 3, 6 FROM `sys_menu` WHERE `code` = 'user';

INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '团队分配', 'user:assignTeam', 3, 7 FROM `sys_menu` WHERE `code` = 'user';

-- Builtin roles. super_admin is platform scope and holds every menu; the tenant
-- roles intentionally exclude the platform subtree so the sidebar hides it.
INSERT IGNORE INTO `sys_role` (`tenant_id`, `name`, `code`, `scope`, `builtin`)
VALUES (NULL, '超级管理员', 'super_admin', 1, 1),
       (NULL, '平台运营', 'platform_ops', 1, 1);

INSERT IGNORE INTO `sys_role` (`tenant_id`, `name`, `code`, `scope`, `builtin`)
SELECT t.id, '租户管理员', 'tenant_admin', 2, 1
FROM `tenant` t
WHERE t.invite_code = 'DEMO0001';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id
FROM `sys_role` r
CROSS JOIN `sys_menu` m
WHERE r.code = 'super_admin';

-- Tenant roles get the access subtree only: role/team/user administration.
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id
FROM `sys_role` r
JOIN `sys_menu` m ON m.code IN ('access', 'role', 'role:list', 'role:view', 'role:create', 'role:update', 'role:delete',
                                'role:grant', 'team', 'team:list', 'team:view', 'team:create', 'team:update', 'team:delete',
                                'user', 'user:list', 'user:view', 'user:create', 'user:update', 'user:delete',
                                'user:assignRole', 'user:assignTeam')
WHERE r.code = 'tenant_admin';
