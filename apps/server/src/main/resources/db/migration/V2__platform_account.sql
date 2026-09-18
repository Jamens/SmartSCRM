-- Platform accounts managed by a tenant. view_id is the client-generated
-- persistent partition key so a reopened account keeps its login session.

CREATE TABLE `platform_account`
(
    `id`            BIGINT      NOT NULL AUTO_INCREMENT,
    `tenant_id`     BIGINT      NOT NULL,
    `platform_type` TINYINT     NOT NULL COMMENT '1=WhatsApp 2=Line 3=AIStar 4=Telegram 5=Facebook 6=Messenger 7=WAProtocol',
    `name`          VARCHAR(128) NOT NULL COMMENT 'display nickname',
    `phone`         VARCHAR(64)  NULL,
    `avatar`        VARCHAR(255) NULL,
    `view_id`       VARCHAR(64)  NOT NULL COMMENT 'client partition key (persist:<viewId>)',
    `status`        TINYINT      NOT NULL DEFAULT 0 COMMENT '0=offline 1=online',
    `remark`        VARCHAR(255) NULL,
    `last_login_at` DATETIME(3)  NULL,
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_account_tenant_view` (`tenant_id`, `view_id`),
    KEY `idx_account_tenant_platform` (`tenant_id`, `platform_type`),
    CONSTRAINT `fk_account_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='platform accounts';

-- Seed demo accounts for the DEMO tenant so the workspace is not empty on first run.
INSERT INTO `platform_account` (`tenant_id`, `platform_type`, `name`, `phone`, `view_id`, `remark`)
SELECT t.id, 1, 'WhatsApp 演示号', '+8613800000001', CONCAT('demo-wa-', t.id), '点击打开 web.whatsapp.com 登录'
FROM `tenant` t
WHERE t.invite_code = 'DEMO0001';

INSERT INTO `platform_account` (`tenant_id`, `platform_type`, `name`, `phone`, `view_id`, `remark`)
SELECT t.id, 4, 'Telegram 演示号', '+8613800000002', CONCAT('demo-tg-', t.id), '点击打开 web.telegram.org 登录'
FROM `tenant` t
WHERE t.invite_code = 'DEMO0001';
