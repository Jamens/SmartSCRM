package com.smartscrm.server.service.msg;

import com.smartscrm.server.entity.TranslationSetting;

/**
 * 语向解析只有一条规则：会话档 -> 客户档 -> 全局，取到第一个存在的行就停（spec §3.2）。
 * 不做"字段级合并"——那样一条消息会混用两三个来源的语向，出问题无法解释。
 * 高档行是保存时从"它要覆盖的那一档"整份复制再改的（spec §3.3），所以整行取用是安全的。
 * <p>
 * 判定只看哪一档有行，不看请求带了哪些字段：客户档答"我对这位客户一般怎么说"，
 * 会话档答"我在这个会话里怎么说"，语义更近的赢。反过来（按字段决定）会让同一会话在
 * 内嵌页与记录页两个入口读出不同的生效值。
 */
public final class ScopeSettings {

    public record Resolved(TranslationSetting setting, boolean inherited, String scope) {
    }

    private ScopeSettings() {
    }

    /**
     * 三档输入，任一为 null 就是"这一档没有行"。`global` 为 null 时仍回 `("global", true)`——
     * 调用方（`requireSettings`）理论上不会给出 null，这条只保证这里不抛 NPE。
     */
    public static Resolved resolve(TranslationSetting conversation, TranslationSetting customer,
                                   TranslationSetting global) {
        if (conversation != null) {
            return new Resolved(conversation, false, "conversation");
        }
        if (customer != null) {
            return new Resolved(customer, false, "customer");
        }
        return new Resolved(global, true, "global");
    }
}
