-- V11__batch_send.sql
-- P7/B7 批量群发：任务头 + 明细。展开（seq/content_index/body）在创建事务里一次做完，
-- 引擎之后只读明细、只写回状态，所以 uk_bsd_seq 是「同一任务不会跑出两条同序」的最后一道闸。
-- dry_run 在任务头而不在明细：演练是整个任务的属性，不允许一半一半。
CREATE TABLE `batch_send_task` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`         BIGINT       NOT NULL,
    `name`              VARCHAR(64)  NOT NULL,
    `platform`          VARCHAR(16)  NOT NULL DEFAULT 'whatsapp' COMMENT 'whatsapp | telegram(留位，第一版不放开)',
    `dry_run`           TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=演练：出料口只记账，不碰页面',
    `status`            VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending|running|paused|done|error|cancelled',
    `account_ids`       TEXT         NOT NULL COMMENT 'JSON 数组：参与账号（platform_account.id）',
    `contents`          TEXT         NOT NULL COMMENT 'JSON 数组：文本模板，顺序即 content_index',
    `msg_interval_min`  INT          NOT NULL DEFAULT 3 COMMENT '同一收件人两条内容之间，秒',
    `msg_interval_max`  INT          NOT NULL DEFAULT 8,
    `chat_interval_min` INT          NOT NULL DEFAULT 5 COMMENT '换一个收件人之间，秒',
    `chat_interval_max` INT          NOT NULL DEFAULT 15,
    `total_count`       INT          NOT NULL DEFAULT 0,
    `sent_count`        INT          NOT NULL DEFAULT 0,
    `fail_count`        INT          NOT NULL DEFAULT 0,
    `heartbeat_at`      DATETIME(3)  NULL COMMENT '引擎心跳；reconcile 的唯一依据',
    `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_bst_tenant_status` (`tenant_id`, `status`, `id`),
    CONSTRAINT `fk_bst_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='batch send tasks';

CREATE TABLE `batch_send_detail` (
    `id`            BIGINT        NOT NULL AUTO_INCREMENT,
    `tenant_id`     BIGINT        NOT NULL,
    `task_id`       BIGINT        NOT NULL,
    `seq`           INT           NOT NULL COMMENT '执行序：收件人为主，同人内容连续',
    `account_id`    BIGINT        NOT NULL,
    `chat_key`      VARCHAR(128)  COLLATE utf8mb4_bin NOT NULL,
    `customer_id`   BIGINT        NULL,
    `content_index` INT           NOT NULL,
    `body`          TEXT          NOT NULL COMMENT '渲染后的最终文本快照：事后能看到究竟发出去什么',
    `local_id`      VARCHAR(64)   NULL COMMENT '引擎为这条生成的 id，回执靠它对上',
    `send_status`   VARCHAR(16)   NOT NULL DEFAULT 'pending' COMMENT 'pending|sending|success|failed|unknown|skipped',
    `error_code`    VARCHAR(32)   NULL,
    `error_detail`  VARCHAR(255)  NULL,
    `msg_key`       VARCHAR(160)  COLLATE utf8mb4_bin NULL COMMENT '回执原样存，撤回时才剥 _out 尾',
    `recall_status` VARCHAR(16)   NOT NULL DEFAULT 'none' COMMENT 'none|recalling|recalled|recall_failed',
    `recall_detail` VARCHAR(255)  NULL,
    `sent_at`       DATETIME(3)   NULL,
    `created_at`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_bsd_seq` (`tenant_id`, `task_id`, `seq`),
    KEY `idx_bsd_run` (`task_id`, `send_status`, `seq`),
    KEY `idx_bsd_recall` (`task_id`, `recall_status`),
    CONSTRAINT `fk_bsd_task` FOREIGN KEY (`task_id`) REFERENCES `batch_send_task` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='batch send details';

-- 回滚：
--   DROP TABLE IF EXISTS `batch_send_detail`;
--   DROP TABLE IF EXISTS `batch_send_task`;
