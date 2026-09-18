package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.Customer;
import java.util.List;

public record CustomerVO(
    Long id,
    Integer platformType,
    String openId,
    String nickname,
    String avatar,
    String phone,
    String email,
    String country,
    Integer sex,
    String remark,
    String vipOpenId,
    String vipNickname,
    java.time.LocalDateTime firstSeenAt,
    java.time.LocalDateTime lastContactAt,
    java.time.LocalDateTime createdAt,
    List<LabelVO> labels
) {

    public static CustomerVO of(Customer c, List<LabelVO> labels) {
        return new CustomerVO(
            c.getId(), c.getPlatformType(), c.getOpenId(), c.getNickname(), c.getAvatar(),
            c.getPhone(), c.getEmail(), c.getCountry(), c.getSex(), c.getRemark(),
            c.getVipOpenId(), c.getVipNickname(), c.getFirstSeenAt(), c.getLastContactAt(),
            c.getCreatedAt(), labels);
    }
}
