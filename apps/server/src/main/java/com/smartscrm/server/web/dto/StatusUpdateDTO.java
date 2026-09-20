package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record StatusUpdateDTO(@NotBlank @Size(max = 128) String msgKey, @NotBlank String status) {
}
