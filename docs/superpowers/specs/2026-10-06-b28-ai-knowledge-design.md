# B28 AI 智能客服 + AI 知识库 设计（2026-10-06 扩 spec）

> 这份是**扩写**的：清单 B28 原行只写「QA / 角色 / 分类三栏 + 养号设置与推荐规则」，
> 而「B 档范围提示」明写它「字面写窄了」——除三栏外还缺 **AI 转人工规则引擎 / 人工接管队列 /
> 知识库文档实体 / AI 人设助手**。本 spec 的头号目的是**把缺口的数据模型一次定死**，
> 免得做到一半发现三栏之外还缺半张表（这正是清单 §B 档提示的告诫）。
> 状态：转人工规则 + 接管队列**后端 P1 已交付**（见 §2），本 spec 补齐其余并给分期。

## §1 范围与不做

**做**（B28 全部）：
- AI 转人工规则引擎（已交付 P1，本 spec 只补口径）。
- 人工接管队列（状态机已交付 P1；本 spec 补**前端接管台**）。
- **知识库文档实体**：上传 → 解析模式 → 分片预览 → 派生 QA 预览 → 停用 / 重解析。
- **AI 人设助手**：人设的生成 / 优化 / 模板库。
- 前端三栏（QA / 角色 / 分类）+ 养号设置与推荐规则。

**不做**（本阶段明确排除，写进 spec 免得日后混进来）：
- 不做向量检索 / embedding（RAG 本体）；分片与 QA 派生是**列表 + 人工确认**，不自动入向量库。
- 不做多轮会话编排引擎；人设与知识库只提供**数据与规则**，真正"AI 自动回复"另立项。
- 不做跨租户共享知识库；一切按 `tenant_id` 隔离。
- 遥测外传那一档不做（本项目定位：外部服务自托管或不接）。

## §2 已有地基（P1 已交付，本 spec 的起点）

转人工 / 接管这条链**已经通电**，不要重做：
- **V16**：`chat_conversation` 加 `handling_status`(`AI|WAITING_TAKEOVER|HUMAN_ACTIVE`)、
  `assignee_id`（坐席=app_user.id）、`ai_persona_id`（**人设引擎的 deferred hook，本期仍未接**）、
  `wait_takeover_at`、`transfer_reason`。
- **V17**：`ai_transfer_rule` 表 + `AiTransferRule` 实体 + `AiTransferRuleService` + `AiTransferRuleController`。
  规则语义：`match_mode`(any|all) + `keywords`，按 `priority` 降序评估。
- **V18**：把转人工规则挂进菜单权限（`/api/admin` 侧）。
- **状态机**：`TakeoverService`——`transferHuman`(→`WAITING_TAKEOVER` 进队列)、
  `takeover`(→`HUMAN_ACTIVE` 坐席接管)、`resumeAi`(→`AI`)、`queue()`(队列按等待时长升序)。
- **接线**：`MessageService.accept` 入站时按 chatKey 去重评估 `firstMatch`，命中则 `transferIfAi`
  （仅 AI 态才转，不抢已被接管的会话）。
- **A10 通知**：`transferHuman` 进队列时已投递「有会话待接管」系统通知（见 A10 第二个触发点）。

**缺口**（本 spec 要补的）：知识库文档 / 分片 / QA 实体、人设引擎、接管台前端、三栏前端、养号设置。

## §3 数据模型（缺口部分——本 spec 的重点）

全部按 `tenant_id` 隔离；`CREATE TABLE IF NOT EXISTS` + `information_schema` 幂等守卫（沿用 V17/V21 纪律）。

### 3.1 知识库文档（`knowledge_doc`）
上传的一个原始文档，解析出分片与 QA 都挂在它下面。
- `id`、`tenant_id`
- `name` VARCHAR(200) 文档名
- `source_type` VARCHAR(20)：`text` | `file` | `url`（本期只做 text/file，url 预留）
- `content` LONGTEXT 原始正文（text 直接存；file 存抽取后的正文）
- `status` VARCHAR(20)：`parsing` | `ready` | `failed` | `disabled`（停用=不参与检索/派生）
- `char_count` INT 正文字数
- `created_at` / `updated_at`

### 3.2 文档分片（`knowledge_chunk`）
按解析模式切出的片段，供预览与派生 QA。
- `id`、`tenant_id`、`doc_id`
- `seq` INT 分片序号
- `content` TEXT 该片正文
- `char_count` INT
- `derived` TINYINT 是否已被人工确认/派生过（0/1）

### 3.3 QA 对（`knowledge_qa`）
三栏里的 QA，可由分片派生而来（`doc_id`/`chunk_id` 非空）或手写（两者为空）。
- `id`、`tenant_id`
- `role_id` BIGINT 归属角色（可空=不绑角色）、`category_id` BIGINT 归属分类（可空）
- `question` TEXT、`answer` TEXT
- `source` VARCHAR(20)：`manual` | `derived`
- `doc_id` / `chunk_id` BIGINT NULL（派生来源，手写为空）
- `status` TINYINT 1 启用 / 0 停用
- `created_at` / `updated_at`

### 3.4 角色 / 分类（`ai_role` / `ai_category`）
三栏的两个维度，都是租户级字典。
- `ai_role`：`id`、`tenant_id`、`name`、`prompt` TEXT（人设提示词，喂 §3.5）、`enabled`、`sort`
- `ai_category`：`id`、`tenant_id`、`name`、`sort`
- 两者都加 `uk(tenant_id, name)` 防重名。

### 3.5 AI 人设（`ai_persona`）
挂在 §3.4 的 `ai_role` 上；`chat_conversation.ai_persona_id` 就是指向它（V16 已留 hook）。
- `id`、`tenant_id`、`role_id` BIGINT
- `name` VARCHAR(100)、`tone` VARCHAR(50)（语气标签）、`prompt` TEXT（系统提示词正文）
- `template` VARCHAR(50) NULL（从哪个模板生成，如 `friendly`/`pro`）
- `enabled` TINYINT、`created_at` / `updated_at`

### 3.6 养号设置（`ai_nurture_setting`）
B28 行写的"养号设置与推荐规则"——按租户一份，存推荐参数。
- `id`、`tenant_id`
- `daily_limit` INT 每日主动触达上限
- `active_ratio` TINYINT 主动/被动比例
- `quiet_hours` VARCHAR(20) 静默时段（如 `22:00-08:00`）
- `recommend` VARCHAR(20) 推荐口径：`conservative` | `balanced` | `aggressive`
- 单租户一份（`uk(tenant_id)`）。

## §4 纯规则（`src/shared/aiKnowledge.ts`）
可单测的纯逻辑，不碰 I/O：
- `deriveQaPreview(chunk)`：分片 → 候选 QA（问/答）的**启发式抽取**（首行作问、其余作答，
  明显不合格返回空数组交人工），供"派生 QA 预览"。
- `qaRowIsEnabled(qa)` / `roleRowIsEnabled(role)`：三栏启停的统一口径（停用不参与）。
- `personaTemplateOf(tone)`：语气标签 → 模板 id，供人设助手"套模板"。

## §5 后端（Java）
- `KnowledgeDocController`：文档 CRUD + 上传 + 解析/重解析（`POST /{id}/parse`）+ 停用。
- `KnowledgeChunkController` / 或并入文档端点：分片列表、派生 QA 预览（不落库，确认才 `POST /qa`）。
- `KnowledgeQaController`：QA CRUD（手写/派生共用）、按角色/分类筛选。
- `AiRoleController` / `AiCategoryController`：字典 CRUD。
- `AiPersonaController`：人设 CRUD + 生成/优化（生成调 §6 的模型，失败不落库）。
- `AiNurtureController`：养号设置读写。
- 全部租户隔离（`principal.tenantId()`），绝不从 body 信任。

## §6 前端
- `/ai` 工作区（HashRouter 路由 + 侧栏入口），三个 tab 对应三栏：
  - **QA 栏**：列表 + 筛选（角色/分类/启停）+ 增删改 + 从文档派生入口。
  - **角色栏**：角色 CRUD + 关联人设。
  - **分类栏**：分类字典 CRUD。
- **接管台**（B28 P4）：读 `TakeoverService.queue()`，按等待时长升序展示 `WAITING_TAKEOVER` 会话，
  提供「接管」「恢复 AI」两个动作，接管后进 `HUMAN_ACTIVE`。
- **知识库文档页**：上传 → 解析中 → 分片预览 → 勾选分片派生 QA（走 §4 预览，人工确认落库）。
- **人设助手**：选模板 → 生成/优化提示词 → 存到角色。
- **养号设置**：一行开关 + 推荐口径下拉（落 `ai_nurture_setting`）。

## §7 验收面
- 迁移 V2x：`knowledge_doc` / `knowledge_chunk` / `knowledge_qa` / `ai_role` / `ai_category` /
  `ai_persona` / `ai_nurture_setting`，重跑不报错（幂等）。
- 纯规则单测：`deriveQaPreview` 各种输入 + 启停口径 + 模板映射（`src/shared/aiKnowledge.test.ts`）。
- 后端单测：各 Controller/Service 租户隔离、派生落库、接管台队列排序。
- 端到端（接 CDP 时）：上传一篇文档 → 解析 → 派生 QA → 三栏可见 → 接管台能看到转人工会话并接管。

## §8 陷阱
- **派生 QA 不自动落库**：分片→QA 是**预览 + 人工确认**（§4 的 `deriveQaPreview` 只产候选）。
  自动入库会让"解析模式"错了却无法回退。
- **`ai_persona_id` 是 deferred hook**：V16 留了列但**没有外键/引擎**，接人设引擎前它一直是 null；
  别在它上面写"人设生效"的假读数。
- **停用 ≠ 删除**：文档/QA/角色都有 `enabled`/`disabled`，停用后不参与检索与派生，但保留行供恢复。
- **转人工规则只在 AI 态生效**：`transferIfAi` 有守卫，已被坐席接管的会话不会被新入站消息抢走；
  前端接管台不要绕过这个状态机直接改 `handling_status`。
- **V23 已给 `chat_message` 加 `has_sensitive`**：知识库分片/QA 若将来也要过敏感词，复用那条标记口径，
  别新造一套。
