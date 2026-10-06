-- V34: B9 互聊养号 · P10-1 数据层
-- 按 docs/superpowers/specs/2026-10-06-b9-nurture-plan-design.md §6 定模。
-- 一张表：养号计划（多账号进同一群、按可复现日程轮流发言）。
--
-- 三条设计约束落在 schema 上：
--   ① account_ids 存 JSON 数组，但**入库前按平台分组 + 稳定排序**（装箱的可复现前提，见 spec §3.1）；
--   ② seed 显式存列——日程与发言顺序全部由它派生，不用 Math.random（否则 last_run_date 断点接不上）；
--   ③ last_run_date 是**断点**：当天跑到哪个时间点/轮，重启后从这里接着来。
--
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑 no-op。

CREATE TABLE IF NOT EXISTS `nurture_plan` (
  `id`                 BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT       NOT NULL,
  `name`               VARCHAR(100) NOT NULL,
  `group_chat_key`     VARCHAR(191) NULL COMMENT '目标群；create_group=1 时可空（建完回填）',
  `create_group`       TINYINT      NOT NULL DEFAULT 0 COMMENT '1=需先建群再拉人（过 B18 人工门）',
  `account_ids`        JSON         NOT NULL COMMENT '参与账号 id 数组，**入库前按平台分组+稳定排序**',
  `per_group`          INT          NOT NULL DEFAULT 10 COMMENT '每群容纳账号数（装箱粒度）',
  `material_ids`       JSON         NULL COMMENT '话术池：存 B3 快捷回复 / B4 素材 id，不复制内容',
  `seed`               BIGINT       NOT NULL DEFAULT 1 COMMENT '可复现种子：日程/发言顺序全由它派生',
  `at_points`          JSON         NOT NULL COMMENT '每天时间点数组，如 ["09:30","20:00"]',
  `speaking_rounds`    INT          NOT NULL DEFAULT 1 COMMENT '每个时间点几轮',
  `interval_min_sec`   INT          NOT NULL DEFAULT 60,
  `interval_max_sec`   INT          NOT NULL DEFAULT 120,
  `jitter_pct`         INT          NOT NULL DEFAULT 20,
  `status`             VARCHAR(16)  NOT NULL DEFAULT 'pending'
                       COMMENT 'pending|confirmed|running|paused|done|error|cancelled（confirmed 人工门）',
  `last_run_date`      DATE         NULL COMMENT '断点：当天跑到哪个时间点，重启接着来',
  `created_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_np_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B9 互聊养号计划';
