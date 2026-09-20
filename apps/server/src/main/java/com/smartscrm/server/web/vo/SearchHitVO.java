package com.smartscrm.server.web.vo;

/** 搜索结果必须带会话锚点：点一条要能跳到它所属的会话并高亮（spec §8）。 */
public record SearchHitVO(MessageVO message, Long conversationId, String chatTitle) {}
