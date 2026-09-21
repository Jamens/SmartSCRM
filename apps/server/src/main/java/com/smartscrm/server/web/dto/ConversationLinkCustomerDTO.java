package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotNull;

public record ConversationLinkCustomerDTO(@NotNull(message = "customerId 不能为空") Long customerId) {
}
