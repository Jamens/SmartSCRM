package com.smartscrm.server.web.dto;

public record CustomerEditRequest(
    String nickname,
    Integer sex,
    String country,
    String email,
    String remark
) {
}
