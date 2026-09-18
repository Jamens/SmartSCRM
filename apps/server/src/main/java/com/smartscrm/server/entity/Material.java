package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("material")
public class Material {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long groupId;
    /** 1=image 2=video 3=audio 4=file */
    private Integer type;
    private String name;
    private String url;
    private String mimeType;
    private Long sizeBytes;
    private String remark;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
