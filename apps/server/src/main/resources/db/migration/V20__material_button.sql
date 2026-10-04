-- V20: B17 P3 — button materials (interactive buttons).
--
-- A material of type 5 carries an interactive-button payload instead of a media URL:
-- WA (via wa-js `WPP.chat.sendTextMessage(..., { buttons })`) renders it as a
-- nativeFlowMessage with quick-reply / CTA buttons.
--
-- Two changes:
--   1. `url` becomes NULLable. A button material has no URL at all; keeping NOT NULL
--      would force storing an empty string, and an empty string is indistinguishable
--      from "the caller forgot to fill it in" — the exact ambiguity the constraint was
--      there to prevent. The invariant moves up to the service: url is required for
--      types 1-4 (media), absent for type 5 (button).
--   2. `button_payload TEXT NULL` holds JSON: { body, title, footer, buttons: [...] }.
--      It is TEXT rather than the MySQL JSON type so the column behaves like every
--      other payload column in this schema (batch_send_task.contents) and needs no
--      server-side JSON function support to read back.
--
-- Idempotent: MODIFY COLUMN is naturally re-runnable; only the ADD COLUMN needs the
-- information_schema guard (Flyway + MySQL DDL implicit commit means a bare ADD would
-- fail with 1060 on retry).

ALTER TABLE `material`
    MODIFY COLUMN `url` TEXT NULL COMMENT 'http(s) URL or data: URI (local/offline assets); NULL for button materials',
    MODIFY COLUMN `type` TINYINT NOT NULL COMMENT '1=image 2=video 3=audio 4=file 5=button';

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'material' AND COLUMN_NAME = 'button_payload');
SET @s := IF(@c = 0,
             'ALTER TABLE `material` '
             'ADD COLUMN `button_payload` TEXT NULL COMMENT ''B17: JSON {body,title,footer,buttons:[{type,text,...}]} for type=5''',
             'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
