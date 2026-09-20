package com.smartscrm.server.web.vo;

import java.util.List;

public record BatchAcceptVO(int accepted, int duplicated, int rejected, List<String> reasons) {
}
