package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("translation_setting")
public class TranslationSetting {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String scope;
    private String scopeKey;
    private String server;
    private String serverMode;
    private String channel;
    private Boolean receiveEnabled;
    private String receiveFromLang;
    private String receiveToLang;
    private Boolean sendEnabled;
    private String sendFromLang;
    private String sendToLang;
    private Boolean voiceEnabled;
    private Boolean previewEnabled;
    private Boolean enterToSend;
    private Boolean disableChinese;
    private Boolean disableChinesePreventSend;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
