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
    /**
     * B17 P1 归属：public（租户内共享，owner_key 为 NULL）/ personal（owner_key = app_user.id）
     * / contact（owner_key = customer.id）。取值与键的成形只在 {@link com.smartscrm.server.service.MaterialScope} 里。
     */
    /**
     * B17 P3：type=5（按钮）时的按钮载荷 JSON `{body,title,footer,buttons:[...]}`，其余类型为 null。
     * 校验规则见 {@link com.smartscrm.server.service.MaterialButtons}。
     */
    private String buttonPayload;
    private String ownerScope;
    private String ownerKey;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
