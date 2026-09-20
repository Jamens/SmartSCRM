package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("chat_message")
public class ChatMessage {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long accountId;
    private String platform;
    private String chatKey;
    private String msgKey;
    private String direction;
    private Long customerId;
    private String senderKey;
    private String senderName;
    private String body;
    private String mediaType;
    private String mediaSummary;
    private LocalDateTime msgTime;
    private String status;
    private String source;
    private String sendLocalId;
    private LocalDateTime createdAt;
}
