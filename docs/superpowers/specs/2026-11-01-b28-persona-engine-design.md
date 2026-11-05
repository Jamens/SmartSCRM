# B28 AI 人设引擎（生成建议 · 坐席点按）

> 状态：**主体已交付**（2026-11-05 用户拍板并实施；端到端 HTTP 腿未跑，见 §1.3 / README §八） · 规格编写 2026-11-01
> 上游：`docs/superpowers/specs/2026-10-06-b28-ai-knowledge-design.md`（B28 主 spec，本 spec 补它没做完的那一段）
> 对标：`docs/feature-backlog.md` §二之二「B28 的真实缺口」

---

## 0. 目标与约束

### 0.1 为什么是这一段

B28 已经交付了六段（知识库三栏 / 文档管线 / 人设 CRUD 与模板助手 / 养号设置 / 接管台 / 向量检索 / AI 自动应答），但**"人设"至今没有真正参与过应答生成**。两处硬证据：

1. **`ai_persona_id` 是全仓最典型的"看起来有、其实没有"的字段。** V16 留了列，`ConversationVO` 透出了它，`AiReplyService` 拿它反查 `roleId` 去收窄检索范围——但**没有任何一处写入它**（`grep aiPersonaId` 只命中实体、VO、Mapper，与一句 `TakeoverService.java:23` 的注释 "persisted but not consulted"）。它现在只是"检索时的一个过滤维度"，不是"人设"。
2. **原 spec 里模型章节从来没有存在过。** `2026-10-06-b28-ai-knowledge-design.md` §5 写着「`AiPersonaController`：人设 CRUD + 生成/优化（生成调 **§6 的模型**，失败不落库）」——而该 spec 的 §6 是「**前端**」。这个悬空引用就是它至今没被实现的根因：原设计把"模型"当成了一个既成事实来引用，于是谁都没去建。

所以本 spec 要做的不是"再加一个 CRUD"，而是**让人设真的决定 AI 建议的内容**：坐席点一下，系统先按知识库检索（命中就用库里那套标准答案），**没命中才调模型按这个人设生成**。

### 0.2 硬约束（红线）

| # | 规则 | 为什么 |
|---|---|---|
| **R1** | **只产出建议，绝不自动发出** | 后端物理上没有出站通道（发送在 Electron 客户端侧）。这条继承自 B28 第四段，本 spec 不破 |
| **R2** | **端点由配置注入，默认空，不硬编码任何商业云端点** | 与 `EmbeddingClient` 同口径。`scrm.chat.base-url` 空 = 功能未启用，不是报错 |
| **R3** | **检索优先、模型兜底** | 库里有标准答案就别烧模型；模型只负责库里没有的部分 |
| **R4** | **坐席点按触发，不自动调模型** | 成本可算、延迟可控、不打爆本地端点 |
| **R5** | **失败不落库、不留半截建议** | 模型调不通就不写 `ai_suggestion`，不留"上一条建议其实是旧内容"的误导 |
| **R6** | **租户隔离**：人设 / 角色 / QA / 会话全部按 `principal.tenantId()` 收窄，绝不从 body 信任 | 仓库既有惯例，越权读别人的人设 = 泄露运营配置 |
| **R7** | **不做流式输出** | B2 的 SSE 已被裁定不做（spec `2026-09-19-translation-center-design.md:53`），不重复裁定 |

### 0.3 核心语义规则

| 规则 | 内容 |
|---|---|
| **S1 建议来源可辨** | 建议必须能区分"检索来的"与"模型生成的"。两种来源的可靠性不同，坐席必须一眼看出这是不是库里的标准答案 |
| **S2 建议可弃** | 坐席可否决建议并清空（复用现有 `dismiss-ai-suggestion`），不因模型生成过就残留 |
| **S3 人设绑定显式** | 会话与人设的绑定必须显式发生（坐席在接管台选），绝不按角色自动套用——人设是运营决策，不是技术推断 |
| **S4 未绑人设 = 无模型路径** | 没绑人设就没有"人设提示词"，此时只能走检索。按钮在未绑人设时禁用，不静默降级 |
| **S5 未配置端点 = 功能未启用** | 与 embedding 一致：返回明确状态（`available=false`），不是静默返回空 |

---

## 1. 范围

### 1.1 做

1. **`ChatClient`**：OpenAI 兼容的 chat completion 客户端（`POST {base}/v1/chat/completions`），形状照 `EmbeddingClient`（配置注入 / 默认空 / 失败抛 `BizException` 不吞）
2. **`PersonaEngine`**：组装提示词 → 调模型 → 返回草稿。**纯生成、不落库**（失败不落库这条与 B28 第四段同口径）
3. **会话 ↔ 人设绑定通路**：`PUT /api/conversations/{id}/ai-persona` 写入 `ai_persona_id`；接管台 UI 给人设下拉
4. **生成建议**：`POST /api/conversations/{id}/generate-ai-suggestion`，走"检索优先·模型兜底"，结果写 `ai_suggestion` 三列
5. **建议来源标记**：新列 `chat_conversation.ai_suggestion_source`（`retrieval` / `model`），坐席一眼看出建议出处
6. **人设助手的模型化**：`AiPersonaService.generateDraft` 增加一条"调模型生成"路径；模型未配置时**回落模板且不报错**（离线也能用）
7. **离线契约验证**：零依赖 mock OpenAI 兼容端点 + harness

### 1.2 不做

| 项 | 理由 |
|---|---|
| 每条入站自动调模型 | 用户已裁定：坐席点按触发（R4） |
| 流式输出 | R7，与 B2 的 SSE 裁定一致 |
| 多轮会话编排引擎 | B28 主 spec §1 已明确不做 |
| 模型自动发送 / 自动转人工 | R1 |
| 改造向量检索 | V51 已够用；模型路径不依赖它 |
| 模型侧多 provider 适配（Anthropic / 智谱等私有协议） | 只做 OpenAI 兼容一种。Ollama / LocalAI / vLLM / DeepSeek 兼容端都覆盖得到，YAGNI |
| 把人设做成租户级默认项 | S3：绑定是显式决策 |

### 1.3 验收

**契约腿（必做，可自动化）**

- mock OpenAI 兼容端点（零依赖，照 `test/telegram-protocol/mock-tg-gateway.mjs` 的骨架）覆盖：`/v1/models`、`/v1/chat/completions` 正常返回、401、非 2xx、超时、畸形 JSON
- 离线 harness ≥ 8 条用例，见 §2.6
- 后端 JUnit ≥ 14 条；`./mvnw test` 全绿（基线 559）
- `pnpm run test:unit` / `typecheck` 全绿（基线 557）

**真机腿（硬性条件）**

- 对着**真实本地端点**验证：① 坐席选了人设后生成，输出确实带该人设的语气特征（换个 persona 语气就变）；② 端点停掉时前端给明确错误、界面不留半截建议
- **本机状态（2026-11-06 00:45 复测）**：Ollama `0.40.14` 在 `127.0.0.1:11434`，**模型已拉齐并真机 smoke 通过**：
  `qwen2.5:3b`（1.9 GB，chat 返回正常中文回复）、`nomic-embed-text`（274 MB，`/v1/embeddings` 返回 768 维向量）。
  CLI 未进 PATH（Windows 原生安装的常见情形），命令行需用安装目录下的绝对路径，或先把该目录加进 PATH。
- **真机腿执行结果（2026-11-05）**：`apps/desktop/test/ai-persona/real-model-probe.mjs` 对本机 Ollama **7/7 通过**——
  ① 两份人设的语气确实可区分（极简人设 12 字「请告知客户具体发货时间。」vs 共情人设 143 字带致歉与后续步骤）；
  ② 端点不可达时明确失败（40906）且 `text=null`，不留半截建议；③ `/v1/embeddings` 返回 768 维。
  离线契约 harness 另跑 18/18，覆盖请求形状与 401 / 500 / 畸形 JSON / 超时 / 缺 choices 等失败收敛，并直接读生产源码做静态守卫。
- **仍缺的一条**：**端到端 HTTP 腿未跑**——需起 MySQL + Spring Boot，走 `PUT /{id}/ai-persona` → `POST /{id}/generate-ai-suggestion` → 回查 `chat_conversation` 四列，
  并验证前端错误提示与来源徽标。本机目前只有 MySQL 在 3306、后端未起、无测试用 SpringBootTest/MockMvc 基建与租户种子数据，故显式挂起。
  **不得用端点直连探针或 mock 契约冒充端到端验收**

---

## 2. 关键设计

### 2.1 整体链路

```
坐席在接管台点「按人设生成回复」
        │
        ├─ 前置：会话是否绑了人设？ ──否──→ 按钮禁用（前端拦截），不发起请求
        │
        ▼
POST /api/conversations/{id}/generate-ai-suggestion
        │
        ▼
PersonaEngine.generate(tenantId, conversationId)
        │
        ├─ ① 查会话（租户隔离）→ 查绑定人设 → 查人设所属角色
        │     人设/角色停用 → 拒绝（R6 / 显式错误）
        │
        ├─ ② 检索优先（R3）
        │     KnowledgeSearchService.search(topK=1, threshold=0.6, 角色收窄)
        │     命中 → 写建议(source=retrieval, qaId, score) → 返回，不调模型
        │
        ├─ ③ 未命中 → 模型兜底
        │     组装提示词（§2.3）→ ChatClient.complete() → 写建议(source=model) → 返回
        │
        └─ ④ 任一步失败 → 不写建议（R5）→ 抛明确业务异常 → 前端提示
```

### 2.2 为什么"坐席点按"而不是自动

- **成本可算**：模型调用次数 = 坐席点击次数，不是消息条数。自动模式下批量入站能把本地端点打爆。
- **延迟只落在该等的那一下**：本地小模型生成可能要几秒，自动模式下每个入站消息都等它；点按模式下只有坐席在等。
- **与既有语义一致**：B28 第四段的 AI 建议本就是"供坐席在接管台确认"的东西，触发权在坐席手里是自洽的。

代价：坐席要多点一次。这条代价是明摆着的，换来的是可控性。

### 2.3 提示词组装

**system 段**（三段拼接，顺序有讲究）：

1. 固定护栏：`你是客服助手。只根据已知信息回答；不确定就说不确定，不要编造。`
2. 角色提示词：`ai_role.prompt`（业务身份——"你是谁、做什么"）
3. 人设提示词：`ai_persona.prompt`（人格与语气——"怎么说话"）

顺序理由：角色定身份、人设定表达，后者更靠近生成点、影响更直接。**任一为空就跳过该段**（缺项不改，不补默认值）。

**历史段**：取该会话最近 N 条消息（N 默认 10，可配置），`direction=in` → user 角色，`direction=out` → assistant 角色，正文取 `body`（空正文的媒体消息跳过）。最后一条入站消息作为收尾的 user 输入。

**参数**：`temperature` 默认 0.3（客服场景要稳定，不要发挥）、`max_tokens` 默认 512（防模型啰嗦）。

### 2.4 会话 ↔ 人设绑定

- 接口：`PUT /api/conversations/{id}/ai-persona`，body `{ personaId: number | null }`。`null` = 解绑
- 校验：人设必须属于本租户且 `enabled=1`；不属于 → 业务异常（**不静默忽略**）
- 权限：`message:read`（读）+ `message:write`（写），沿用既有菜单码
- **不新增表**：复用 `chat_conversation.ai_persona_id` 这一列——它一直在那儿，只是没人写

### 2.5 建议来源标记（S1）

新增列 `chat_conversation.ai_suggestion_source VARCHAR(16) NULL`，取值 `retrieval` / `model`，`NULL` = 无建议或旧数据。

**为什么不复用 `ai_suggestion_qa_id` 判别**：`qa_id` 为 null 既可能是"模型生成的"，也可能是"检索没命中"或"老数据"，语义不唯一。坐席需要明确知道手上这条是不是库里那套标准答案。

Flyway **V54**，照仓库惯例走 `information_schema.COLUMNS` 守卫 + `PREPARE/EXECUTE` 幂等写法。

### 2.6 离线 harness 用例（契约腿，≥ 8 条）

| # | 用例 | 断言 |
|---|---|---|
| T1 | 未配置端点 | `available=false`；生成请求返回明确错误；**不写任何建议** |
| T2 | 检索命中 | mock 检索库有答案 → 建议 `source=retrieval` + `qaId` 非空；**模型端点零调用**（这是 R3 的证人） |
| T3 | 检索未命中 + 模型可用 | 建议 `source=model` + `qaId` 为空 + 正文等于模型返回 |
| T4 | 模型返回非 2xx | 不写建议；返回明确错误；界面无半截内容（R5） |
| T5 | 模型超时 | 同 T4（不重试——点按动作，重试权在坐席） |
| T6 | 模型返回畸形 JSON | 同 T4 |
| T7 | 会话未绑人设 | 拒绝；不调模型、不调检索（提示语要指明"先选人设"） |
| T8 | 跨租户人设 | 绑定/生成均被拒（R6） |
| T9 | 停用人设 | 生成被拒；不给"静默用通用人设" |
| T10 | 历史消息方向映射 | `in`→user、`out`→assistant；空正文消息被跳过 |

### 2.7 配置形状（照 `EmbeddingClient`）

```yaml
scrm:
  chat:
    base-url: ${SCRM_CHAT_BASE_URL:}     # 空 = 未启用
    model:    ${SCRM_CHAT_MODEL:}        # 空 = 未启用（不猜默认模型）
    api-key:  ${SCRM_CHAT_API_KEY:}      # 空 = 不发 Authorization 头
    timeout-ms: ${SCRM_CHAT_TIMEOUT_MS:30000}
    max-tokens: ${SCRM_CHAT_MAX_TOKENS:512}
    temperature: ${SCRM_CHAT_TEMPERATURE:0.3}
```

**`model` 默认为空**（与 embedding 的 `nomic-embed-text` 默认值不同）：embedding 猜错模型只是向量质量差，chat 猜错模型直接是"这个模型不存在"的失败。宁可不启用。

**本地 Ollama 开通示例**（端点值一律走环境变量注入，仓库不写死；CLI 未进 PATH 时用安装目录下的 `ollama.exe` 绝对路径）：

```bash
# 1) 拉模型：一个中文 chat 模型 + V51 检索腿要用的 embedding 模型
ollama pull qwen2.5:3b          # 约 2 GB，中文够用；机器内存宽裕可换 7b
ollama pull nomic-embed-text    # 约 270 MB

# 2) 启动后端前注入（base-url 不带 /v1，客户端自己拼）
export SCRM_CHAT_BASE_URL=http://127.0.0.1:11434
export SCRM_CHAT_MODEL=qwen2.5:3b
export SCRM_EMBEDDING_BASE_URL=http://127.0.0.1:11434   # model 已有默认值 nomic-embed-text
```

`SCRM_CHAT_API_KEY` 留空即可，Ollama 本地端不需要鉴权，客户端不会发 `Authorization` 头。

### 2.8 前端

接管台队列项（`AiWorkspacePage.tsx` 的 `QueueTab`）每行增加：

- **人设下拉**：选项来自 `useAiPersonas()`；变化即调 `PUT /ai-persona`；当前绑定回显
- **「生成回复建议」按钮**：未绑人设时 `disabled` + tooltip 说明原因；点击后调 `POST /generate-ai-suggestion`
  - **按钮文案不承诺"人设"**：按 R3，检索命中时返回的是库里的标准答案，**不是人设生成的**。按钮若叫「按人设生成回复」会与实际行为不符。真正的"人设"体现在来源徽标上——`model` 徽标 = 这条是人设生成的
  - 徽标：两个色，`knowledge`（检索来的）/ `model`（模型生成的），坐席一眼能看出手上这条是不是库里那套标准答案（S1）
- **建议展示**：接管台目前只列队列项、不展示 `aiSuggestion`。加一行建议正文 + 来源徽标 + 沿用现有"采纳/否决"动作
- **失败可见**：生成 / 绑定失败时在队列顶部给明确错误（优先显示后端错误文案），界面不留"看起来像成功"的静默状态；后端失败不写库，前端只在 `onSuccess` 刷新队列
- **下拉回显**：停用的人设仍作为 `disabled` 选项保留，避免已绑定但被停用的项出现空 value；加载失败只提示、不阻断接管 / 恢复 AI

i18n：8 个语言包补 10 个 key（zh-CN / en 人工文案，其余 6 语本地化短文案）。

---

## 3. 风险

| # | 风险 | 应对 |
|---|---|---|
| 1 | **模型输出质量不可控**（人设 prompt 写得差 → 输出差） | 模型已拉齐并 smoke 通过，环境不再是风险。质量本身是产品问题不是技术问题：v1 不做自动评估；坐席可否决 + 建议带来源标记，人能判断 |
| 2 | **坐席角色可能没有 `knowledge:read`**，人设下拉拉不到 | 下拉加载失败只给一行提示，不阻断接管 / 恢复 AI；绑定端点只用 `message:write` |
| 3 | **提示词注入**（客户在正文里写"忽略以上指令"） | 历史消息作为 user 角色而非 system；system 段只含护栏+角色+人设，不含客户正文。加一条护栏句明确边界 |
| 4 | **本地模型慢**（几秒） | 点按触发 + 30s 超时上限 + 不自动重试；前端按钮 loading 态 |
| 5 | **人设/角色被停用后建议失效** | 生成时实时校验 `enabled`，停用即拒绝；已有的历史建议保留（坐席还能看） |
| 6 | **重复劳动**：`AiPersonaService.generateDraft` 的模板助手与新引擎并存 | 保留模板助手作为"模型未配置时的回落"，不删——离线环境仍有价值。两条路径的产出会标来源 |
| 7 | **原 spec 悬空引用的教训**（§0.1） | 本 spec 的每个引用都指向真实存在的文件/章节；实施时若发现文档与代码不符，以代码为准并回来改文档 |

---

## 4. 未决问题

| # | 问题 | 倾向 | 阻塞? |
|---|---|---|---|
| Q1 | 模型生成的建议，`ai_suggestion_score` 留空还是给个固定值？ | 留空——分数是检索的相似度，模型生成没有相似度可言，填个假分数会污染语义 | 否 |
| Q2 | 历史消息条数 N 是否做成租户可配？ | v1 固定 10（配置项 `scrm.chat.history-size`），不做租户级设置——多一个设置项就多一处口径漂移 | 否 |
| Q3 | 坐席能否在生成后编辑建议再发送？ | v1 不做。现有流程是坐席自己看建议、自己打字发送（发送在 Electron 侧）。编辑属于接管台 UI 的另一件事 | 否 |
| Q4 | 真机验收用哪个模型？ | 已定：本机 Ollama + `qwen2.5:3b`（1.9 GB，中文语气可辨、CPU 跑得动）+ `nomic-embed-text`（768 维）。真机探针用两份人设验证语气变化；规格不绑定具体模型，换 7b 或别的模型不影响设计 | 否（已解除） |
| Q5 | **要不要一个"强制走模型"的按钮？**（检索命中时，坐席可能就想看人设的效果） | 倾向 v1 不做。按钮只叫「生成回复建议」，靠来源徽标告知来源；真要人设效果，等真机腿验证后看坐席反馈再定。**但这条不阻塞开工** | 否 |

---

## 5. 交付物清单

**后端**
- `service/ai/ChatClient.java`（新）
- `service/ai/PersonaEngine.java`（新）
- `service/AiPersonaService.java`（改：生成路径加模型分支）
- `web/ConversationController.java`（改：两个新端点）
- `web/vo/ConversationVO.java`（改：加 `aiSuggestionSource`）
- `entity/ChatConversation.java`（改：加字段）
- `resources/db/migration/V54__ai_suggestion_source.sql`（新）

**前端**
- `api/aiKnowledge.ts`（改：两个新 hook）
- `pages/AiWorkspacePage.tsx`（改：接管台人设下拉 + 生成按钮 + 建议展示）
- `i18n/locales/*.ts`（改：8 语）

**测试**
- `service/ai/ChatClientTest.java`（新，纯单测，不起 Spring）
- `service/ai/PersonaEngineTest.java`（新）
- `test/ai-persona/`（新：mock 端点 + harness + runner）
- `apps/desktop/package.json`：加 `test:ai` 脚本
