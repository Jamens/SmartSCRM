-- V28: B28 第三段——AI 人设(ai_persona) + 养号设置(ai_nurture_setting)。
-- 按 docs/superpowers/specs/2026-10-06-b28-ai-knowledge-design.md §3.5/§3.6 定模：
-- 人设挂在 ai_role 上（role_id），chat_conversation.ai_persona_id(V16 已留 deferred hook)指向它；
-- 养号设置按租户一份（uk(tenant_id)），存推荐参数。
--
-- 人设生成助手不调外部模型（遵循「不外连商业云」红线）：由渲染层/后端按模板(personaTemplateOf)
-- 产出草稿交人工确认，不自动落库。
--
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑 no-op。

CREATE TABLE IF NOT EXISTS `ai_persona` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT       NOT NULL,
  `role_id`    BIGINT       NULL COMMENT '归属角色，可空=不绑定',
  `name`       VARCHAR(100) NOT NULL,
  `tone`       VARCHAR(50)  NULL COMMENT '语气标签(助手据此套模板)',
  `prompt`     TEXT         NULL COMMENT '系统提示词正文',
  `template`   VARCHAR(50)  NULL COMMENT '从哪个模板生成，如 friendly/pro',
  `enabled`    TINYINT      NOT NULL DEFAULT 1 COMMENT '0 停用, 1 启用',
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_persona_tenant_role` (`tenant_id`, `role_id`),
  KEY `idx_persona_tenant_enabled` (`tenant_id`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B28 AI 人设';

CREATE TABLE IF NOT EXISTS `ai_nurture_setting` (
  `id`            BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT      NOT NULL,
  `daily_limit`   INT         NOT NULL DEFAULT 0 COMMENT '每日主动触达上限，0=不限',
  `active_ratio`  TINYINT     NOT NULL DEFAULT 50 COMMENT '主动/被动比例(百分数)',
  `quiet_hours`   VARCHAR(20) NULL COMMENT '静默时段，如 22:00-08:00',
  `recommend`     VARCHAR(20) NOT NULL DEFAULT 'balanced' COMMENT 'conservative | balanced | aggressive',
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_nurture_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B28 养号设置';
