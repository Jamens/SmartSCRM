package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("customer")
public class Customer {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Integer platformType;
    private String openId;
    private String nickname;
    private String avatar;
    private String phone;
    private String email;
    private String country;
    private Integer sex;
    private String remark;
    private String vipOpenId;
    private String vipNickname;
    private LocalDateTime firstSeenAt;
    private LocalDateTime lastContactAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
