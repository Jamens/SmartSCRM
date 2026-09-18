-- SmartSCRM baseline: tenant (inviteCode) + application user + device binding.
-- Tenant is the multi-tenant root key, replacing the legacy `invite_code` columns.

CREATE TABLE `tenant`
(
    `id`          BIGINT       NOT NULL AUTO_INCREMENT,
    `invite_code` VARCHAR(64)  NOT NULL COMMENT 'tenant key, legacy inviteCode',
    `name`        VARCHAR(128) NOT NULL,
    `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '1=active 0=suspended',
    `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tenant_invite_code` (`invite_code`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='tenant';

CREATE TABLE `app_user`
(
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`     BIGINT       NOT NULL,
    `username`      VARCHAR(64)  NOT NULL,
    `password_hash` VARCHAR(128) NOT NULL,
    `nickname`      VARCHAR(64)  NULL,
    `avatar`        VARCHAR(255) NULL,
    `role`          VARCHAR(32)  NOT NULL DEFAULT 'agent' COMMENT 'owner|admin|agent',
    `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '1=active 0=disabled',
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_tenant_username` (`tenant_id`, `username`),
    CONSTRAINT `fk_user_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='login user';

CREATE TABLE `device`
(
    `id`            BIGINT      NOT NULL AUTO_INCREMENT,
    `app_user_id`   BIGINT      NOT NULL,
    `device_id`     VARCHAR(128) NOT NULL COMMENT 'machine id reported by desktop client',
    `profile_id`    VARCHAR(128) NULL COMMENT 'md5 hardware fingerprint',
    `device_name`   VARCHAR(128) NULL,
    `os_version`    VARCHAR(64)  NULL,
    `last_login_at` DATETIME(3)  NULL,
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_device_user_device` (`app_user_id`, `device_id`),
    CONSTRAINT `fk_device_user` FOREIGN KEY (`app_user_id`) REFERENCES `app_user` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='device binding for login';

INSERT INTO `tenant` (`invite_code`, `name`)
VALUES ('DEMO0001', 'Demo Tenant');
