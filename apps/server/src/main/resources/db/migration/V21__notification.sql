-- V21: A10 消息中心 / 站内通知。
-- 一条通知属于一个租户；user_id 为 NULL 表示广播给租户全员。已读状态**按用户**记在
-- notification_read（uk(notification_id,user_id)），因此一条广播通知对不同子账号可以
-- 各读各的（B22 多子账号场景）。可见性 = user_id = 当前用户 OR user_id IS NULL；
-- 未读 = 可见 且 我没有对应的 notification_read 行。
--
-- Idempotent: CREATE TABLE IF NOT EXISTS is a no-op on re-run, and Flyway runs DDL in
-- implicit-commit mode so a half-applied previous run would otherwise leave the tables
-- present and a bare CREATE would fail with 1050 (table exists) on retry.

CREATE TABLE IF NOT EXISTS `notification` (
  `id`         BIGINT        NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT        NOT NULL,
  `user_id`    BIGINT        NULL     COMMENT '目标用户；NULL = 租户全员广播',
  `type`       VARCHAR(20)   NOT NULL DEFAULT 'system' COMMENT 'system | user',
  `title`      VARCHAR(200)  NOT NULL,
  `content`    TEXT          NULL,
  `link`       VARCHAR(255)  NULL     COMMENT '点击跳转的前端路由，如 /messages',
  `created_at` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_notification_tenant_time` (`tenant_id`, `created_at`),
  KEY `idx_notification_user` (`tenant_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='A10 站内通知';

CREATE TABLE IF NOT EXISTS `notification_read` (
  `id`              BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT      NOT NULL,
  `notification_id` BIGINT      NOT NULL,
  `user_id`         BIGINT      NOT NULL,
  `read_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_notification_read` (`notification_id`, `user_id`),
  KEY `idx_read_tenant_user` (`tenant_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='A10 通知已读（按用户）';
