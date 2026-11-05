package com.smartscrm.server.web.vo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.smartscrm.server.entity.ChatConversation;
import org.junit.jupiter.api.Test;

/** 会话 VO 的字段透出契约：新增的建议来源列必须能从实体一路透到 VO。 */
class ConversationVOTest {

    @Test
    void of_exposesAiSuggestionSource() {
        ChatConversation c = new ChatConversation();
        c.setAiSuggestionSource("model");
        assertEquals("model", ConversationVO.of(c).aiSuggestionSource());
    }

    @Test
    void of_keepsSourceNullForOldRows() {
        ChatConversation c = new ChatConversation();
        assertNull(ConversationVO.of(c).aiSuggestionSource(), "旧数据无 source 时应透出 null");
    }
}
