-- P4: quick-reply + material library (checklist B3, 文字/图片/名片多组件).
-- Multi-tenant scoped by tenant_id (FK -> tenant.id, cascade). Model inferred from
-- the legacy client's quick-reply / material contracts, split into clean tables.

CREATE TABLE `material_group`
(
    `id`         BIGINT      NOT NULL AUTO_INCREMENT,
    `tenant_id`  BIGINT      NOT NULL,
    `name`       VARCHAR(64) NOT NULL,
    `sort`       INT         NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_mgroup_tenant_name` (`tenant_id`, `name`),
    KEY `idx_mgroup_tenant` (`tenant_id`),
    CONSTRAINT `fk_mgroup_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='material groups';

CREATE TABLE `material`
(
    `id`          BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`   BIGINT       NOT NULL,
    `group_id`    BIGINT       NULL COMMENT 'nullable -> uncategorized',
    `type`        TINYINT      NOT NULL COMMENT '1=image 2=video 3=audio 4=file',
    `name`        VARCHAR(128) NOT NULL,
    `url`         TEXT         NOT NULL COMMENT 'http(s) URL or data: URI (local/offline assets)',
    `mime_type`   VARCHAR(96)  NULL,
    `size_bytes`  BIGINT       NULL,
    `remark`      VARCHAR(255) NULL,
    `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_material_tenant_group` (`tenant_id`, `group_id`),
    KEY `idx_material_tenant_type` (`tenant_id`, `type`),
    CONSTRAINT `fk_material_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_material_group` FOREIGN KEY (`group_id`) REFERENCES `material_group` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='reusable media assets';

CREATE TABLE `quick_reply_group`
(
    `id`         BIGINT      NOT NULL AUTO_INCREMENT,
    `tenant_id`  BIGINT      NOT NULL,
    `name`       VARCHAR(64) NOT NULL,
    `sort`       INT         NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_qrgroup_tenant_name` (`tenant_id`, `name`),
    KEY `idx_qrgroup_tenant` (`tenant_id`),
    CONSTRAINT `fk_qrgroup_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='quick reply groups';

CREATE TABLE `quick_reply`
(
    `id`         BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`  BIGINT       NOT NULL,
    `group_id`   BIGINT       NOT NULL,
    `title`      VARCHAR(128) NOT NULL COMMENT 'short label shown in the picker',
    `shortcut`   VARCHAR(32)  NULL COMMENT 'slash trigger word, e.g. /hi',
    `sort`       INT          NOT NULL DEFAULT 0,
    `use_count`  INT          NOT NULL DEFAULT 0,
    `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_reply_tenant_group` (`tenant_id`, `group_id`),
    KEY `idx_reply_tenant_shortcut` (`tenant_id`, `shortcut`),
    CONSTRAINT `fk_reply_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_reply_qrgroup` FOREIGN KEY (`group_id`) REFERENCES `quick_reply_group` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='quick replies (one title = an ordered set of components)';

CREATE TABLE `quick_reply_item`
(
    `id`          BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`   BIGINT       NOT NULL,
    `reply_id`    BIGINT       NOT NULL,
    `type`        TINYINT      NOT NULL COMMENT '1=text 2=image 3=business-card',
    `content`     TEXT         NULL COMMENT 'text body (type=1)',
    `material_id` BIGINT       NULL COMMENT 'image material reference (type=2)',
    `media_url`   TEXT         NULL COMMENT 'denormalised image url snapshot (type=2)',
    `card_name`   VARCHAR(128) NULL COMMENT 'business card display name (type=3)',
    `card_phone`  VARCHAR(64)  NULL COMMENT 'business card phone (type=3)',
    `sort`        INT          NOT NULL DEFAULT 0,
    `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_item_reply` (`reply_id`),
    KEY `idx_item_tenant` (`tenant_id`),
    CONSTRAINT `fk_item_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_item_reply` FOREIGN KEY (`reply_id`) REFERENCES `quick_reply` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='quick reply components';

-- ============ Mock seed for the DEMO tenant ============
SET @tid = (SELECT id FROM tenant WHERE invite_code = 'DEMO0001' LIMIT 1);

-- Material groups
INSERT INTO material_group (tenant_id, name, sort) VALUES
(@tid, '产品图', 0),
(@tid, '活动海报', 1),
(@tid, '话术配图', 2);
SET @mg_prod = (SELECT id FROM material_group WHERE tenant_id = @tid AND name = '产品图' LIMIT 1);
SET @mg_poster = (SELECT id FROM material_group WHERE tenant_id = @tid AND name = '活动海报' LIMIT 1);
SET @mg_copy = (SELECT id FROM material_group WHERE tenant_id = @tid AND name = '话术配图' LIMIT 1);

-- Offline SVG data-URI image materials (render without any network)
INSERT INTO material (tenant_id, group_id, type, name, url, mime_type, size_bytes, remark) VALUES
(@tid, @mg_prod, 1, '耳机产品图',
 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22300%22%20height=%22300%22%3E%3Crect%20width=%22300%22%20height=%22300%22%20fill=%22%232a5bd7%22/%3E%3Ctext%20x=%22150%22%20y=%22160%22%20font-size=%2228%22%20fill=%22%23fff%22%20text-anchor=%22middle%22%3E%E8%80%B3%E6%9C%BA%3C/text%3E%3C/svg%3E',
 'image/svg+xml', 512, '示例产品图'),
(@tid, @mg_prod, 1, '手表产品图',
 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22300%22%20height=%22300%22%3E%3Crect%20width=%22300%22%20height=%22300%22%20fill=%22%237c3aed%22/%3E%3Ctext%20x=%22150%22%20y=%22160%22%20font-size=%2228%22%20fill=%22%23fff%22%20text-anchor=%22middle%22%3E%E6%89%8B%E8%A1%A8%3C/text%3E%3C/svg%3E',
 'image/svg+xml', 512, '示例产品图'),
(@tid, @mg_poster, 1, '双十一海报',
 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22300%22%20height=%22400%22%3E%3Crect%20width=%22300%22%20height=%22400%22%20fill=%22%23ef4444%22/%3E%3Ctext%20x=%22150%22%20y=%22210%22%20font-size=%2226%22%20fill=%22%23fff%22%20text-anchor=%22middle%22%3E%E5%A4%A7%E4%BF%83%E6%B5%B7%E6%8A%A5%3C/text%3E%3C/svg%3E',
 'image/svg+xml', 640, '促销活动海报'),
(@tid, @mg_copy, 1, '感谢卡片',
 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22300%22%20height=%22200%22%3E%3Crect%20width=%22300%22%20height=%22200%22%20fill=%22%23f59e0b%22/%3E%3Ctext%20x=%22150%22%20y=%22110%22%20font-size=%2224%22%20fill=%22%23fff%22%20text-anchor=%22middle%22%3E%E6%84%9F%E8%B0%A2%E6%82%A8%3C/text%3E%3C/svg%3E',
 'image/svg+xml', 480, '成单感谢配图');

-- Quick reply groups
INSERT INTO quick_reply_group (tenant_id, name, sort) VALUES
(@tid, '开场问候', 0),
(@tid, '售后常见', 1),
(@tid, '促单话术', 2);
SET @qr_hi = (SELECT id FROM quick_reply_group WHERE tenant_id = @tid AND name = '开场问候' LIMIT 1);
SET @qr_after = (SELECT id FROM quick_reply_group WHERE tenant_id = @tid AND name = '售后常见' LIMIT 1);
SET @qr_sale = (SELECT id FROM quick_reply_group WHERE tenant_id = @tid AND name = '促单话术' LIMIT 1);

-- Quick replies + their components
INSERT INTO quick_reply (tenant_id, group_id, title, shortcut, sort, use_count) VALUES
(@tid, @qr_hi, '标准问候', '/hi', 0, 12),
(@tid, @qr_after, '物流查询', '/logistics', 0, 8),
(@tid, @qr_sale, '限时优惠', '/promo', 0, 21);
SET @r_hi = (SELECT id FROM quick_reply WHERE tenant_id = @tid AND shortcut = '/hi' LIMIT 1);
SET @r_log = (SELECT id FROM quick_reply WHERE tenant_id = @tid AND shortcut = '/logistics' LIMIT 1);
SET @r_promo = (SELECT id FROM quick_reply WHERE tenant_id = @tid AND shortcut = '/promo' LIMIT 1);
SET @m_thanks = (SELECT id FROM material WHERE tenant_id = @tid AND name = '感谢卡片' LIMIT 1);

INSERT INTO quick_reply_item (tenant_id, reply_id, type, content, media_url, sort) VALUES
(@tid, @r_hi, 1, '您好，很高兴为您服务！请问有什么可以帮您？', NULL, 0);

INSERT INTO quick_reply_item (tenant_id, reply_id, type, content, sort) VALUES
(@tid, @r_log, 1, '您的包裹已发出，物流单号如下：', 0);
INSERT INTO quick_reply_item (tenant_id, reply_id, type, card_name, card_phone, sort) VALUES
(@tid, @r_log, 3, '顺丰速运客服', '95338', 1);

INSERT INTO quick_reply_item (tenant_id, reply_id, type, content, sort) VALUES
(@tid, @r_promo, 1, '本店双 11 全场 5 折，仅限今日！', 0);
INSERT INTO quick_reply_item (tenant_id, reply_id, type, material_id, media_url, sort) VALUES
(@tid, @r_promo, 2, @m_thanks,
 (SELECT url FROM material WHERE id = @m_thanks), 1);
