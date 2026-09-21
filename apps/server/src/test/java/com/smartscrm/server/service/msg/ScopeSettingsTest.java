package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.smartscrm.server.entity.TranslationSetting;
import org.junit.jupiter.api.Test;

class ScopeSettingsTest {

    private static TranslationSetting setting(String id, String from, String to) {
        TranslationSetting s = new TranslationSetting();
        s.setId(Long.valueOf(id));
        s.setReceiveFromLang(from);
        s.setReceiveToLang(to);
        return s;
    }

    @Test
    void usesTheCustomerRowWhenThereIsOne() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(7L, setting("2", "en", "zh-CN"), setting("1", "auto", "vi"));
        assertEquals(2L, r.setting().getId());
        assertFalse(r.inherited());
    }

    @Test
    void fallsBackToGlobalWhenTheCustomerHasNoOverride() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(7L, null, setting("1", "en", "zh-CN"));
        assertEquals(1L, r.setting().getId());
        assertTrue(r.inherited(), "UI 要据此显示「跟随全局」");
    }

    @Test
    void nullCustomerIdAlwaysMeansGlobalEvenWithAnOverrideRow() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(null, setting("2", "en", "zh-CN"), setting("1", "auto", "vi"));
        assertEquals(1L, r.setting().getId());
        assertTrue(r.inherited());
    }

    /** 全局行是 requireSettings 兜底建的，理论上不会是 null；这里只保证不抛 NPE。 */
    @Test
    void missingBothRowsYieldsNoSetting() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(7L, null, null);
        assertEquals(null, r.setting());
    }
}
