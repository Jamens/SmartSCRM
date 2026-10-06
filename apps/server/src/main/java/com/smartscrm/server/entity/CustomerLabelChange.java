package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B23 客户标签变更流水。
 *
 * <p>为什么需要这张表：{@code customer_label} 是「撤标即删行」的关联表——撤标后行直接没了，
 * 推不出「谁在什么时候给哪个客户打/撤了哪个标签」。流水由标签写入路径显式落（单个客户 setLabels
 * 与批量打/撤标签都要落），只增不改不删，供客户详情页的变更时间线回溯。
 */
@Data
@TableName("customer_label_change")
public class CustomerLabelChange {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long customerId;
    private Long labelId;
    /** add / remove。 */
    private String action;
    /** 操作人标识（用户 id，可为空）。 */
    private String operator;
    private LocalDateTime createdAt;
}
