-- V13__group_gate_reading.sql
-- 覆盖率闸的读数落库（R1 / R35）。V12 没建这两列，§8 的「本次快照人数较上次少 x%」与
-- 泵的位置优先（R28）都读不到东西。
ALTER TABLE chat_group
    ADD COLUMN last_coverage DOUBLE NULL COMMENT '最近一次快照判定的覆盖率；NULL = 没做过可判定的快照' AFTER snapshot_count,
    ADD COLUMN last_reconcile_reason VARCHAR(24) NULL COMMENT 'ok | first_build | coverage_too_low | no_snapshot' AFTER last_coverage;

-- 回滚段（与 V9 / V12 同形，人工执行）：
-- ALTER TABLE chat_group DROP COLUMN last_reconcile_reason, DROP COLUMN last_coverage;
