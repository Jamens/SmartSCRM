-- P3: customer domain. Multi-tenant scoped by tenant_id (FK -> tenant.id, cascade).
-- Model inferred from the legacy client's customer / label / audience API contracts.

CREATE TABLE `customer`
(
    `id`              BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`       BIGINT       NOT NULL,
    `platform_type`   TINYINT      NOT NULL COMMENT '1=WhatsApp 2=Line 3=AIStar 4=Telegram 5=Facebook 6=Messenger 7=WAProtocol',
    `open_id`         VARCHAR(128) NOT NULL COMMENT 'platform-side customer id',
    `nickname`        VARCHAR(128) NULL,
    `avatar`          VARCHAR(255) NULL,
    `phone`           VARCHAR(64)  NULL,
    `email`           VARCHAR(128) NULL,
    `country`         VARCHAR(64)  NULL,
    `sex`             TINYINT      NOT NULL DEFAULT 0 COMMENT '0=unknown 1=male 2=female',
    `remark`          VARCHAR(255) NULL,
    `vip_open_id`     VARCHAR(128) NULL,
    `vip_nickname`    VARCHAR(128) NULL,
    `first_seen_at`   DATETIME(3)  NULL,
    `last_contact_at` DATETIME(3)  NULL,
    `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_customer_tenant_platform_openid` (`tenant_id`, `platform_type`, `open_id`),
    KEY `idx_customer_tenant` (`tenant_id`),
    KEY `idx_customer_nickname` (`tenant_id`, `nickname`),
    CONSTRAINT `fk_customer_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='customers';

CREATE TABLE `label_group`
(
    `id`          BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`   BIGINT       NOT NULL,
    `name`        VARCHAR(64)  NOT NULL,
    `color`       VARCHAR(32)  NULL,
    `select_type` TINYINT      NOT NULL DEFAULT 0 COMMENT '0=multiple 1=single',
    `sort`        INT          NOT NULL DEFAULT 0,
    `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_group_tenant_name` (`tenant_id`, `name`),
    KEY `idx_group_tenant` (`tenant_id`),
    CONSTRAINT `fk_group_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='label groups';

CREATE TABLE `label`
(
    `id`         BIGINT      NOT NULL AUTO_INCREMENT,
    `tenant_id`  BIGINT      NOT NULL,
    `group_id`   BIGINT      NOT NULL,
    `name`       VARCHAR(64) NOT NULL,
    `color`      VARCHAR(32) NULL,
    `sort`       INT         NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_label_group_name` (`group_id`, `name`),
    KEY `idx_label_tenant` (`tenant_id`),
    CONSTRAINT `fk_label_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_label_group` FOREIGN KEY (`group_id`) REFERENCES `label_group` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='labels';

CREATE TABLE `customer_label`
(
    `id`          BIGINT     NOT NULL AUTO_INCREMENT,
    `tenant_id`   BIGINT     NOT NULL,
    `customer_id` BIGINT     NOT NULL,
    `label_id`    BIGINT     NOT NULL,
    `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_customer_label` (`customer_id`, `label_id`),
    KEY `idx_cl_tenant` (`tenant_id`),
    KEY `idx_cl_label` (`label_id`),
    CONSTRAINT `fk_cl_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_cl_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_cl_label` FOREIGN KEY (`label_id`) REFERENCES `label` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='customer-label links';

CREATE TABLE `customer_audience`
(
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`     BIGINT       NOT NULL,
    `name`          VARCHAR(64)  NOT NULL,
    `platform_type` TINYINT      NULL,
    `keyword`       VARCHAR(128) NULL,
    `tag_ids`       VARCHAR(512) NULL COMMENT 'comma-joined label ids defining the segment',
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_audience_tenant_name` (`tenant_id`, `name`),
    KEY `idx_audience_tenant` (`tenant_id`),
    CONSTRAINT `fk_audience_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='saved customer segments';

-- ============ Mock seed for the DEMO tenant ============
SET @tid = (SELECT id FROM tenant WHERE invite_code = 'DEMO0001' LIMIT 1);

INSERT INTO label_group (tenant_id, name, color, select_type, sort) VALUES
(@tid, '客户生命周期', '#2a5bd7', 1, 0),
(@tid, '兴趣偏好', '#f59e0b', 0, 1);

SET @g_life = (SELECT id FROM label_group WHERE tenant_id = @tid AND name = '客户生命周期' LIMIT 1);
SET @g_pref = (SELECT id FROM label_group WHERE tenant_id = @tid AND name = '兴趣偏好' LIMIT 1);

INSERT INTO label (tenant_id, group_id, name, color, sort) VALUES
(@tid, @g_life, '潜在客户', '#94a3b8', 0),
(@tid, @g_life, '成交客户', '#22c55e', 1),
(@tid, @g_life, '流失风险', '#ef4444', 2),
(@tid, @g_pref, '数码', '#8b5cf6', 0),
(@tid, @g_pref, '母婴', '#ec4899', 1),
(@tid, @g_pref, '健身', '#14b8a6', 2);

INSERT INTO customer (tenant_id, platform_type, open_id, nickname, phone, country, sex, remark, first_seen_at, last_contact_at) VALUES
(@tid, 1, '8613800001001@c.us', 'Alice 张',   '+8613800001001', 'CN', 2, '咨询过笔记本电脑', DATE_SUB(NOW(3), INTERVAL 12 DAY), NOW(3)),
(@tid, 1, '8613800001002@c.us', 'Bob 李',     '+8613800001002', 'US', 1, '复购三次',         DATE_SUB(NOW(3), INTERVAL 30 DAY), DATE_SUB(NOW(3), INTERVAL 2 DAY)),
(@tid, 4, 'tg_10002003',        'Carol 王',   NULL,             'SG', 2, 'Telegram 群转化',   DATE_SUB(NOW(3), INTERVAL 5 DAY),  NOW(3)),
(@tid, 4, 'tg_10002004',        'Dave 赵',    NULL,             'MY', 1, '待跟进',            DATE_SUB(NOW(3), INTERVAL 60 DAY), DATE_SUB(NOW(3), INTERVAL 40 DAY)),
(@tid, 1, '8613800001005@c.us', 'Eve 陈',     '+8613800001005', 'CN', 2, '健身爱好者',        DATE_SUB(NOW(3), INTERVAL 1 DAY),  NOW(3));

INSERT INTO customer_label (tenant_id, customer_id, label_id)
SELECT @tid, c.id, l.id
FROM customer c
JOIN label l ON l.tenant_id = @tid
WHERE c.tenant_id = @tid
  AND ((c.nickname = 'Alice 张' AND l.name IN ('潜在客户', '数码'))
    OR (c.nickname = 'Bob 李' AND l.name IN ('成交客户'))
    OR (c.nickname = 'Carol 王' AND l.name IN ('潜在客户', '母婴'))
    OR (c.nickname = 'Dave 赵' AND l.name IN ('流失风险'))
    OR (c.nickname = 'Eve 陈' AND l.name IN ('成交客户', '健身')));

INSERT INTO customer_audience (tenant_id, name, platform_type, keyword, tag_ids)
SELECT @tid, '高价值成交客户', NULL, NULL,
       GROUP_CONCAT(id)
FROM label WHERE tenant_id = @tid AND name = '成交客户';

INSERT INTO customer_audience (tenant_id, name, platform_type, keyword, tag_ids)
SELECT @tid, 'WhatsApp 数码人群', 1, '数码',
       GROUP_CONCAT(id)
FROM label WHERE tenant_id = @tid AND name = '数码';
