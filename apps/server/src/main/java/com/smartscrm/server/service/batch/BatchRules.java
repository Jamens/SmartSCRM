package com.smartscrm.server.service.batch;

import java.util.ArrayList;
import java.util.List;

/**
 * 群发的入参规则。返回**全部**违规而不是第一条：1000 人 20 条内容的向导里，
 * 一次只回一条会让人改一条试一次，成本全在用户身上。
 * <p>
 * 正文上限 5000 与 trim 后非空这条口径与 desktop 的 isSendable 是同一条规则的两处写法（spec §3.3），
 * 改数必须同时改 `apps/desktop/src/main/services/msgBridge/msgApi.ts:114`。
 */
public final class BatchRules {

    public static final int MAX_RECIPIENTS = 1000;
    public static final int MAX_CONTENTS = 20;
    public static final int MAX_BODY = 5000;
    public static final int MAX_DETAILS = 20000;
    public static final int MAX_INTERVAL = 3600;
    public static final int REAL_MIN_MSG_INTERVAL = 3;
    public static final int REAL_MIN_CHAT_INTERVAL = 5;

    private static final String PLATFORM = "whatsapp";

    private BatchRules() {
    }

    public static List<String> violations(String platform, int recipientCount,
                                         List<String> contents, int expandedTotal) {
        List<String> out = new ArrayList<>();
        if (!PLATFORM.equals(platform)) {
            out.add("第一版只放开 whatsapp 平台");
        }
        if (recipientCount < 1) {
            out.add("收件人不能为空");
        } else if (recipientCount > MAX_RECIPIENTS) {
            out.add("收件人超过上限 " + MAX_RECIPIENTS + " 人");
        }
        int size = contents == null ? 0 : contents.size();
        if (size < 1) {
            out.add("内容不能为空");
        } else if (size > MAX_CONTENTS) {
            out.add("内容条数超过上限 " + MAX_CONTENTS + " 条");
        }
        if (expandedTotal > MAX_DETAILS) {
            out.add("展开后的明细总数超过上限 " + MAX_DETAILS + " 条");
        }
        if (contents != null) {
            for (int i = 0; i < contents.size(); i++) {
                String c = contents.get(i);
                if (c == null || c.isBlank()) {
                    out.add("第 " + (i + 1) + " 条正文是空的");
                } else if (c.length() > MAX_BODY) {
                    out.add("第 " + (i + 1) + " 条正文超过 " + MAX_BODY + " 字");
                }
            }
        }
        return out;
    }

    /**
     * 渲染后再量一遍（R35）：上限 5000 量的是**要发出去的那串字**，不是向导里的模板。
     * 模板 4900 字加上填进来的昵称就过 5000，而 {@code isSendable} 会在执行环里把这一行判成失败——
     * 那一格最晚要在创建时点名，否则用户看到的形状是「任务建好了，跑出一条 unknown」。
     * 只点名前三行的 seq、同时给出总数：2 万行全点名会把 message 撑成一坨。
     */
    public static List<String> renderedViolations(List<BatchExpansion.ExpandedRow> rows) {
        List<String> out = new ArrayList<>();
        if (rows == null) {
            return out;
        }
        List<String> blank = new ArrayList<>();
        List<String> tooLong = new ArrayList<>();
        for (BatchExpansion.ExpandedRow r : rows) {
            String body = r.body();
            if (body == null || body.isBlank()) {
                blank.add(String.valueOf(r.seq()));
            } else if (body.length() > MAX_BODY) {
                tooLong.add(String.valueOf(r.seq()));
            }
        }
        if (!blank.isEmpty()) {
            out.add("渲染后有 " + blank.size() + " 行正文是空的（seq " + firstThreeSeq(blank) + "）");
        }
        if (!tooLong.isEmpty()) {
            out.add("渲染后有 " + tooLong.size() + " 行正文超过 " + MAX_BODY + " 字（seq "
                    + firstThreeSeq(tooLong) + "）");
        }
        return out;
    }

    private static String firstThreeSeq(List<String> seqs) {
        return String.join("、", seqs.subList(0, Math.min(3, seqs.size())));
    }

    public static List<String> intervalViolations(int msgMin, int msgMax, int chatMin, int chatMax,
                                                 boolean dryRun) {
        List<String> out = new ArrayList<>();
        checkOne(out, "同人间隔", msgMin, msgMax, dryRun ? 0 : REAL_MIN_MSG_INTERVAL);
        checkOne(out, "换人间隔", chatMin, chatMax, dryRun ? 0 : REAL_MIN_CHAT_INTERVAL);
        return out;
    }

    private static void checkOne(List<String> out, String label, int min, int max, int realFloor) {
        if (min < 0) {
            out.add(label + " min 不能为负");
        }
        if (min > max) {
            out.add(label + " min 不能大于 max");
        }
        if (max > MAX_INTERVAL) {
            out.add(label + " max 不能超过 " + MAX_INTERVAL + " 秒");
        }
        if (min < realFloor) {
            out.add(label + " min 真发不能低于 " + realFloor + " 秒");
        }
    }
}
