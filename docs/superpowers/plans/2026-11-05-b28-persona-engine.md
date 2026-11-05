# B28 AI 人设引擎 · 实施计划

> 分支 `feat/b28-persona-engine` · worktree `D:\Project\SmartSCRM-b28` · 2026-11-05
> 规格：`docs/superpowers/specs/2026-11-01-b28-persona-engine-design.md`（已确认）
> 纪律：RED → GREEN → REFACTOR，测试先写；每个任务提交前跑本任务的验证命令。

---

## 0. 核对规格后的三处补充裁定（实施时按此处，不按 spec 原文猜）

规格里没写死、但代码逼着要定的三件事，先定清楚再动手：

| # | 问题 | 裁定 | 依据 |
|---|---|---|---|
| **D1** | 检索端点未配置、但 chat 端点配了，走哪条？ | **跳过检索，直接走模型兜底**。并在返回里把这次标成 `source=model`。检索失败（端点异常 / 40905）同样只记 warn 后继续模型，不阻断 | `KnowledgeSearchService.search` 在 `available()==false` 时**抛 40905**，不是返回空列表。若照 spec §2.1 直接调，会变成"检索没配就用不了模型"。两条腿必须能独立启用 |
| **D2** | 模型生成的建议，`ai_suggestion_score` / `qa_id` 怎么办 | 两者都置 `NULL`，`source='model'`；检索命中则 `score`/`qaId` 有值、`source='retrieval'` | spec Q1 已定「留空」，本计划补上写库时**显式 set null**（否则会残留上一次检索建议的旧值） |
| **D3** | 否决建议时 `source` 列怎么处理 | `AiReplyService.clearSuggestion` 必须**一并清空 `ai_suggestion_source`** | spec S2「建议可弃、不残留」。现有 `clearSuggestion` 只清三列，漏清会让徽标挂在已否决的建议上 |

另有两处**文档与代码不符，以代码为准**（spec 风险 7 的既定口径）：

- `KnowledgeSearchService.search` 的真实签名是 `(Long tenantId, String query, Integer topK, Float threshold, Long roleId, Long categoryId)`，返回 `List<Hit>`，`Hit` 是 `record(KnowledgeQa qa, float score)`。spec §2.1 的伪码签名是简写。
- `PersonaEngine` 的落库职责：spec §1.1 #2 说「纯生成、不落库」，§2.1 又说引擎里「写建议」。本计划拆成两个方法：`generate(...)` 纯生成返回 `Suggestion`（不落库，可单测），`suggest(...)` 走完整流程并落库。两个说法都满足。

**权限提示**：接管台的人设下拉走现有 `useAiPersonas()`，后端要 `knowledge:read`；坐席角色可能没有这个码。前端下拉加载失败时给明确提示但**不阻断接管台其他功能**；绑定端点只用 `message:write`。

---

## 1. 后端（TDD）

### 任务 1：V54 迁移（先写"重跑不炸"的验证）
- 文件：`apps/server/src/main/resources/db/migration/V54__ai_suggestion_source.sql`（新）
- 要做：照 `V52__ai_suggestion_columns.sql` 的 `information_schema.COLUMNS` 守卫 + `PREPARE/EXECUTE` 写法，加一列：
  `chat_conversation.ai_suggestion_source VARCHAR(16) NULL COMMENT 'retrieval=知识库标准答案 | model=人设模型生成；NULL=无建议或旧数据'`，位置 `AFTER ai_suggestion_qa_id`。
- 验证：SQL 里连续两遍跑该脚本不报错（守卫生效）；`./mvnw test -q` 不因迁移编译失败。

### 任务 2：实体 / VO 加字段（RED）
- 文件：`apps/server/src/main/java/com/smartscrm/server/entity/ChatConversation.java`、`web/vo/ConversationVO.java`
- 要做：实体加 `private String aiSuggestionSource;`；VO record 末尾加 `String aiSuggestionSource` 参数并在 `of()` 里传 `c.getAiSuggestionSource()`。
- 验证：`./mvnw test -q` 里既有 `ConversationVOTest`（若有）编译失败 → 先补测试断言新字段透出，再改实现转绿。

### 任务 3：`ChatClient` 测试先行（RED）
- 文件：`apps/server/src/test/java/com/smartscrm/server/service/ai/ChatClientTest.java`（新）
- 要做：用 JDK 自带 `com.sun.net.httpserver.HttpServer` 起本地 mock（零依赖，端口 0 随机），覆盖 8 条：
  ① 未配 baseUrl → `available()==false` 且 `complete` 抛 40906；② 配了 baseUrl 但 model 空 → 同样 false；
  ③ 正常响应取 `choices[0].message.content`；④ 401 → 抛 40906；⑤ 500 → 抛 40906；
  ⑥ 超时（mock 睡 200ms，构造传 `timeoutMs=60`）→ 抛 40906；⑦ 畸形 JSON → 抛 40906；
  ⑧ 缺 `choices` → 抛 40906；⑨ 有 apiKey 时请求带 `Authorization: Bearer`，无 apiKey 时**不带该头**。
- 验证：`./mvnw test -q -Dtest=ChatClientTest` **先看到红**（类不存在），再进任务 4。

### 任务 4：`ChatClient` 实现（GREEN）
- 文件：`apps/server/src/main/java/com/smartscrm/server/service/ai/ChatClient.java`（新）
- 要做：照 `EmbeddingClient` 的形状。`@Component`，构造器用 `@Value` 注入
  `${scrm.chat.base-url:}` / `${scrm.chat.model:}` / `${scrm.chat.api-key:}` /
  `${scrm.chat.timeout-ms:30000}` / `${scrm.chat.max-tokens:512}` / `${scrm.chat.temperature:0.3}`；
  另给一个**包可见的全参构造器**供单测直接 new（不依赖 Spring）。
  - `available()` = baseUrl 非空 **且** model 非空（两者都空 = 未启用，对齐 spec S5）
  - `complete(List<Msg> messages)` → `POST {baseUrl}/v1/chat/completions`，body 含
    `model` / `messages` / `temperature` / `max_tokens` / `stream:false`；`Content-Type: application/json`，
    apiKey 非空才加 `Authorization`。
  - `Msg` 用 `record Msg(String role, String content)`；非 2xx / IOException / 超时 / 解析失败一律抛
    `BizException(40906, ...)`，**不吞异常**。响应内容只截取前 200 字记日志，不回显给前端。
- 验证：`./mvnw test -q -Dtest=ChatClientTest` 全绿。

### 任务 5：配置落地
- 文件：`apps/server/src/main/resources/application.yml`
- 要做：在 `scrm:` 下加 `chat:` 块（`base-url` / `model` / `api-key` / `timeout-ms` / `max-tokens` / `temperature` 全走环境变量、**默认空**），注释写明「默认空=未启用，不默认外连任何商业云」，并附本地 Ollama 的 env 注入示例。
- 验证：`grep -n "scrm:" -A 12 application.yml` 能看到两块；仓库里无硬编码 `11434` 作为启用默认值。

### 任务 6：`PersonaEngine` 测试先行（RED）
- 文件：`apps/server/src/test/java/com/smartscrm/server/service/ai/PersonaEngineTest.java`（新）
- 要做：Mockito mock `MessageQueryService` / `AiPersonaService` / `AiRoleMapper` / `KnowledgeSearchService` / `ChatClient` / `ChatConversationMapper` / `ChatMessageMapper`，`TableInfoHelper.initTableInfo` 初始化 `ChatConversation`。覆盖 spec T1–T10 + 三条新增：
  T1 未配 chat 端点 → 抛 40906、mapper 零写；T2 检索命中 → `source=retrieval` + qaId 非空 + **chatClient 零调用**；
  T3 检索未命中 + 模型可用 → `source=model` + qaId/score 为 null + 正文等于模型返回；
  T4 模型非 2xx / T5 超时 / T6 畸形响应 → 均不写库；T7 未绑人设 → 拒、零调用；
  T8 跨租户人设 → 拒；T9 停用人设或停用角色 → 拒；T10 历史 `in`→user / `out`→assistant、空正文跳过；
  T11 **D1**：检索未启用 → 跳过检索直接走模型（且 `source=model`）；
  T12 **D1**：检索抛 40905 → 记 warn 后仍走模型，不阻断；
  T13 **D2**：模型建议写库时显式把 score/qaId 置 null（断言 update wrapper 里含这两列的 null set）。
- 验证：`./mvnw test -q -Dtest=PersonaEngineTest` **先红**。

### 任务 7：`PersonaEngine` 实现（GREEN）
- 文件：`apps/server/src/main/java/com/smartscrm/server/service/ai/PersonaEngine.java`（新）
- 要做：`@Service`，两个公开方法：
  - `Suggestion generate(Long tenantId, Long conversationId)` — **纯生成不落库**，返回
    `record Suggestion(String text, String source, Long qaId, Float score)`。
    顺序：`requireOwned` → 未绑人设拒 → `AiPersonaService.get` + `enabled==1` → 角色存在则校验 `tenantId` + `enabled==1` →
    取最近入站消息作 query（无入站则拒）→ **检索优先**（`searchService.available()` 为 true 才调，异常只 warn 不抛，见 D1）→
    命中返回 `retrieval` → 未命中且 `chatClient.available()` 为 true 则组装提示词走模型 → 否则抛 40906。
  - `ConversationVO suggest(Long tenantId, Long conversationId)` — 调 `generate`，成功后用
    `LambdaUpdateWrapper` **一次性 set 四列**（`ai_suggestion` / `score` / `qa_id` / `source`），返回重新读出的 VO。
    任一步失败都不写库（R5）。
  - 提示词组装按 spec §2.3：固定护栏 + `ai_role.prompt` + `ai_persona.prompt` 三段 system（任一为空跳过该段），
    历史取最近 10 条（`scrm.chat.history-size`，默认 10），`LambdaQueryWrapper` 按
    `(tenant_id, account_id, platform, chat_key)` + `body` 非空，`orderByDesc(id)` + `last("LIMIT 10")` 后**反转**为时间正序。
    system 段**绝不含客户正文**（spec 风险 3）。
- 验证：`./mvnw test -q -Dtest=PersonaEngineTest` 全绿。

### 任务 8：两个端点 + 否决建议补清 source
- 文件：`apps/server/src/main/java/com/smartscrm/server/web/ConversationController.java`、
  `apps/server/src/main/java/com/smartscrm/server/service/ai/AiReplyService.java`
- 要做：
  - `PUT /api/conversations/{id}/ai-persona`，`@PreAuthorize("hasAuthority('message:write')")`，
    body `record AiPersonaBindRequest(Long personaId)`；`personaId=null` = 解绑；非 null 先 `AiPersonaService.get`
    校验本租户 + `enabled==1`，不属于则抛业务异常（不静默忽略）。返回 `ConversationVO`。
  - `POST /api/conversations/{id}/generate-ai-suggestion`，同为 `message:write`，委托 `personaEngine.suggest(...)`。
  - `AiReplyService.clearSuggestion` 的 update wrapper 补 `.set(ChatConversation::getAiSuggestionSource, (String) null)`（D3）。
  - `AiReplyService.doSuggest` 写建议处补 `.set(...Source, "retrieval")`，让**自动应答**那条老链路也标来源，避免新旧建议来源不一致。
- 验证：`./mvnw test -q` 全绿；新增 `AiReplyServiceTest` 断言 `clearSuggestion` 清四列、自动链路标 `retrieval`。

### 任务 9：`AiPersonaService.generateDraft` 加模型分支
- 文件：`apps/server/src/main/java/com/smartscrm/server/service/AiPersonaService.java`、
  `web/AiPersonaController.java`、`apps/server/src/test/java/com/smartscrm/server/service/AiPersonaServiceModelTest.java`（新）
- 要做：构造器注入 `ChatClient`（可为 null 不影响既有单测 → 用 `@Autowired(required=false)` 或加一个保持旧签名的构造器）；
  `generateDraft(tone)` 在 `chatClient.available()` 为 true 时调模型生成 `prompt`，**失败回落模板且不报错**；
  返回 `PersonaDraft` 增加一个 `source` 字段（`template` / `model`）标来源。
- 验证：既有 `AiPersonaServiceTest` 不破；新测试覆盖「模型可用→source=model」「模型抛异常→回落 template 不抛」「端点未配→template」三条。

---

## 2. 前端（TDD）

### 任务 10：契约与纯函数（RED → GREEN）
- 文件：`apps/desktop/src/renderer/src/api/aiKnowledge.ts`、`apps/desktop/src/renderer/src/lib/aiSuggestion.ts`（新）、`lib/aiSuggestion.test.ts`（新）
- 要做：
  - `TakeoverQueueItem` 加 `aiPersonaId: number | null` 与 `aiSuggestionSource: 'retrieval' | 'model' | null`。
  - `lib/aiSuggestion.ts` 导出两个纯函数：`canGenerate(item)` = 已绑人设 且 非生成中；
    `sourceBadge(source)` = `retrieval→'ai.queue.sourceKnowledge'` / `model→'ai.queue.sourceModel'` / 其余 null。
  - 单测先写：未绑人设禁用、绑了可用、来源映射、未知来源不显示徽标。
  - 新增 hooks：`useBindPersona()` → `http.put('/api/conversations/${id}/ai-persona', { personaId })`；
    `useGenerateSuggestion()` → `http.post('/api/conversations/${id}/generate-ai-suggestion')`；
    两者 `onSuccess` 都 invalidate `QK.queue`。
- 验证：`pnpm --filter smartscrm-desktop exec node --test src/renderer/src/lib/aiSuggestion.test.ts` 转绿。

### 任务 11：接管台 UI
- 文件：`apps/desktop/src/renderer/src/pages/AiWorkspacePage.tsx`
- 要做：重写 `QueueTab` 的每个 `<li>`，加：
  - 人设下拉（`useAiPersonas()` 过滤 `enabled`，`value=c.aiPersonaId ?? ''`，变化时调 `useBindPersona`）；
  - 「生成回复建议」按钮（**文案不承诺人设**，spec §2.8），未绑人设 `disabled` + `title` 指向 `noPersonaHint`，
    loading 态显示 `generating`；
  - 建议正文一行 + 来源徽标（两色，`knowledge` / `model`）+ 沿用现有 `dismissAiSuggestion` 的否决按钮；
  - 下拉加载失败给一行提示，不阻断接管 / 恢复 AI 两个既有按钮。
- 验证：`pnpm run typecheck`（五路）全绿。

### 任务 12：8 语 i18n
- 文件：`apps/desktop/src/renderer/src/i18n/locales/{zh-CN,zh-TW,en,ja,ko,id,th,vi}.ts`
- 要做：在 `ai.queue` 下补 **10 个** key：`persona` / `personaPlaceholder` / `generate` / `generating` /
  `sourceKnowledge` / `sourceModel` / `noPersonaHint` / `dismiss` / `personaLoadFailed` / `generateFailed`（最后一条是 review 时补的「生成失败可见」，真机腿 R5 要求）。
  zh-CN、en 写准确文案，其余 6 语也给了本地化短文案（**必须补齐 key**，i18n 类型会检查）。
- 验证：`pnpm run typecheck:web` 全绿；8 个文件 grep 都能命中 `sourceModel`。

---

## 3. 离线契约 harness + 真机验收

### 任务 13：mock OpenAI 兼容端点 + harness ≥8 条
- 文件：`apps/desktop/test/ai-persona/mock-openai.mjs`（新）、`ai-persona-offline-integration.mjs`（新）、`run.mjs`（新）、
  `apps/desktop/package.json` 加 `test:ai` 脚本
- 要做：照 `test/telegram-protocol/` 的骨架，零依赖 `node:http` 起 mock，实现
  `/v1/models`、`/v1/chat/completions` 正常 / 401 / 500 / 畸形 JSON / 慢响应；
  harness 断言请求形状（`model`/`messages`/`stream:false`、apiKey 头规则）与响应解析，≥8 条用例。
- 验证：`pnpm --filter smartscrm-desktop run test:ai` 输出 `8/8 passed`。

### 任务 14：真机腿（模型拉完后执行）
- 文件：`apps/desktop/test/ai-persona/real-model-probe.mjs`（新）
- 要做：读 `SCRM_CHAT_BASE_URL`（默认 `http://127.0.0.1:11434`）与 `SCRM_CHAT_MODEL`，
  用**两份不同人设的 system prompt** 各跑一次，断言：① 两次都非空；② 输出语气特征可区分
  （如一份要求「只给一句话结论、不寒暄」，另一份要求「先安抚情绪再给步骤」，断言长度/措辞差异）；
  ③ 停端点时给明确错误、不留半截建议。
- 验证：`node real-model-probe.mjs` 通过。**若本机 MySQL/后端未起，端到端 HTTP 腿显式标注未跑**，
  不得把端点直连探针的结果冒充端到端验收。

### 任务 15：全量验证
- **实际命令**（根包没有 `build` / `lint` 脚本，计划初稿写错了，按真实脚本走）：
  `pnpm run typecheck` / `pnpm --filter smartscrm-desktop run test:unit` / `./mvnw test -q` /
  `pnpm --filter smartscrm-desktop run test:ai` / `pnpm --filter smartscrm-desktop run build` /
  `pnpm --filter @smartscrm/admin run lint` / `pnpm --filter @smartscrm/admin run build` /
  `pnpm --filter smartscrm-desktop run lint`
- lint 既有 2 个 error 位于 `src/main/webContentsView/allowedViewUrls.verify.mjs`（`explicit-function-return-type`），非本次引入，记录不修；
  另有全仓库 CRLF 引起的 6 万余条 prettier warning，同属既有风格问题。本次新增文件 lint error 已清零。

---

## 4. 收尾

### 任务 16：回填台账与文档
- 文件：`docs/feature-backlog.md`、`docs/feature-checklist.md`、`README.md`、`README.en.md`
- 要做：`feature-backlog.md` §二之二 记「B28 人设引擎已交付」并注明真机腿结果；
  `feature-checklist.md` 补 B28 第七段；README §8 加一条；本分支的 spec 头部状态改「已交付」。
- 验证：`git diff --stat` 只含预期文件，**不得包含 `.workbuddy/` 或任何竞品分析内容**。

### 任务 17：代码评审 + 合并
- 要做：对照本计划逐任务 review（先查规格符合度，再查代码质量）；Critical 级阻断。
  合并回 `main`，删 worktree，最后再跑一次全量验证。
- 验证：`git log --oneline -3` 出现 B28 合并提交；`git status --porcelain` 干净。

---

## 5. 红线复核清单（提交前逐条打勾）

- [x] 端点与模型名全走配置注入，**默认空**，仓库里无硬编码商业云地址
- [x] 只产出建议，后端无任何出站发送调用
- [x] 检索优先、模型兜底；检索失败不阻断模型（D1），模型失败**绝不写库**（R5）
- [x] 未绑人设 = 无模型路径，按钮前端禁用 + 后端拒绝双闸
- [x] 租户隔离：人设 / 角色 / 会话 / 消息全按 `principal.tenantId()` 收窄

---

## 6. 实施记录（2026-11-05）

| 任务 | 结果 |
|---|---|
| 1–9 后端 | `c96335c` 已提交。后端 559 → **595/0**；review 无 Critical，两个 Minor 记录不改（`resolveRolePrompt` 静默跳过不存在角色；`AiPersonaService` 双构造器靠 `@Autowired` 区分） |
| 10–12 前端 | 纯函数 5 条先红后绿；`QueueTab` 重写；8 语 × 10 key。review 修 3 处：停用项保留回显禁用、生成中别行提示误标、**生成失败可见** |
| 13 离线契约 | 实做 **18 条**（要求 ≥8）：14 条线路层 + 4 条读生产源码的静态契约守卫，避免「mock 全绿、实现漂移」。新增 `test:ai` 脚本 |
| 14 真机腿 | **7/7**，`test:ai:real`。极简人设 12 字 vs 共情人设 143 字；端点不可达 40906 且 `text=null`；embedding 768 维。**端到端 HTTP 腿未跑**，见下 |
| 15 全量验证 | 五路 typecheck ✅；桌面单测 557 → **562/0**；后端 595/0；契约 18/18；真机 7/7；桌面 build ✅；admin lint ✅ / build ✅；lint 仅剩 2 个既有 error |
| 16 台账 | `feature-backlog` §一/§二之二、`feature-checklist` B28 第七段、README §六/§八、README.en §6/§8、spec 头部与 §1.3/§2.8/§3/§4 全部回填 |
| 17 评审合并 | 逐任务对照；合并回 `main` 并清理 worktree |

**唯一未闭合项**：端到端 HTTP 腿（MySQL + Spring Boot + 两个端点 + 回查四列 + 前端错误提示/来源徽标）。
本机 MySQL 在 3306，但后端未起、无 `application-local.yml`、无 DB 凭据与租户种子数据，也没有 SpringBootTest/MockMvc 测试基建，
按 spec §1.3 显式挂起并在所有交付文档标注；**不得拿真机探针或 mock 契约冒充**。
- [ ] system 段不含客户正文（提示词注入防线）
- [ ] 无流式输出；无自动触发；失败不留半截建议
- [ ] 真机腿若未跑，交付说明里**显式标注**
