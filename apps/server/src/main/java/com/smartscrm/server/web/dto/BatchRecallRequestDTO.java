package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import lombok.Data;

/** 撤回请求：必须有明确目标，所以 @NotEmpty 保留（与整批重发的「什么都不传」相反）。 */
@Data
public class BatchRecallRequestDTO {

    @NotEmpty
    private List<Long> detailIds;
}
