-- B21 云账号池 · 分组表 + 云账号表（P12 数据层）。tenant 隔离。
-- v1：分组 CRUD + 云账号 CRUD + 批量转移 + 筛选（客户端）+ 同步到本地（写本地 platform_account 行）。
-- 时间列直接用语义名 created_at/updated_at（吸取 V36 教训）。
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑不报错。

CREATE TABLE IF NOT EXISTS `cloud_account_group` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT       NOT NULL,
  `name`        VARCHAR(64)  NOT NULL COMMENT '分组名',
  `remark`      VARCHAR(255) DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cloud_account_group_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B21 云账号池分组';

CREATE TABLE IF NOT EXISTS `cloud_account` (
  `id`                BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT       NOT NULL,
  `group_id`          BIGINT       DEFAULT NULL COMMENT '所属分组（cloud_account_group.id，可为空=未分组）',
  `name`              VARCHAR(64)  NOT NULL COMMENT '云号别名',
  `phone`             VARCHAR(32)  DEFAULT NULL COMMENT '绑定号码',
  `platform`          VARCHAR(16)  NOT NULL DEFAULT 'whatsapp' COMMENT 'whatsapp/telegram/line',
  `status`            VARCHAR(16)  NOT NULL DEFAULT 'offline' COMMENT 'online/offline/warming/banned',
  `synced_at`         DATETIME     DEFAULT NULL COMMENT '上次同步到本地的时间',
  `synced_account_id` BIGINT       DEFAULT NULL COMMENT '同步生成的本地账号 id（platform_account.id）',
  `remark`            VARCHAR(255) DEFAULT NULL,
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cloud_account_tenant` (`tenant_id`),
  KEY `idx_cloud_account_group` (`group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B21 云账号池';
