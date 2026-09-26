package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.smartscrm.server.entity.TranslationSetting;
import org.junit.jupiter.api.Test;

/**
 * 优先级只有这一处定义（spec §3.2），所以这三档的组合是全项目"生效档正确"唯一的离线证据。
 * 跑得起来的部分到此为止：行能不能命中、键对不对，见
 * `docs/notes/2026-09-25-conversation-settings-verification.md` 的"后端"一节按类别列出的实跑行
 * （逐条文案以驱动输出为准；驱动与它的日志都在 gitignore 的 `tmp/` 下，不作为提交物里的指针）。
 */
class ScopeSettingsTest {

    private static TranslationSetting setting(String id, String scope, String to) {
        TranslationSetting s = new TranslationSetting();
        s.setId(Long.valueOf(id));
        s.setScope(scope);
        s.setSendToLang(to);
        return s;
    }

    /** 会话档赢，且连"客户档也在、请求还显式带了 customerId"也算它赢（D-01）。 */
    @Test
    void conversationRowBeatsEverythingBelowIt() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(
            setting("3", "conversation", "hi"), setting("2", "customer", "vi"), setting("1", "global", "en"));
        assertEquals(3L, r.setting().getId());
        assertEquals("hi", r.setting().getSendToLang());
        assertEquals("conversation", r.scope());
        assertFalse(r.inherited());
    }

    @Test
    void customerRowWinsWhenThereIsNoConversationRow() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(
            null, setting("2", "customer", "vi"), setting("1", "global", "en"));
        assertEquals(2L, r.setting().getId());
        assertEquals("customer", r.scope());
        assertFalse(r.inherited(), "UI 要据此显示「该客户专属」");
    }

    @Test
    void globalIsTheInheritedTier() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(null, null, setting("1", "global", "en"));
        assertEquals(1L, r.setting().getId());
        assertEquals("global", r.scope());
        assertTrue(r.inherited(), "UI 要据此显示「沿用全局」");
    }

    /** 全局行是 requireSettings 兜底建的，理论上不会是 null；这里只保证不抛 NPE。 */
    @Test
    void missingAllRowsYieldsNoSettingButStillAGlobalTier() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(null, null, null);
        assertNull(r.setting());
        assertEquals("global", r.scope());
        assertTrue(r.inherited());
    }
}
