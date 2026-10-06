-- V23: B8 炒群引擎 · P9-1 数据层（按 docs/superpowers/specs/2026-10-06-b8-script-engine-design.md §3）。
-- 七张表：三级角色库(品类→角色→动作模板) + 剧本(剧本→步骤) + 任务实例(任务→步骤)。
-- 幂等要靠 uk：① loop 会反复扫到期任务，uk(tenant_id,playbook_id,target_chat_key) 防同一群重复建任务；
-- ② 角色/分类/步骤/任务步骤的「租户内不重名/不重序」也都靠 uk。
-- 全部 tenant_id 隔离（租户隔离铁律）。
--
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑 no-op。

-- ---------- 三级角色库 ----------
CREATE TABLE IF NOT EXISTS `script_role_category` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT       NOT NULL,
  `name`       VARCHAR(100) NOT NULL COMMENT '品类，如 种草/测评/私域',
  `sort`       INT          NOT NULL DEFAULT 0,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_src_tenant_name` (`tenant_id`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B8 剧本角色库·品类';

CREATE TABLE IF NOT EXISTS `script_role` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT       NOT NULL,
  `category_id` BIGINT       NOT NULL,
  `name`        VARCHAR(100) NOT NULL COMMENT '角色，如 素人种草',
  `prompt`      TEXT         NULL COMMENT '人设提示词',
  `enabled`     TINYINT      NOT NULL DEFAULT 1,
  `sort`        INT          NOT NULL DEFAULT 0,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sr_tenant_cat_name` (`tenant_id`, `category_id`, `name`),
  KEY `idx_sr_tenant_cat` (`tenant_id`, `category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B8 剧本角色库·角色';

CREATE TABLE IF NOT EXISTS `script_action_tpl` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT      NOT NULL,
  `role_id`     BIGINT      NOT NULL,
  `action_type` VARCHAR(40) NOT NULL COMMENT '动作类型，见 shared/scriptActions.ts 词表',
  `name`        VARCHAR(100) NOT NULL,
  `params`      JSON        NULL COMMENT '话术引用/数量等参数',
  `enabled`     TINYINT     NOT NULL DEFAULT 1,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_sat_tenant_role` (`tenant_id`, `role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B8 剧本角色库·动作模板';

-- ---------- 剧本 ----------
CREATE TABLE IF NOT EXISTS `script_playbook` (
  `id`                BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT       NOT NULL,
  `role_id`           BIGINT       NOT NULL COMMENT '用哪个角色',
  `name`              VARCHAR(100) NOT NULL,
  `enabled`           TINYINT      NOT NULL DEFAULT 1,
  `loop_interval_sec` INT          NOT NULL DEFAULT 3600 COMMENT 'loop 间隔（秒）',
  `account_ids`       JSON         NULL COMMENT '有序账号列表= failover 顺序',
  `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_sp_tenant_role` (`tenant_id`, `role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B8 剧本';

CREATE TABLE IF NOT EXISTS `script_playbook_step` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT      NOT NULL,
  `playbook_id` BIGINT      NOT NULL,
  `seq`         INT         NOT NULL,
  `action_type` VARCHAR(40) NOT NULL,
  `params`      JSON        NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sps_playbook_seq` (`playbook_id`, `seq`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B8 剧本步骤';

-- ---------- 任务实例 ----------
CREATE TABLE IF NOT EXISTS `script_task` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT       NOT NULL,
  `playbook_id`     BIGINT       NOT NULL,
  `account_id`      BIGINT       NULL COMMENT '当前主账号',
  `target_chat_key` VARCHAR(191) NOT NULL,
  `target_group_id` VARCHAR(64)  NULL,
  `status`          VARCHAR(16)  NOT NULL DEFAULT 'pending'
                    COMMENT 'pending|running|paused|done|error|cancelled（与 batch-send 同词表）',
  `current_step`    INT          NOT NULL DEFAULT 0 COMMENT '断点：当前到第几步',
  `attempts`        INT          NOT NULL DEFAULT 0 COMMENT 'failover 计数',
  `last_error`      VARCHAR(255) NULL,
  `next_run_at`     DATETIME(3)  NULL COMMENT 'loop 下次触发',
  `heartbeat_at`    DATETIME(3)  NULL,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- 幂等：同一群 + 同一剧本只建一个任务（loop 反复扫不会重复建）
  UNIQUE KEY `uk_st_tenant_playbook_chat` (`tenant_id`, `playbook_id`, `target_chat_key`),
  KEY `idx_st_due` (`status`, `next_run_at`),
  KEY `idx_st_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B8 任务实例';

CREATE TABLE IF NOT EXISTS `script_task_step` (
  `id`           BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT      NOT NULL,
  `task_id`      BIGINT      NOT NULL,
  `seq`          INT         NOT NULL,
  `action_type`  VARCHAR(40) NOT NULL,
  `status`       VARCHAR(16) NOT NULL DEFAULT 'pending'
                 COMMENT 'pending|sending|success|failed|skipped（断点续跑粒度=每步一行）',
  `error_code`   VARCHAR(64) NULL,
  `error_detail` VARCHAR(255) NULL,
  `msg_key`      VARCHAR(191) NULL,
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sts_task_seq` (`task_id`, `seq`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B8 任务步骤';
