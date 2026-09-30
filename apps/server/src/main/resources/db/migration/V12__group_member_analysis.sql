-- V12__group_member_analysis.sql
-- P8/B6 群成员分析：群登记册 + 成员状态快照 + 进退流水。
--
-- 三张表的分工是本次设计的核心形状（spec §1 推论）：
--   快照定「谁在群里」，事件定「什么时候、被谁」。
-- 所以「进群时间」只有一个来源（事件），快照给不出——这两件事在库里就得分开存，
-- 不能在读的时候用建档时刻去补 `latest_join_at`，那会造出一条查不出来源的假记录。
--
-- `group_member_state` 同时是后续群运营阶段的目标池契约（spec §11）：列改名、语义变化、
-- 判退口径调整在本期交付后都属破坏性改动，要连同 spec §11 一起改。
CREATE TABLE `chat_group` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`         BIGINT       NOT NULL,
    `account_id`        BIGINT       NOT NULL,
    `platform`          VARCHAR(16)  NOT NULL DEFAULT 'whatsapp' COMMENT 'whatsapp | telegram(留位，采集实现排在 TG 采集链之后)',
    `chat_key`          VARCHAR(128) COLLATE utf8mb4_bin NOT NULL COMMENT '群的平台键；二进制排序，与 V8 会话头同款',
    `title`             VARCHAR(256) NULL,
    -- 覆盖率闸的分母。**只被成功快照覆盖**：失败拉取永不写这一列，否则分母会被一次坏快照压低，
    -- 下一次好快照算出来的覆盖率就会虚高到 100%，闸形同虚设（spec §6 陷阱①）。
    `participant_count` INT          NOT NULL DEFAULT 0 COMMENT '只被成功快照覆盖；覆盖率闸的分母',
    `last_snapshot_at`  DATETIME(3)  NULL,
    `snapshot_count`    INT          NOT NULL DEFAULT 0 COMMENT '成功快照次数',
    `is_final`          TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=群已解散/账号已退出；泵跳过建档，流水仍可读',
    `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_group` (`tenant_id`, `platform`, `account_id`, `chat_key`),
    KEY `idx_group_list` (`tenant_id`, `account_id`, `last_snapshot_at`),
    CONSTRAINT `fk_cg_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_cg_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='group registry; not derived from chat_conversation';

CREATE TABLE `group_member_state` (
    `id`                  BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`           BIGINT       NOT NULL,
    `account_id`          BIGINT       NOT NULL,
    `platform`            VARCHAR(16)  NOT NULL DEFAULT 'whatsapp' COMMENT 'whatsapp | telegram(留位)',
    `chat_key`            VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    `member_key`          VARCHAR(160) COLLATE utf8mb4_bin NOT NULL COMMENT 'WA: 8613xxx@c.us',
    `phone`               VARCHAR(32)  NULL COMMENT '客户回填的匹配依据；取不到留 NULL，不猜',
    `display_name`        VARCHAR(128) NULL,
    `role_type`           VARCHAR(16)  NOT NULL DEFAULT 'member' COMMENT 'member|admin|super',
    `is_in_group`         TINYINT(1)   NOT NULL DEFAULT 1,
    `join_count`          INT          NOT NULL DEFAULT 0,
    `latest_join_at`      DATETIME(3)  NULL COMMENT '进群时间；唯一来源是事件，快照写不出这一列',
    `latest_leave_at`     DATETIME(3)  NULL COMMENT '被快照推定退群的人恒为 NULL；非空只意味着有事件证据',
    `exit_method`         VARCHAR(24)  NULL COMMENT 'left|removed|snapshot_absent',
    `last_event_at`       DATETIME(3)  NULL,
    -- 与 latest_join_at 分列是硬要求：快照建档的人没有进群时间证据，
    -- 把建档时刻写进 latest_join_at 就是造一条查不出来的假记录。
    `first_seen_at`       DATETIME(3)  NOT NULL COMMENT '本应用第一次看见他，不是进群时间',
    `snapshot_seen_count` INT          NOT NULL DEFAULT 0 COMMENT '第几次成功快照里还看见他',
    `customer_id`         BIGINT       NULL COMMENT '由 phone 走既有号码匹配规则回填；读侧允许为空',
    `created_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_member` (`tenant_id`, `platform`, `account_id`, `chat_key`, `member_key`),
    KEY `idx_member_group` (`tenant_id`, `account_id`, `chat_key`, `is_in_group`),
    KEY `idx_member_phone` (`tenant_id`, `phone`),
    CONSTRAINT `fk_gms_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_gms_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='group member state snapshot; contract for later group-ops phases';

CREATE TABLE `group_member_event` (
    `id`             BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`      BIGINT       NOT NULL,
    `account_id`     BIGINT       NOT NULL,
    `platform`       VARCHAR(16)  NOT NULL DEFAULT 'whatsapp' COMMENT 'whatsapp | telegram(留位)',
    `chat_key`       VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    `group_title`    VARCHAR(256) NULL COMMENT '冗余一份发生时的群名：群后来改名不该改写历史流水',
    `member_key`     VARCHAR(160) COLLATE utf8mb4_bin NOT NULL COMMENT '目标人',
    `actor_key`      VARCHAR(160) COLLATE utf8mb4_bin NULL COMMENT '操作人；自己退群时与目标人同',
    `actor_name`     VARCHAR(128) NULL,
    `event_type`     VARCHAR(16)  NOT NULL COMMENT 'added|joined|left|removed|promoted|demoted',
    `occurred_at`    DATETIME(3)  NOT NULL,
    `source`         VARCHAR(16)  NOT NULL COMMENT 'system_message|live_event',
    -- 系统消息取 msgKey；在线事件取 actor|epochSec|action 合成。
    -- 在线事件那个 participant_changed 不带时间（spec §15#5），occurred_at 取到达时刻，
    -- 所以合成键里的 epochSec 是"观测时刻"而非真实时刻——重报去重仍成立，因为它对同一条事件是稳定的。
    `dedup_key`      VARCHAR(160) COLLATE utf8mb4_bin NOT NULL COMMENT '系统消息取 msgKey；在线事件取 actor|epochSec|action 合成',
    `raw_type`       VARCHAR(32)  NULL,
    `raw_subtype`    VARCHAR(48)  NULL,
    `body_snapshot`  VARCHAR(512) NULL,
    `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_event` (`tenant_id`, `platform`, `account_id`, `chat_key`, `dedup_key`, `event_type`, `member_key`),
    KEY `idx_event_group` (`tenant_id`, `account_id`, `chat_key`, `occurred_at`),
    CONSTRAINT `fk_gme_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_gme_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
    -- 刻意不设外键到 chat_message：事件行比消息行长寿，
    -- 清理聊天记录不该把进退史一起删掉（spec §3）。
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='group join/leave event log; outlives chat_message';

-- 回滚：
--   DROP TABLE IF EXISTS `group_member_event`;
--   DROP TABLE IF EXISTS `group_member_state`;
--   DROP TABLE IF EXISTS `chat_group`;
