package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record TranslateDTO(
    @NotBlank(message = "text 不能为空") @Size(max = 5000, message = "text 最长 5000 字符") String text,
    @NotBlank(message = "type 不能为空") String type,
    Boolean input,
    Boolean noCache
) {
}
