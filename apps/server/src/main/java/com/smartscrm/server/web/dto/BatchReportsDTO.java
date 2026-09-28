package com.smartscrm.server.web.dto;

import jakarta.validation.Valid;
import java.util.List;
import lombok.Data;

/**
 * 执行环一页的上报体。
 * items 不加 @NotEmpty：收尾那一跳（全批已结、只带结论）就是空 items + allHalted，
 * 逼它非空会把「把 running 打成 done/error」这一句永远送不进来。
 */
@Data
public class BatchReportsDTO {

    @Valid
    private List<BatchReportItemDTO> items;

    /** 全部账号都熔断时为 true：openCount 还没归零而已经无人能发，任务进 error 而不是 done。 */
    private boolean allHalted;
}
