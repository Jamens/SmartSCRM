package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("quick_reply_item")
public class QuickReplyItem {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long replyId;
    /** 1=text 2=image 3=business-card */
    private Integer type;
    private String content;
    private Long materialId;
    private String mediaUrl;
    private String cardName;
    private String cardPhone;
    private Integer sort;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
