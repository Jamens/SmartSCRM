package com.smartscrm.server.service.msg;

import java.util.regex.Pattern;

/**
 * chat_key 语义的唯一解释处：WhatsApp 的 <digits>@c.us 单聊与 <digits>[-<digits>]@g.us 群，
 * Telegram 的纯数字（可带负号，超级群是 -100… 前缀）。
 * <p>
 * TG 的 chat_key 当前只认数字，与 chat_conversation.chat_key 的列注释
 * "TG: numeric chat id" 同口径。'tg_' 前缀只出现在 customer.open_id 的种子数据里
 * （platform_type=4 的 'tg_10002003' / 'tg_10002004'），与列注释不是同一形态：
 * 该形态未决，以 Task 0 的真实探测为准，探测结论落地时本类的 TG_CHAT 与种子口径必须同一次改动。
 */
public final class ChatKeys {

    private static final Pattern WA_PEER = Pattern.compile("^(\\d{5,20})@(c\\.us|lid|s\\.wallet)$");
    private static final Pattern WA_GROUP = Pattern.compile("^(\\d{5,25}|\\d{1,25}-\\d{1,25})@g\\.us$");
    private static final Pattern TG_CHAT = Pattern.compile("^-?\\d{4,20}$");
    private static final Pattern DIGITS = Pattern.compile("\\d");

    private ChatKeys() {
    }

    /** platform_type → 库里的 platform 列值；未支持的平台返回 null，调用方据此拒绝入库。 */
    public static String platformOfAccountType(Integer platformType) {
        if (platformType == null) {
            return null;
        }
        return switch (platformType) {
            case 1 -> "whatsapp";
            case 4 -> "telegram";
            default -> null;
        };
    }

    /**
     * chat_key 的形态必须属于账号所在平台。错了不拦的话，一个 viewId→accountId 的错映射
     * 会把 WhatsApp 会话写进 Telegram 账号名下，而 uk_msg 视其为不同行——脏数据无法自愈。
     * <p>
     * 本闸只管形态，不管归属：whatsapp 分支要求带 @c.us / @lid / @s.wallet / @g.us 后缀，
     * 所以丢了后缀的裸号码在 whatsapp 一侧是 false；telegram 分支则等价于"纯数字（可带负号）就放过"，
     * 因此挡不住丢了 @c.us 后缀的 WhatsApp 号码（长度也消不掉这个歧义：WA 号码 10–15 位，
     * TG 超级群 -100 加 10 位同样是 13 位）。该形状歧义由 Task 3 的账号-平台一致性判定兜住，
     * 不在这里靠正则收紧解决。
     */
    public static boolean matchesPlatform(String platform, String chatKey) {
        if (platform == null || chatKey == null || chatKey.isBlank()) {
            return false;
        }
        return switch (platform) {
            case "whatsapp" -> WA_PEER.matcher(chatKey).matches() || WA_GROUP.matcher(chatKey).matches();
            // tg_ 前缀形态未决，见类注释；这里的宽松度是当前的既定口径
            case "telegram" -> TG_CHAT.matcher(chatKey).matches();
            default -> false;
        };
    }

    /** 群判定只看形态：WA 用 @g.us 后缀，TG 用负号前缀（-100… 是超级群的既定前缀）。 */
    public static boolean isGroup(String chatKey) {
        if (chatKey == null || chatKey.isBlank()) {
            return false;
        }
        return chatKey.endsWith("@g.us") || chatKey.startsWith("-100") || chatKey.endsWith("@group");
    }

    /** 单聊对端的裸号码；非 WhatsApp 单聊与群聊都是 null。 */
    public static String peerPhoneOf(String chatKey) {
        if (chatKey == null) {
            return null;
        }
        var m = WA_PEER.matcher(chatKey);
        return m.matches() ? m.group(1) : null;
    }

    /** 两侧都归一到纯数字再比，因为种子里 phone 带 '+'、chat_key 前缀不带。 */
    public static String normalizePhone(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        StringBuilder sb = new StringBuilder(raw.length());
        for (int i = 0; i < raw.length(); i++) {
            char ch = raw.charAt(i);
            if (DIGITS.matcher(String.valueOf(ch)).matches()) {
                sb.append(ch);
            }
        }
        return sb.isEmpty() ? null : sb.toString();
    }
}
