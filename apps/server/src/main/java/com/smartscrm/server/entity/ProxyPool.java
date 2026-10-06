package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * B13 代理池代理记录（spec §2）。v1 只存记录 + 状态 + 模拟探测结果，不发起任何真实外连。
 *
 * <p>开源红线约束：本仓不默认连接任何商业云/外部探测服务，因此「出口 IP 探测 / 按 IP 查归属地」
 * 在 v1 走确定性模拟（{@link ProxyPoolService#probe(Long, Long)} 由 host+port 派生演示数据，
 * 用 TEST-NET-3 占位网段，绝不真实建连），与 B10 模拟拉流同口径。后续若部署方自托管探测网关，
 * 由环境变量注入替换该模拟实现即可，代码只留 env 入口。
 */
@Data
@TableName("proxy_pool")
public class ProxyPool {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    /** 代理别名。 */
    private String name;
    /** 代理地址。 */
    private String host;
    private Integer port;
    /** http / https / socks5。 */
    private String protocol;
    /** 认证用户名（可选）。 */
    private String username;
    /** 认证密码（可选，存明文；自托管工具务实取舍）。 */
    private String password;
    /** online / offline / error / degraded。 */
    private String status;
    /** 上次（模拟）探测时间。 */
    private LocalDateTime lastCheckedAt;
    /** 出口 IP（模拟探测结果，TEST-NET-3 占位）。 */
    private String egressIp;
    /** 归属地（模拟探测结果，country · region · city）。 */
    private String egressGeo;
    /** 延迟毫秒（模拟探测结果）。 */
    private Integer latencyMs;
    private String remark;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
