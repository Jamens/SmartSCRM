-- B14 浏览器指纹配置 · 指纹档案表（P11 数据层）。tenant 隔离。
-- v1：指纹档案 CRUD + 模拟生成（generate 由 seed 派生确定性指纹，开源版不探测真实设备）。
-- 时间列直接用语义名 created_at/updated_at（吸取 V36 教训）。
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑不报错。

CREATE TABLE IF NOT EXISTS `fingerprint_profile` (
  `id`                  BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT       NOT NULL,
  `name`                VARCHAR(64)  NOT NULL COMMENT '指纹别名',
  `os`                  VARCHAR(16)  NOT NULL DEFAULT 'windows' COMMENT 'windows/macos/linux/android/ios',
  `browser`             VARCHAR(16)  NOT NULL DEFAULT 'chrome' COMMENT 'chrome/firefox/safari/edge',
  `user_agent`          VARCHAR(512) DEFAULT NULL COMMENT 'User-Agent（生成结果）',
  `screen_resolution`   VARCHAR(16)  DEFAULT NULL COMMENT '分辨率（生成结果，WxH）',
  `timezone`            VARCHAR(64)  DEFAULT NULL COMMENT '时区（生成结果，IANA）',
  `locale`              VARCHAR(16)  DEFAULT NULL COMMENT '语言区域（生成结果，如 en-US）',
  `webgl_vendor`        VARCHAR(128) DEFAULT NULL COMMENT 'WebGL 厂商（生成结果）',
  `webgl_renderer`      VARCHAR(128) DEFAULT NULL COMMENT 'WebGL 渲染器（生成结果）',
  `canvas_noise`        VARCHAR(64)  DEFAULT NULL COMMENT 'Canvas 噪声种子（生成结果）',
  `audio_noise`         VARCHAR(64)  DEFAULT NULL COMMENT 'Audio 噪声种子（生成结果）',
  `hardware_concurrency` INT         DEFAULT NULL COMMENT '逻辑核数（生成结果）',
  `device_memory`       INT          DEFAULT NULL COMMENT '内存 GB（生成结果）',
  `status`              VARCHAR(16)  NOT NULL DEFAULT 'inactive' COMMENT 'active/inactive',
  `seed`                BIGINT       DEFAULT NULL COMMENT '生成种子（regenerate 刷新）',
  `generated_at`        DATETIME     DEFAULT NULL COMMENT '上次生成时间',
  `remark`              VARCHAR(255) DEFAULT NULL,
  `created_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fingerprint_profile_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B14 浏览器指纹配置';
