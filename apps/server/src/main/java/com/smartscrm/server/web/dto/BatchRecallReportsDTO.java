package com.smartscrm.server.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.Data;

/** 撤回回执上报体：字段名与 Task 8 线上拼的形状一一对齐。 */
@Data
public class BatchRecallReportsDTO {

    @Valid
    @NotNull
    private List<BatchRecallReportItemDTO> items;
}
