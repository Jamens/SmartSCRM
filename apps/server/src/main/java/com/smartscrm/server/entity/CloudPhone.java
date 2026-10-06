package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B10 云手机设备（spec §2）。v1 只存记录 + 状态，拉流在前端 canvas 模拟渲染，不接真实 VMOS。
 *
 * <p>{@code host} 字段只存不用（v1 不发起任何外连）；{@code streamSeed} 决定模拟拉流的渲染图案，
 * 用确定性种子而非 Math.random，保证同设备渲染稳定可复现（spec §5）。
 */
@Data
@TableName("cloud_phone")
public class CloudPhone {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 设备别名。 */
    private String name;
    /** 厂商占位：generic / vmos（v1 仅展示，不消费）。 */
    private String provider;
    /** 连接地址（真实 provider 用，v1 不消费）。 */
    private String host;
    /** offline / booting / online / error。 */
    private String status;
    /** 规格：安卓版本。 */
    private String androidVersion;
    /** 规格：分辨率，如 1080x1920。 */
    private String resolution;
    /** 模拟拉流的确定性种子。 */
    private Integer streamSeed;
    private String remark;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
