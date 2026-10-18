-- V52: B28 第四段——AI 应答建议落到会话头。
-- 检索（V51）已经能召回 QA，但召回结果没人消费：TakeoverService 的 ai_persona_id
-- 是 forward hook，状态机缺「AI → 自动应答」这一条边。本迁移给会话头加三列，
-- 让 AI 产出的建议有地方存，坐席在接管台能看到并确认。
--
-- 口径：这是**建议**，不是已发出的消息。后端没有出站发送通道（发送在 Electron
-- 客户端侧），所以这里写的任何内容都不会自己发出去，必须坐席确认。
-- 符合「不往真人会话发」的红线。
--
-- Idempotent: 走仓库惯例的 information_schema 守卫 + PREPARE/EXECUTE，
-- 列已存在时 DO 0，重跑安全。

-- ---- 1a. chat_conversation.ai_suggestion ----
SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversation' AND COLUMN_NAME = 'ai_suggestion');
SET @s1 := IF(@c1 = 0,
             'ALTER TABLE `chat_conversation` ADD COLUMN `ai_suggestion` TEXT NULL COMMENT ''AI 检索出的建议答案；坐席确认后才会发出'' AFTER `ai_persona_id`',
             'DO 0');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- 1b. chat_conversation.ai_suggestion_score ----
SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversation' AND COLUMN_NAME = 'ai_suggestion_score');
SET @s2 := IF(@c2 = 0,
             'ALTER TABLE `chat_conversation` ADD COLUMN `ai_suggestion_score` FLOAT NULL COMMENT ''建议置信度（余弦相似度 0~1）'' AFTER `ai_suggestion`',
             'DO 0');
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;

-- ---- 1c. chat_conversation.ai_suggestion_qa_id ----
SET @c3 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversation' AND COLUMN_NAME = 'ai_suggestion_qa_id');
SET @s3 := IF(@c3 = 0,
             'ALTER TABLE `chat_conversation` ADD COLUMN `ai_suggestion_qa_id` BIGINT NULL COMMENT ''建议对应的 knowledge_qa.id，便于回溯出处'' AFTER `ai_suggestion_score`',
             'DO 0');
PREPARE st FROM @s3; EXECUTE st; DEALLOCATE PREPARE st;
