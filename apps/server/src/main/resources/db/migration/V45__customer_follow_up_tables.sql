-- B23 客户跟进记录 · 跟进记录表 + 标签变更流水表（P13 数据层）。tenant 隔离。
--
-- 为什么流水表不能省：customer_label 是「撤标即删行」的关联表，撤标后行没了、没有任何审计痕迹，
-- 现有表推不出「谁在什么时候给哪个客户打/撤了哪个标签」。故 B23 新增 customer_label_change 流水表，
-- 由标签写入路径（单客户 setLabels 与批量打/撤标签）显式落流水。
--
-- 时间列直接用语义名 created_at/updated_at（吸取 V36 教训）。
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑不报错。

CREATE TABLE IF NOT EXISTS `customer_follow_up` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT       NOT NULL,
  `customer_id` BIGINT       NOT NULL COMMENT '所属客户',
  `type`        VARCHAR(16)  NOT NULL DEFAULT 'note' COMMENT 'note/call/email/meeting/other',
  `content`     VARCHAR(1000) NOT NULL COMMENT '跟进内容',
  `remind_at`   DATETIME     DEFAULT NULL COMMENT '下次跟进提醒时间（可为空）',
  `created_by`  VARCHAR(64)  DEFAULT NULL COMMENT '操作人（用户名，可为空）',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_follow_up_tenant` (`tenant_id`),
  KEY `idx_customer_follow_up_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B23 客户跟进记录';

CREATE TABLE IF NOT EXISTS `customer_label_change` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT      NOT NULL,
  `customer_id` BIGINT      NOT NULL COMMENT '所属客户',
  `label_id`    BIGINT      NOT NULL COMMENT '标签',
  `action`      VARCHAR(16) NOT NULL COMMENT 'add/remove',
  `operator`    VARCHAR(64) DEFAULT NULL COMMENT '操作人（用户名，可为空）',
  `created_at`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_label_change_tenant` (`tenant_id`),
  KEY `idx_customer_label_change_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B23 客户标签变更流水';
