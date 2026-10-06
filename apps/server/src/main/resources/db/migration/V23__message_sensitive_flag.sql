-- V23: A8 入站敏感词判定——给 chat_message 打一个「含敏感词」标记。
-- 判定发生在 MessageService.accept 入库时（只对 direction='in' 且有 body 的行），命中则置 1。
-- 存标记而不是读取时再判：消息列表/搜索/统计都要读这张表，逐条回查词库会把读放大成 N+1。
--
-- Idempotent: 列只在 information_schema 报缺失时加。Flyway 的 DDL 隐式提交，重复执行
-- 裸 ALTER 会撞 1060（duplicate column），所以用 information_schema 守卫。

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_message' AND COLUMN_NAME = 'has_sensitive');
SET @s := IF(@c = 0,
             'ALTER TABLE `chat_message` ADD COLUMN `has_sensitive` TINYINT NOT NULL DEFAULT 0 COMMENT ''1=入站正文命中敏感词'' AFTER `status`',
             'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
