package com.smartscrm.server.service.batch;

/**
 * 群发正文的两个变量。只认这两个 token，其余花括号一律原样保留：
 * 正文里的合法花括号（占位说明、JSON 片段）被吞掉的代价比多一个字符大得多。
 * <p>
 * 兜底链只有一层，值由调用方备好：无客户会话的 nickname 交给会话标题、openId 交给
 * chat_key 的本地段（计划 R9），这里不再区分"有没有客户"，只看"这一格有没有值"。
 */
public final class BatchRender {

    public static final String CUSTOMER_TOKEN = "{客户名}";
    public static final String PHONE_TOKEN = "{号码}";

    public static final Fields EMPTY_FIELDS = new Fields(null, null, null);

    private BatchRender() {
    }

    /** nickname 缺失时用来兜底的串（客户 open_id，或会话键的本地段）。 */
    public record Fields(String nickname, String openId, String phone) {
    }

    public static String render(String template, Fields fields) {
        if (template == null) {
            return "";
        }
        Fields f = fields == null ? EMPTY_FIELDS : fields;
        return template
                .replace(CUSTOMER_TOKEN, customerName(f))
                .replace(PHONE_TOKEN, f.phone() == null ? "" : f.phone());
    }

    private static String customerName(Fields f) {
        String nickname = blankToNull(f.nickname());
        if (nickname != null) {
            return nickname;
        }
        return openIdTail(blankToNull(f.openId()));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    /**
     * 先剥掉 `@` 之后的平台段再取尾 4 位：客户 open_id 与 chat_key 同形（`8613800001001@c.us`），
     * 不剥就会给每个无昵称的客户渲染出同一个 "c.us"。不足 4 位用整串——尾 4 位是为"认个人"，
     * 不是为"凑长度"。
     */
    private static String openIdTail(String openId) {
        if (openId == null) {
            return "";
        }
        int at = openId.indexOf('@');
        String local = at < 0 ? openId : openId.substring(0, at);
        return local.length() <= 4 ? local : local.substring(local.length() - 4);
    }
}
