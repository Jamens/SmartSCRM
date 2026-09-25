package com.smartscrm.server.service.msg;

import com.smartscrm.server.common.BizException;
import java.util.regex.Pattern;

/**
 * 会话档 `translation_setting.scope_key` 的唯一成形处：`<accountId>:<chatKey>`（V9 的列注释就是这一句）。
 * <p>
 * 只有一个作者，且四处调用它：PUT 写入（{@code TranslationService.updateConversationSettings}）、
 * DELETE 删除（{@code clearConversationSettings}）、GET 解析（{@code resolveSetting}）、
 * translate 解析（同一个 {@code resolveSetting}）。渲染层永远不拼、也永远不解析这个串（spec §3.4）：
 * 两处各拼一次的风险不是编译错，是**写进去的键与读出来的键差一个字符**——保存提示成功、气泡仍按
 * 上一档走、日志一句不响。
 * <p>
 * 键只用于整串比对，没有任何一处反解析它，所以 chatKey 里出现 `:` 不破坏定位（真实的 WA / TG
 * 形态本来也不含冒号，见同目录 {@code ChatKeys}）。宽度的两道闸在 `V9__conversation_setting_scope_key.sql`
 * 的注释里：accountId 最长 19 位 + ':' + chatKey 最长 128 = 148 <= 160。
 */
public final class ConversationScopeKey {

    /**
     * 与 `chat_conversation.chat_key` 同宽。TS 侧的镜像常量在 `@shared/chatKeys.ts` 的
     * `CHAT_KEY_MAX`（盖章处与广播处要用它裁），两边数字改动必须一起改：
     * 弹层里存得下的会话，翻译请求才可能用上它（spec §5 / §7）。
     */
    public static final int CHAT_KEY_MAX = 128;

    /** 空白与控制符：`\s` 管空格与制表/换行，`\p{Cntrl}` 补 0x00-0x1F 与 0x7F。 */
    private static final Pattern FORBIDDEN = Pattern.compile("[\\p{Cntrl}\\s]");

    private ConversationScopeKey() {
    }

    /** 能不能成形。{@code null} = 可以；否则是给调用方直接回 40000 的那句话。 */
    public static String rejectReason(Long accountId, String chatKey) {
        if (accountId == null) {
            return "scope=conversation 时必须带 accountId";
        }
        if (chatKey == null || chatKey.isBlank()) {
            return "scope=conversation 时必须带 chatKey";
        }
        if (chatKey.length() > CHAT_KEY_MAX) {
            return "chatKey 最长 " + CHAT_KEY_MAX + " 字符";
        }
        if (FORBIDDEN.matcher(chatKey).find()) {
            return "chatKey 不能含空白或控制字符";
        }
        return null;
    }

    /** 写入口用的那条：不成形就是坏请求，40000。 */
    public static String compose(Long accountId, String chatKey) {
        String reason = rejectReason(accountId, chatKey);
        if (reason != null) {
            throw new BizException(40000, reason);
        }
        return accountId + ":" + chatKey;
    }

    /**
     * 读取口用的那条：不成形不抛，回 {@code null} 表示"这一档不查"。
     * 页内那条链上 chatKey 来自主进程盖章，脏值只该让语向回落到下一档，不该让整次翻译失败——
     * 气泡没译文是一回事，内嵌页输入框预览整个报错是另一回事。
     */
    public static String composeOrNull(Long accountId, String chatKey) {
        return rejectReason(accountId, chatKey) == null ? accountId + ":" + chatKey : null;
    }
}
