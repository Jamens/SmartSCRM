-- V27: B28 第二段——知识库文档管线（文档 + 分片）。
-- 按 docs/superpowers/specs/2026-10-06-b28-ai-knowledge-design.md §3.1/§3.2 定模：
-- 文档(knowledge_doc)存上传的原始正文，解析后切成分片(knowledge_chunk)；派生 QA
-- 由分片经 deriveQaPreview 预览、人工确认后才落 knowledge_qa（不自动落库，见 spec §8）。
--
-- 约定：tenant_id 隔离；status 走 parsing→ready/failed→disabled（disabled 不参与检索与派生，
-- 保留行供恢复）；chunk 用 (doc_id, seq) 定位，derived 标记是否已被人工确认/派生过。
--
-- Idempotent: CREATE TABLE IF NOT EXISTS，重跑 no-op。

CREATE TABLE IF NOT EXISTS `knowledge_doc` (
  `id`          BIGINT        NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT        NOT NULL,
  `name`        VARCHAR(200)  NOT NULL,
  `source_type` VARCHAR(20)   NOT NULL DEFAULT 'text' COMMENT 'text | file | url（本期只做 text/file）',
  `content`     LONGTEXT      NULL     COMMENT '原始正文（text 直接存；file 存抽取后的正文）',
  `status`      VARCHAR(20)   NOT NULL DEFAULT 'parsing' COMMENT 'parsing | ready | failed | disabled',
  `char_count`  INT           NOT NULL DEFAULT 0,
  `created_at`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_doc_tenant_status` (`tenant_id`, `status`),
  KEY `idx_doc_tenant_updated` (`tenant_id`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B28 知识库文档';

CREATE TABLE IF NOT EXISTS `knowledge_chunk` (
  `id`         BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT      NOT NULL,
  `doc_id`     BIGINT      NOT NULL,
  `seq`        INT         NOT NULL COMMENT '分片序号，从 0 起',
  `content`    TEXT        NOT NULL,
  `char_count` INT         NOT NULL DEFAULT 0,
  `derived`    TINYINT     NOT NULL DEFAULT 0 COMMENT '1=已被人工确认/派生过',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chunk_doc_seq` (`doc_id`, `seq`),
  KEY `idx_chunk_tenant_doc` (`tenant_id`, `doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='B28 文档分片';
