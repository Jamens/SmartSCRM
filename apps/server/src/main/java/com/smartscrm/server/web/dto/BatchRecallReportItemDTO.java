package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 一条撤回回执。字段名就是 Task 8 线上拼的 {detailId, recalled, detail}，一个都不能改叫别的：
 * 改叫 ok 的话每条报都读成 recalled=undefined → false，撤成功的行会被记成 recall_failed 写进库。
 */
@Data
public class BatchRecallReportItemDTO {

    @NotNull
    private Long detailId;

    /** 包装 Boolean：缺字段读到 null，服务端一律走 Boolean.TRUE.equals(...)，绝不直接进条件（否则 NPE 出 50000）。 */
    @NotNull
    private Boolean recalled;

    @Size(max = 255)
    private String detail;
}
