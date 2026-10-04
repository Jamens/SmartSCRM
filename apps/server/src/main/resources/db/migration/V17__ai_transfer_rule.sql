-- V17: B28 P2 — AI transfer-to-human rule engine.
-- A tenant configures rules: "if an inbound message contains <keywords> (any|all),
-- push that conversation into the takeover queue (WAITING_TAKEOVER)".
-- AiTransferRuleService.firstMatch evaluates these on inbound messages inside
-- MessageService.accept; TakeoverService.transferIfAi applies the state change.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS is a no-op on re-run, and Flyway runs DDL in
-- implicit-commit mode so a half-applied previous run would otherwise leave the table
-- present and a bare CREATE would fail with 1050 (table exists) on retry.

CREATE TABLE IF NOT EXISTS `ai_transfer_rule` (
  `id`              BIGINT        NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT        NOT NULL,
  `rule_name`       VARCHAR(100)  NOT NULL,
  `match_mode`      VARCHAR(10)   NOT NULL COMMENT 'any | all',
  `keywords`        VARCHAR(1000) NOT NULL COMMENT 'comma / Chinese comma / semicolon separated, trimmed',
  `transfer_reason` VARCHAR(255)  NULL     COMMENT 'reason stamped on the conversation when this rule trips',
  `enabled`         TINYINT       NOT NULL DEFAULT 1 COMMENT '0 disabled, 1 enabled',
  `priority`        INT           NOT NULL DEFAULT 0 COMMENT 'higher number = evaluated first',
  `created_at`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_rule_tenant` (`tenant_id`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B28 转人工规则';
