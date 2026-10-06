-- V33: B8 剧本委托 B18/B19 —— 任务步骤加「委托留痕」两列。
-- 剧本里的 join_group/kick_member 是**委托类**动作：不自己执行，转成 B18/B19 任务交出去
-- （那两个动作不可逆、都带人工门，见 B18/B19 spec §5）。口径是「委托即完成」：
-- 建完委托任务 step 即 success，靠这两列回查委托到哪儿了。
--
-- Idempotent: information_schema 守卫，已存在则 no-op。

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'script_task_step' AND COLUMN_NAME = 'ref_type');
SET @s := IF(@c = 0,
             'ALTER TABLE `script_task_step` ADD COLUMN `ref_type` VARCHAR(20) NULL COMMENT ''join|kick：委托到 B18/B19''',
             'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'script_task_step' AND COLUMN_NAME = 'ref_id');
SET @s2 := IF(@c2 = 0,
              'ALTER TABLE `script_task_step` ADD COLUMN `ref_id` BIGINT NULL COMMENT ''委托出去的 B18/B19 任务 id''',
              'DO 0');
PREPARE st2 FROM @s2; EXECUTE st2; DEALLOCATE PREPARE st2;
