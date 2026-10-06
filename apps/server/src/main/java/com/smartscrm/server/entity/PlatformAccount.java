package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("platform_account")
// 凭据是敏感数据：列表 / 详情接口统一不回写原文，只有专门的 GET /credential 才放行。
@JsonIgnoreProperties({ "sessionCredential" })
public class PlatformAccount {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Integer platformType;
    private String name;
    private String phone;
    private String avatar;
    private String viewId;
    /** 导入的会话凭据（导出的 localStorage JSON 原文），用于免扫码登录。 */
    @TableField("session_credential")
    private String sessionCredential;
    /** 仅用于列表展示"是否已导入凭据"，不落库。 */
    @TableField(exist = false)
    private Boolean hasCredential;
    private Integer status;
    private String remark;
    private LocalDateTime lastLoginAt;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
