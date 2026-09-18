package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("customer_audience")
public class CustomerAudience {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String name;
    private Integer platformType;
    private String keyword;
    /** Comma-joined label ids defining this saved segment. */
    private String tagIds;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
