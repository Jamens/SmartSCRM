package com.smartscrm.server.web.dto;

import java.util.List;
import lombok.Data;

/**
 * 复位入参：整批与单条共用一条端点（R11）。
 * 这里刻意不加 @NotEmpty——「什么都不传」正是 spec §5 retry-failed 的原语义（整批复位），
 * 加上它无 body 的那一跳会被 400 挡掉。
 */
@Data
public class BatchRetryDTO {

    /** null / 空 = 整批复位；非空 = 只复位这些 detailId（R11）。 */
    private List<Long> detailIds;
}
