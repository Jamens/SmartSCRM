-- V26: B28 第一段——知识库三栏数据层（角色 / 分类 / QA 对）。
-- 按 docs/superpowers/specs/2026-10-06-b28-ai-knowledge-design.md §3.3/§3.4 定模：
-- 三栏（QA/角色/分类）是知识库的骨架，文档管线(knowledge_doc/chunk)、人设(ai_persona)、
-- 养号(ai_nurture_setting)都挂在它上面，所以先落这三张。
--
-- 约定：全部 tenant_id 隔离；uk(tenant_id,name) 防租户内重名；QA 的 role_id/category_id 可空
-- （=不绑定），source 区分 manual(手写)/derived(由分片派生)，status 1启用/0停用。
--
-- Idempotent: CREATE TABLE IF NOT EXISTS 是重跑 no-op；Flyway DDL 隐式提交，重复执行裸 CREATE
-- 会撞 1050(table exists)，故用 IF NOT EXISTS。

-- 角色：人设提示词挂在角色上（prompt），enabled 控是否参与
CREATE TABLE IF NOT EXISTS `ai_role` (
  `id`         BIGINT        NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT        NOT NULL,
  `name`       VARCHAR(100)  NOT NULL,
  `prompt`     TEXT          NULL     COMMENT '人设提示词，喂 AI 人设引擎',
  `enabled`    TINYINT       NOT NULL DEFAULT 1 COMMENT '0 停用不参与, 1 参与',
  `sort`       INT           NOT NULL DEFAULT 0,
  `created_at` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_tenant_name` (`tenant_id`, `name`),
  KEY `idx_role_tenant_enabled` (`tenant_id`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B28 AI 角色';

-- 分类：纯字典，QA 可挂
CREATE TABLE IF NOT EXISTS `ai_category` (
  `id`         BIGINT        NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT        NOT NULL,
  `name`       VARCHAR(100)  NOT NULL,
  `sort`       INT           NOT NULL DEFAULT 0,
  `created_at` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_category_tenant_name` (`tenant_id`, `name`),
  KEY `idx_category_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B28 AI 分类';

-- QA 对：三栏里的 QA，手写或由文档分片派生而来
CREATE TABLE IF NOT EXISTS `knowledge_qa` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT       NOT NULL,
  `role_id`     BIGINT       NULL COMMENT '归属角色，可空=不绑定',
  `category_id` BIGINT       NULL COMMENT '归属分类，可空=不绑定',
  `question`    TEXT         NOT NULL,
  `answer`      TEXT         NOT NULL,
  `source`      VARCHAR(20)  NOT NULL DEFAULT 'manual' COMMENT 'manual 手写 | derived 由分片派生',
  `doc_id`      BIGINT       NULL COMMENT '派生来源文档，手写为空',
  `chunk_id`    BIGINT       NULL COMMENT '派生来源分片，手写为空',
  `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '0 停用不参与, 1 启用',
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_qa_tenant_status` (`tenant_id`, `status`),
  KEY `idx_qa_role` (`tenant_id`, `role_id`),
  KEY `idx_qa_category` (`tenant_id`, `category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B28 知识库 QA 对';

-- A16 配套：知识库三栏的权限码（控制器接 @PreAuthorize 用），授予内置角色，规则同 V24/V25。
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `path`, `sort`)
SELECT id, '知识库', 'knowledge:read', 2, '/ai', 100 FROM `sys_menu` WHERE code = 'biz';
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `code`, `type`, `sort`)
SELECT id, '编辑', 'knowledge:write', 3, 101 FROM `sys_menu` WHERE code = 'knowledge:read';

INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r CROSS JOIN `sys_menu` m WHERE r.code = 'super_admin';
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM `sys_role` r JOIN `sys_menu` m
WHERE r.code = 'tenant_admin' AND (m.code = 'knowledge:read' OR m.code = 'knowledge:write');
