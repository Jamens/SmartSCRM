-- V35: B9 互聊养号 · P10-2 执行链（发言执行记录）
-- 一次「某账号在某时间点某轮该发言」= 一行。tick 每 10s 跑一次，没有这张表就防不住重复发言。
--
-- 幂等靠 uk(plan_id, at_point, round_idx, account_id)：同一计划同时间点同轮同一账号只发一次。
-- slot_index 是可复现派发序号（由 plan.seed 派生），用于算可复现发言间隔（spec §3.2）。
--
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑 no-op。

CREATE TABLE IF NOT EXISTS `nurture_run` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT       NOT NULL,
  `plan_id`    BIGINT       NOT NULL,
  `account_id` BIGINT       NOT NULL COMMENT '哪个账号发（= 哪个 view）',
  `at_point`   VARCHAR(8)   NOT NULL COMMENT 'HH:mm',
  `round_idx`  INT          NOT NULL COMMENT '该时间点内第几轮，从 0 起',
  `slot_index` INT          NOT NULL DEFAULT 0 COMMENT '可复现派发序号，算间隔用',
  `text`       VARCHAR(512) NULL COMMENT '实际发出的正文（快照，便于回看）',
  `status`     VARCHAR(16)  NOT NULL DEFAULT 'pending'
               COMMENT 'pending|sending|success|failed|skipped',
  `msg_key`    VARCHAR(191) NULL,
  `error_detail` VARCHAR(255) NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_nr_slot` (`plan_id`, `at_point`, `round_idx`, `account_id`),
  KEY `idx_nr_tenant_status` (`tenant_id`, `status`),
  KEY `idx_nr_plan` (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B9 养号发言执行记录';
