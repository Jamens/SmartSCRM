-- V16: B28 P1 — conversation handling state machine + takeover queue.
-- A conversation is in exactly one of three states:
--   AI               (default) — handled by the (future) AI persona engine
--   WAITING_TAKEOVER — an inbound message tripped a transfer-to-human rule; it sits in the queue
--   HUMAN_ACTIVE     — a seat has taken it over (assignee_id = app_user.id)
-- ai_persona_id is a forward hook for the deferred AI persona engine sub-feature: it is
-- persisted but not consulted by any logic yet.
--
-- Idempotent: the whole block only runs when information_schema reports handling_status
-- is absent. Flyway runs DDL in implicit-commit mode, so a half-applied previous run
-- would leave the column present and a bare ALTER would fail with 1060 (duplicate column)
-- on retry. The guard turns that into a no-op.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversation' AND COLUMN_NAME = 'handling_status');
SET @s := IF(@c = 0,
             'ALTER TABLE `chat_conversation` '
             'ADD COLUMN `handling_status`  VARCHAR(20)  NOT NULL DEFAULT ''AI'' COMMENT ''AI | WAITING_TAKEOVER | HUMAN_ACTIVE'', '
             'ADD COLUMN `assignee_id`      BIGINT       NULL COMMENT ''takeover seat = app_user.id'', '
             'ADD COLUMN `ai_persona_id`    BIGINT       NULL COMMENT ''forward hook for AI persona engine (deferred)'', '
             'ADD COLUMN `wait_takeover_at` DATETIME(3)  NULL COMMENT ''entered WAITING_TAKEOVER at'', '
             'ADD COLUMN `transfer_reason`  VARCHAR(255) NULL COMMENT ''why it was transferred to a human'', '
             'ADD KEY `idx_conv_status` (`tenant_id`, `handling_status`)',
             'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
