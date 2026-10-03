package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ChangePasswordRequest(
    @NotBlank String oldPassword,
    @NotBlank @Size(min = 8, max = 64) String newPassword
) {
}
