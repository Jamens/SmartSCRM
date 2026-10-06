-- B10 修正：V36 误用了 create_time/update_time，但 MyBatis-Plus 默认把实体 createdAt/updatedAt
-- 映射成 created_at/updated_at（与全仓其他表一致）。本迁移把列改名。
-- V36 已在运行库应用、不能改（Flyway 校验和会拒绝启动），故单独补 V38 修正列名。
-- 幂等前提：V36 一律生成 create_time/update_time，故每个库都需改名，且 Flyway 按版本只跑一次。

ALTER TABLE cloud_phone CHANGE create_time created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE cloud_phone CHANGE update_time updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
