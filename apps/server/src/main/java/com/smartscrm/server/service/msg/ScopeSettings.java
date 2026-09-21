package com.smartscrm.server.service.msg;

import com.smartscrm.server.entity.TranslationSetting;

/**
 * 语向解析只有一条规则：客户有覆盖行就用它，否则用全局。
 * 不做"字段级合并"——那样一条消息会混用两个来源的语向，出问题无法解释。
 * 覆盖行是保存时从全局整份复制再改的（Task 6 Step 3），所以整行取用是安全的。
 */
public final class ScopeSettings {

    public record Resolved(TranslationSetting setting, boolean inherited) {
    }

    private ScopeSettings() {
    }

    public static Resolved resolve(Long customerId, TranslationSetting customer, TranslationSetting global) {
        if (customerId != null && customer != null) {
            return new Resolved(customer, false);
        }
        return new Resolved(global, true);
    }
}
