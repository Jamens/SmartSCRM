package com.smartscrm.server.web.vo;

import java.util.List;

public record LabelGroupVO(
    Long id,
    String name,
    String color,
    Integer selectType,
    Integer sort,
    List<LabelVO> labels
) {
}
