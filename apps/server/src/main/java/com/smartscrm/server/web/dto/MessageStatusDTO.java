package com.smartscrm.server.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record MessageStatusDTO(@NotNull Long accountId, @NotBlank @Size(max = 128) String chatKey,
                               @NotEmpty @Size(max = 200) List<@Valid StatusUpdateDTO> updates) {
}
