-- V51: B28 第四段——知识库向量检索的向量存储。
-- 按 docs/superpowers/plans/2026-10-13-knowledge-search-design.md 定模。
--
-- 背景：knowledge_qa 存得进、检索不出（KnowledgeQaService 此前只有 CRUD，无任何召回方法）。
-- 本迁移补上检索所需的向量层，让「问一句 → 召回最相近的 QA」成为可能。
--
-- 为什么不用原生向量索引：本机 MySQL 无 have_vector（26.7.0 实测为空），
-- 且知识库量级在千条以内，应用层余弦计算足够。故存 JSON 文本 + 应用层算分。
--
-- 约定：
--   tenant_id 隔离（同 knowledge_qa）；一条 QA 一条向量，qa_id 唯一。
--   model     记 embedding 模型标识，换模型时靠它区分旧数据是否失效。
--   dim       记维度，换模型维度变了旧向量不可比，配合 model 一起判定。
--   content_hash 记被向量化文本的摘要，改了内容则重算，避免脏向量。
--   vector    存 JSON 数组（如 [0.012,-0.34,...]），应用层解析算余弦。
--
-- Idempotent: CREATE TABLE IF NOT EXISTS 是重跑 no-op；Flyway DDL 隐式提交，
-- 重复执行裸 CREATE 会撞 1050(table exists)，故用 IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS `knowledge_qa_embedding` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT       NOT NULL,
  `qa_id`        BIGINT       NOT NULL COMMENT '对应 knowledge_qa.id',
  `model`        VARCHAR(64)  NOT NULL COMMENT 'embedding 模型标识，换模型时旧数据失效',
  `dim`          INT          NOT NULL COMMENT '向量维度；与 model 一起判定可比性',
  `vector`       JSON         NOT NULL COMMENT 'float 数组，JSON 存储，应用层算余弦',
  `content_hash` CHAR(64)     NOT NULL COMMENT '被向量化文本的 sha256；内容变了要重算',
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_embedding_tenant_qa` (`tenant_id`, `qa_id`),
  KEY `idx_embedding_model` (`model`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B28 知识库 QA 向量（检索用）';

-- A16 配套：检索是只读动作，沿用 knowledge:read，不新增权限码。
-- （V26 已把 knowledge:read 授予 super_admin / tenant_admin，此处无需再播种。）
