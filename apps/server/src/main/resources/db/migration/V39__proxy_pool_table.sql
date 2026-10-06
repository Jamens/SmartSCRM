-- B13 代理池 · 代理表（P11-1 数据层）。tenant 隔离。
-- v1：代理记录 + 状态 + 模拟探测结果（egress_ip/geo/latency，开源版不发起外连，确定性模拟）。
-- 时间列直接用语义名 created_at/updated_at（吸取 V36 教训，不再用 create_time/update_time）。
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑不报错。

CREATE TABLE IF NOT EXISTS `proxy_pool` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`        BIGINT       NOT NULL,
  `name`             VARCHAR(64)  NOT NULL COMMENT '代理别名',
  `host`             VARCHAR(255) NOT NULL COMMENT '代理地址',
  `port`             INT          NOT NULL DEFAULT 1080 COMMENT '代理端口',
  `protocol`         VARCHAR(16)  NOT NULL DEFAULT 'http' COMMENT 'http/https/socks5',
  `username`         VARCHAR(128) DEFAULT NULL COMMENT '认证用户名（可选）',
  `password`         VARCHAR(128) DEFAULT NULL COMMENT '认证密码（可选，存明文）',
  `status`           VARCHAR(16)  NOT NULL DEFAULT 'offline' COMMENT 'online/offline/error/degraded',
  `last_checked_at`  DATETIME     DEFAULT NULL COMMENT '上次（模拟）探测时间',
  `egress_ip`        VARCHAR(64)  DEFAULT NULL COMMENT '出口 IP（模拟探测结果）',
  `egress_geo`       VARCHAR(128) DEFAULT NULL COMMENT '归属地（模拟探测结果，country · region · city）',
  `latency_ms`       INT          DEFAULT NULL COMMENT '延迟毫秒（模拟探测结果）',
  `remark`           VARCHAR(255) DEFAULT NULL,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_proxy_pool_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B13 代理池';
