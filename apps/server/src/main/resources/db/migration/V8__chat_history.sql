-- P6: chat history (checklist B5) — the message log and its conversation projection.
-- Content is stored in plaintext inside the local database on purpose (privacy model
-- shared with the customer domain). Nothing here is seeded: both tables only ever
-- contain rows that a real embedded session produced.
-- The key columns (chat_key / msg_key) carry an explicit COLLATE utf8mb4_bin while the
-- rest of the table stays utf8mb4_unicode_ci: the platform serialised ids are
-- case-sensitive, and uk_msg is the idempotency contract — under a case-insensitive
-- collation two ids differing only in letter case compare equal and INSERT IGNORE drops
-- one of them without a trace. Display text (title, body) keeps the human collation.

CREATE TABLE `chat_conversation`
(
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`     BIGINT       NOT NULL,
    `account_id`    BIGINT       NOT NULL COMMENT 'platform_account.id',
    `platform`      VARCHAR(16)  NOT NULL COMMENT 'whatsapp | telegram',
    `chat_key`      VARCHAR(128) COLLATE utf8mb4_bin NOT NULL COMMENT 'WA: 8613...@c.us / 1234-5678@g.us; TG: numeric chat id',
    `title`         VARCHAR(256) NULL COMMENT 'peer name snapshot at ingest time',
    `is_group`      TINYINT(1)   NOT NULL DEFAULT 0,
    `customer_id`   BIGINT       NULL COMMENT 'filled when the chat matches a customer (Task 3 matching rules)',
    `last_msg_time` DATETIME(3)  NULL,
    `last_msg_body` VARCHAR(512) NULL COMMENT 'body, or the media summary for non-text messages',
    `unread_count`  INT          NOT NULL DEFAULT 0 COMMENT 'best effort: only live inbound frames move it (spec 收敛 11)',
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_conv` (`tenant_id`, `platform`, `account_id`, `chat_key`),
    KEY `idx_conv_list` (`tenant_id`, `account_id`, `last_msg_time`),
    CONSTRAINT `fk_conv_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_conv_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='conversation headers, projected from chat_message';

CREATE TABLE `chat_message`
(
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`     BIGINT       NOT NULL,
    `account_id`    BIGINT       NOT NULL,
    `platform`      VARCHAR(16)  NOT NULL COMMENT 'whatsapp | telegram',
    `chat_key`      VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    `msg_key`       VARCHAR(128) COLLATE utf8mb4_bin NOT NULL COMMENT 'WA: message.id._serialized; TG: platform message id',
    `direction`     VARCHAR(8)   NOT NULL COMMENT 'in | out',
    `customer_id`   BIGINT       NULL,
    `sender_key`    VARCHAR(128) NULL COMMENT 'group sender id; NULL for 1:1 chats',
    `sender_name`   VARCHAR(128) NULL,
    `body`          TEXT         NULL COMMENT 'text body; NULL for media-only messages',
    `media_type`    VARCHAR(16)  NOT NULL DEFAULT 'text' COMMENT 'text|image|audio|video|document|sticker|contact|location|unknown',
    `media_summary` VARCHAR(256) NULL COMMENT 'the "[图片]" style placeholder shown in the stream',
    `msg_time`      DATETIME(3)  NOT NULL COMMENT 'platform timestamp; clamped to ingest time when implausible',
    `status`        VARCHAR(16)  NOT NULL DEFAULT 'received' COMMENT 'in: received; out: pending|sent|delivered|read|failed',
    `source`        VARCHAR(16)  NOT NULL COMMENT 'live | backfill | app_send | native_send',
    `send_local_id` VARCHAR(64)  NULL COMMENT 'SendRegistry correlation id for rows this app sent',
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_msg` (`tenant_id`, `platform`, `account_id`, `chat_key`, `msg_key`),
    KEY `idx_msg_conv` (`tenant_id`, `account_id`, `chat_key`, `msg_time`),
    KEY `idx_msg_customer` (`tenant_id`, `customer_id`, `msg_time`),
    CONSTRAINT `fk_msg_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_msg_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='the message log; uk_msg is the idempotency contract';
