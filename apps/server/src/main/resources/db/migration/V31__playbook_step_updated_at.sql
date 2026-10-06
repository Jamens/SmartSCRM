-- V31: B8 剧本步骤补 updated_at。V29 建 script_playbook_step 时只给了 created_at，
-- 但 ScriptPlaybookStep 实体带 updatedAt、且 updateStep 会改 actionType/params —— 读列表时
-- MP 查 updated_at 报 Unknown column。补列（幂等：information_schema 守卫，已存在则 no-op）。

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'script_playbook_step' AND COLUMN_NAME = 'updated_at');
SET @s := IF(@c = 0,
             'ALTER TABLE `script_playbook_step` ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
             'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
