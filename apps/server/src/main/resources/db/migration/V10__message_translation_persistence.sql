-- P7 翻译稳定性（message-level-translation-persistence spec §2）：给 chat_message 补
-- 三列，让"这条消息已成功译出的文本"能按消息存一份、下次从库里回显。
-- 只 ALTER、不新建表、不动 uk_msg：msg_key 仍是采集幂等键，msg_id 只是"给页内气泡能对上"的第二把钥匙。
-- msg_id 与 msg_key 同为平台 id，沿用 V8 的 utf8mb4_bin 二进制排序（大小写敏感）；显示/文本列保持 human 排序。
ALTER TABLE `chat_message`
    ADD COLUMN `msg_id`          VARCHAR(128) COLLATE utf8mb4_bin NULL COMMENT '裸平台消息 id（= 页内 data-id = wa-js id.id），与 msg_key 的序列化形状解耦' AFTER `msg_key`,
    ADD COLUMN `translated_body` TEXT NULL COMMENT '这条消息成功译出的文本；仅在线/模拟成功才写，降级回显不写' AFTER `body`,
    ADD COLUMN `translated_lang` VARCHAR(16) NULL COMMENT 'translated_body 当时的目标语种，换语向靠它判失效' AFTER `translated_body`,
    ADD KEY `idx_msg_msgid` (`tenant_id`, `account_id`, `chat_key`, `msg_id`);
