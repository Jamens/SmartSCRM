-- V32: B18 群自动加群 + B19 群自动踢人 · P9-4 数据层
-- 按 docs/superpowers/specs/2026-10-06-b18-b19-group-ops-design.md §3 定模。
-- 四张表：加群任务/邀请码明细 + 踢人任务/待踢成员明细。
--
-- 两条硬约束落在 schema 上：
--   ① **人工门**：group_kick_task.approval_status 独立于 status——规则跑完出名单是 pending，
--      人工审阅才 approved/rejected；执行链入口再判一次(§5)，不只靠 UI 挡。
--   ② **幂等**：uk(task_id, invite_code) / uk(task_id, participant_id)——同一个任务不重复建明细。
--
-- 全部 tenant_id 隔离。Idempotent: CREATE TABLE IF NOT EXISTS，重跑 no-op。

-- ================= B18 加群 =================
CREATE TABLE IF NOT EXISTS `group_join_task` (
  `id`                BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT       NOT NULL,
  `account_id`        BIGINT       NOT NULL COMMENT '用哪个号加群',
  `name`              VARCHAR(100) NOT NULL,
  `status`            VARCHAR(16)  NOT NULL DEFAULT 'pending'
                      COMMENT 'pending|confirmed|running|done|error|cancelled（人工门=confirmed 才能跑）',
  `interval_min_sec`  INT          NOT NULL DEFAULT 60  COMMENT '随机间隔下界（秒）',
  `interval_max_sec`  INT          NOT NULL DEFAULT 120 COMMENT '随机间隔上界（秒）',
  `jitter_pct`        INT          NOT NULL DEFAULT 20 COMMENT '抖动百分比，防固定间隔风控指纹',
  `total`             INT          NOT NULL DEFAULT 0,
  `succeeded`         INT          NOT NULL DEFAULT 0,
  `failed`            INT          NOT NULL DEFAULT 0,
  `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_gjt_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B18 加群任务';

CREATE TABLE IF NOT EXISTS `group_join_item` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT       NOT NULL,
  `task_id`       BIGINT       NOT NULL,
  `invite_code`   VARCHAR(255) NOT NULL COMMENT '邀请码（wa-js join 的唯一入参）',
  `group_id`      VARCHAR(64)  NULL COMMENT 'join 后回填',
  `group_name`    VARCHAR(255) NULL COMMENT '预览(getGroupInfoFromInviteCode)回填',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'pending'
                  COMMENT 'pending|joining|joined|failed|skipped',
  `error_detail`  VARCHAR(255) NULL,
  `msg_key`       VARCHAR(191) NULL,
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gji_task_code` (`task_id`, `invite_code`),
  KEY `idx_gji_tenant_task_status` (`tenant_id`, `task_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B18 加群明细（一码一行，断点粒度）';

-- ================= B19 踢人 =================
CREATE TABLE IF NOT EXISTS `group_kick_task` (
  `id`              BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT      NOT NULL,
  `account_id`      BIGINT      NOT NULL COMMENT '用哪个号踢（需该号在群里且是 admin）',
  `group_id`        VARCHAR(64) NOT NULL,
  `name`            VARCHAR(100) NOT NULL,
  `status`          VARCHAR(16) NOT NULL DEFAULT 'pending'
                    COMMENT 'pending|running|done|error|cancelled',
  `approval_status` VARCHAR(16) NOT NULL DEFAULT 'pending'
                    COMMENT '**人工门**：pending|approved|rejected——approved 才能进执行链',
  `rule`            JSON        NULL COMMENT '规则快照（规则会演进，存快照便于复现）',
  `total`           INT         NOT NULL DEFAULT 0,
  `succeeded`       INT         NOT NULL DEFAULT 0,
  `failed`          INT         NOT NULL DEFAULT 0,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_gkt_tenant_status` (`tenant_id`, `status`),
  KEY `idx_gkt_tenant_group` (`tenant_id`, `group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B19 踢人任务（带人工门）';

CREATE TABLE IF NOT EXISTS `group_kick_item` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`      BIGINT       NOT NULL,
  `task_id`        BIGINT       NOT NULL,
  `participant_id` VARCHAR(64)  NOT NULL,
  `display_name`   VARCHAR(255) NULL,
  `reason`         VARCHAR(255) NULL COMMENT '命中哪条规则',
  `status`         VARCHAR(16)  NOT NULL DEFAULT 'pending'
                   COMMENT 'pending|removing|removed|failed|skipped',
  `can_remove`     TINYINT      NULL COMMENT 'canRemove 结果；0=不可踢，执行时标 skipped 不硬踢',
  `error_detail`   VARCHAR(255) NULL,
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gki_task_participant` (`task_id`, `participant_id`),
  KEY `idx_gki_tenant_task_status` (`tenant_id`, `task_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B19 待踢成员明细（一人一行）';
