package com.smartscrm.server.web.dto;

import java.util.List;

/** Replace the full label set of a customer. */
public record CustomerLabelsRequest(
    List<Long> labelIds
) {
}
