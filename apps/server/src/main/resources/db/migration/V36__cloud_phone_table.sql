-- B10 云手机 · 设备表（P12-1 数据层）。tenant 隔离。
-- v1：只存设备记录 + 状态；拉流在前端 canvas 模拟渲染，不接真实 VMOS（符合开源红线：默认不接商业云）。
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑不报错。

CREATE TABLE IF NOT EXISTS `cloud_phone` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`        BIGINT       NOT NULL,
  `name`             VARCHAR(64)  NOT NULL COMMENT '设备别名',
  `provider`         VARCHAR(32)  NOT NULL DEFAULT 'generic' COMMENT '厂商占位：generic/vmos（v1 仅展示，不消费）',
  `host`             VARCHAR(255) DEFAULT NULL COMMENT '连接地址（真实 provider 用，v1 不消费、不发起外连）',
  `status`           VARCHAR(16)  NOT NULL DEFAULT 'offline' COMMENT 'offline/booting/online/error',
  `android_version`  VARCHAR(32)  DEFAULT NULL COMMENT '规格',
  `resolution`       VARCHAR(16)  DEFAULT NULL COMMENT '规格，如 1080x1920',
  `stream_seed`      INT          NOT NULL DEFAULT 1 COMMENT '模拟拉流的确定性种子',
  `remark`           VARCHAR(255) DEFAULT NULL,
  `create_time`      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  `update_time`      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cloud_phone_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B10 云手机设备';
