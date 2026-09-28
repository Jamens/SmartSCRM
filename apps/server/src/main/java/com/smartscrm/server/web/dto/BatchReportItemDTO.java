package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 一条明细的执行回执（spec §4 的 reports 入参元）。
 * sentAtEpochSec 是页内上报的 unix 秒，可空：空且成功时服务端取当前墙钟，空且失败时留空。
 */
@Data
public class BatchReportItemDTO {

    @NotNull
    private Long detailId;

    @Size(max = 64)
    private String localId;

    @NotBlank
    private String sendStatus;

    @Size(max = 32)
    private String errorCode;

    @Size(max = 255)
    private String errorDetail;

    @Size(max = 160)
    private String msgKey;

    private Long sentAtEpochSec;
}
