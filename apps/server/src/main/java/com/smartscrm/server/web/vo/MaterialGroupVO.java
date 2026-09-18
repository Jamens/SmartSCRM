package com.smartscrm.server.web.vo;

public record MaterialGroupVO(
    Long id,
    String name,
    Integer sort,
    long materialCount
) {
}
