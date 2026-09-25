-- P7 B16: conversation-scoped translation settings (checklist B16).
-- `scope_key` carries exactly one key form per scope: global = NULL,
-- customer = <customerId>, conversation = <accountId>:<chatKey>.
--
-- Two columns (account_id / chat_key) were deliberately NOT added. MySQL unique keys do not
-- constrain NULL, so a (tenant_id, account_id, chat_key) key would simply not exist for
-- global/customer rows; keeping them distinct would need a generated column. A single key
-- column keeps `settingRow(tenant, scope, key)` the one lookup path for all three tiers.
-- The price is that the key form is per-scope magic — so it is written into this comment.
--
-- COLLATE utf8mb4_bin is the point of this migration. The table is utf8mb4_unicode_ci, and
-- platform ids are case-sensitive: two conversations whose serialised ids differ only in
-- letter case would collide into one row, the later write silently overwriting the earlier
-- one with no trace. Purely numeric customer ids have no observable change.
--
-- Width: accountId <= 19 digits + ':' + chatKey <= 128 = 148 <= 160.
-- Index key length: 8 + 16*4 + 160*4 = 712 bytes, inside InnoDB DYNAMIC's 3072 limit.

ALTER TABLE `translation_setting`
    MODIFY COLUMN `scope`     VARCHAR(16) NOT NULL DEFAULT 'global'
        COMMENT 'global | customer | conversation',
    MODIFY COLUMN `scope_key` VARCHAR(160) COLLATE utf8mb4_bin NULL
        COMMENT 'key form per scope: global=NULL | customer=<customerId> | conversation=<accountId>:<chatKey>';
