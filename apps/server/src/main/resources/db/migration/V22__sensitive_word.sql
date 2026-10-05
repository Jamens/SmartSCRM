-- V22: A8 敏感词风控（本地库）。
-- 一个租户一份自己的敏感词表；word 在租户内唯一（uk_tenant_word），避免重复录入。
-- enabled=0 的词不参与命中（match 只扫启用中的）。category 只是个可选分组标签，便于
-- 运营按类目维护（如「金融」「医疗」），命中逻辑不依赖它。
--
-- Idempotent: CREATE TABLE IF NOT EXISTS is a no-op on re-run, and Flyway runs DDL in
-- implicit-commit mode so a half-applied previous run would otherwise leave the table
-- present and a bare CREATE would fail with 1050 (table exists) on retry.

CREATE TABLE IF NOT EXISTS `sensitive_word` (
  `id`         BIGINT        NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT        NOT NULL,
  `word`       VARCHAR(200)  NOT NULL,
  `category`   VARCHAR(50)   NULL     COMMENT '可选分组标签，不参与命中',
  `enabled`    TINYINT       NOT NULL DEFAULT 1 COMMENT '0 不参与命中, 1 参与',
  `created_at` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_word` (`tenant_id`, `word`),
  KEY `idx_word_tenant_enabled` (`tenant_id`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='A8 敏感词库';
