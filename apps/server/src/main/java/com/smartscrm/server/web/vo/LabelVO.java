package com.smartscrm.server.web.vo;

public record LabelVO(
    Long id,
    Long groupId,
    String name,
    String color,
    Integer sort,
    long useCustomerCount
) {
}
