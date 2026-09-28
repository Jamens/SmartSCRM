package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("batch_send_detail")
public class BatchSendDetail {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long taskId;
    private Integer seq;
    private Long accountId;
    private String chatKey;
    private Long customerId;
    private Integer contentIndex;
    private String body;
    private String localId;
    private String sendStatus;
    private String errorCode;
    private String errorDetail;
    private String msgKey;
    private String recallStatus;
    private String recallDetail;
    private LocalDateTime sentAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
