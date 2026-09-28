package com.smartscrm.server.web.vo;

import java.util.List;

/** 样例渲染：只出前 PREVIEW_MAX_RECIPIENTS 个收件人，`truncated` 表示后面还有没列出来的。 */
public record BatchPreviewVO(List<Sample> rows, boolean truncated) {

    public record Sample(String chatKey, int contentIndex, String body) {
    }
}
