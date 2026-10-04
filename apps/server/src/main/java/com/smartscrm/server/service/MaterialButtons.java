package com.smartscrm.server.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartscrm.server.common.BizException;

/**
 * B17 P3 — validation for interactive-button material payloads.
 *
 * <p>The rules are not invented here; they are the constraints wa-js 4.6.0 enforces at
 * send time (see {@code prepareMessageButtons} in {@code @wppconnect/wa-js}):
 * <ul>
 *   <li>1–3 buttons (fewer than one or more than three throws)</li>
 *   <li>every button needs visible text, capped at 20 chars</li>
 *   <li>four kinds: {@code reply} (id), {@code url}, {@code call} (phone), {@code copy} (code)</li>
 *   <li><b>reply buttons cannot be mixed with url/call buttons</b> — wa-js throws
 *       {@code reply_and_cta_btn_not_allowed} at send time, which would surface as a
 *       failed send rather than a rejected save</li>
 * </ul>
 * Enforcing them at save time is the point: a material that can never be sent should be
 * refused when it is filed, not when a campaign is already running.
 *
 * <p>Pure and dependency-free apart from Jackson, so it is unit-testable without a
 * Spring context.
 */
public final class MaterialButtons {

    /** material.type for a button material. */
    public static final int TYPE_BUTTON = 5;

    /** WA caps the visible label length. */
    private static final int MAX_TEXT = 20;
    private static final int MIN_BUTTONS = 1;
    private static final int MAX_BUTTONS = 3;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private MaterialButtons() {
    }

    /**
     * @throws BizException 40000 with a message describing the rule, never echoing the
     *                      payload (it is user-authored content).
     */
    public static void requireValid(String json) {
        if (json == null || json.isBlank()) {
            throw new BizException(40000, "按钮素材缺少 buttonPayload");
        }
        JsonNode root;
        try {
            root = MAPPER.readTree(json);
        } catch (Exception e) {
            throw new BizException(40000, "按钮内容不是合法 JSON");
        }
        if (root == null || !root.isObject()) {
            throw new BizException(40000, "按钮内容必须是 JSON 对象");
        }
        JsonNode buttons = root.get("buttons");
        if (buttons == null || !buttons.isArray()) {
            throw new BizException(40000, "buttons 必须是数组");
        }
        if (buttons.size() < MIN_BUTTONS || buttons.size() > MAX_BUTTONS) {
            throw new BizException(40000, "按钮数量必须是 1 到 3 个");
        }

        boolean hasReply = false;
        boolean hasCta = false;
        for (JsonNode b : buttons) {
            if (!b.isObject()) {
                throw new BizException(40000, "按钮必须是对象");
            }
            String text = textOf(b, "text");
            if (text == null || text.isBlank()) {
                throw new BizException(40000, "按钮缺少文案");
            }
            if (text.length() > MAX_TEXT) {
                throw new BizException(40000, "按钮文案不能超过 " + MAX_TEXT + " 个字符");
            }
            String type = textOf(b, "type");
            switch (type == null ? "" : type) {
                case "reply" -> {
                    hasReply = true;
                    requireField(b, "id", "快捷回复按钮缺少 id");
                }
                case "url" -> {
                    hasCta = true;
                    requireField(b, "url", "链接按钮缺少 url");
                }
                case "call" -> {
                    hasCta = true;
                    requireField(b, "phone", "拨号按钮缺少 phone");
                }
                case "copy" -> requireField(b, "code", "复制按钮缺少 code");
                default -> throw new BizException(40000, "按钮类型只能是 reply / url / call / copy");
            }
        }
        // wa-js throws reply_and_cta_btn_not_allowed when a quick-reply button is combined
        // with a url/phone action button. `copy` is not part of that check upstream, so it
        // is not part of it here either — deliberately matching the library, not tightening it.
        if (hasReply && hasCta) {
            throw new BizException(40000, "快捷回复按钮与动作按钮（链接/拨号）不能混用");
        }
    }

    /** Counts the buttons in an already-validated payload; 0 when absent or unreadable. */
    public static int countOf(String json) {
        if (json == null || json.isBlank()) {
            return 0;
        }
        try {
            JsonNode root = MAPPER.readTree(json);
            JsonNode buttons = root == null ? null : root.get("buttons");
            return buttons == null || !buttons.isArray() ? 0 : buttons.size();
        } catch (Exception e) {
            return 0;
        }
    }

    private static void requireField(JsonNode button, String field, String message) {
        String v = textOf(button, field);
        if (v == null || v.isBlank()) {
            throw new BizException(40000, message);
        }
    }

    private static String textOf(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }
}
