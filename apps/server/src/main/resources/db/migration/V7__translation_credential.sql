-- P5d: online translation providers (first wave: baidu + tencent).
-- Keys live server-side only: the API layer may store them but never reads the
-- secret back in full (masked VO), and they are never pushed to renderer or inject.
-- No seed rows: with no credential stored the whole translation path keeps behaving
-- exactly like the simulated engine phase.

CREATE TABLE `translation_credential`
(
    `id`         BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`  BIGINT       NOT NULL,
    `provider`   VARCHAR(16)  NOT NULL COMMENT 'baidu | tencent',
    `app_id`     VARCHAR(64)  NOT NULL COMMENT 'baidu appid | tencent SecretId',
    `secret_key` VARCHAR(255) NOT NULL COMMENT 'baidu key | tencent SecretKey; write-only over HTTP',
    `region`     VARCHAR(32)  NULL COMMENT 'tencent region, optional; ignored by baidu',
    `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tcred_tenant_provider` (`tenant_id`, `provider`),
    CONSTRAINT `fk_tcred_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='online translation provider credentials';
