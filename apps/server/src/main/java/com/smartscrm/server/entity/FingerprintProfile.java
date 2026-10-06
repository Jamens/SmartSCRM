package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B14 浏览器指纹配置（spec §2）。v1 只存指纹档案 + 状态 + 模拟生成结果，不探测任何真实设备。
 *
 * <p>开源红线约束：本仓不默认连接任何商业云/外部设备指纹服务，因此「生成指纹」在 v1 走
 * 确定性模拟（{@link FingerprintProfileService#generate(Long, Long)} 由 seed 派生 UA/分辨率/时区/
 * WebGL/噪声等演示数据，绝不真实读取本机或外连），与 B10 模拟拉流、B13 模拟出口探测同口径。
 * 后续若部署方自托管指纹网关，由环境变量注入替换该模拟实现即可，代码只留 env 入口。
 */
@Data
@TableName("fingerprint_profile")
public class FingerprintProfile {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 指纹别名。 */
    private String name;
    /** windows / macos / linux / android / ios。 */
    private String os;
    /** chrome / firefox / safari / edge。 */
    private String browser;
    /** User-Agent（生成结果）。 */
    private String userAgent;
    /** 分辨率（生成结果，WxH）。 */
    private String screenResolution;
    /** 时区（生成结果，IANA）。 */
    private String timezone;
    /** 语言区域（生成结果，如 en-US）。 */
    private String locale;
    /** WebGL 厂商（生成结果）。 */
    private String webglVendor;
    /** WebGL 渲染器（生成结果）。 */
    private String webglRenderer;
    /** Canvas 噪声种子（生成结果）。 */
    private String canvasNoise;
    /** Audio 噪声种子（生成结果）。 */
    private String audioNoise;
    /** 逻辑核数（生成结果）。 */
    private Integer hardwareConcurrency;
    /** 内存 GB（生成结果）。 */
    private Integer deviceMemory;
    /** active / inactive。 */
    private String status;
    /** 生成种子（regenerate 刷新）。 */
    private Long seed;
    /** 上次生成时间。 */
    private LocalDateTime generatedAt;
    private String remark;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
