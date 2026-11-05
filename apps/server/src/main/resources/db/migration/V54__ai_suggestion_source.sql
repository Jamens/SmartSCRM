-- V54: B28 AI 人设引擎——建议来源标记（S1）。
-- 同一条 ai_suggestion 现在可能来自两条完全不同的通路：知识库检索命中的「标准答案」，
-- 或人设模型生成的草稿。qa_id 为 null 既可能是「模型生成」也可能是「检索没命中」或「老数据」，
-- 语义不唯一，坐席需要一眼看出手上这条是不是库里那套标准答案，故单列 source。
--
-- 取值：retrieval=知识库标准答案 | model=人设模型生成；NULL=无建议或旧数据（V54 之前）。
--
-- Idempotent: 照 V52 惯例走 information_schema.COLUMNS 守卫 + PREPARE/EXECUTE，
-- 列已存在时 DO 0，脚本连续重跑不报错。

SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversation'
              AND COLUMN_NAME = 'ai_suggestion_source');
SET @s1 := IF(@c1 = 0,
             'ALTER TABLE `chat_conversation` ADD COLUMN `ai_suggestion_source` VARCHAR(16) NULL COMMENT ''retrieval=知识库标准答案 | model=人设模型生成；NULL=无建议或旧数据'' AFTER `ai_suggestion_qa_id`',
             'DO 0');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;
