# 待办功能清单（backlog）

**重写** 2026-10-07 · **复核修订** 2026-10-13（第二节：B2 移出「真缺口」，新增「二之二」记录 B28 曾被误判为已交付）· **对标补充** 2026-11-05（新增「二之四」11 项核验过的真缺口 + 「5.3」核销 6 项误判缺口）· **来源** `docs/feature-checklist.md`（阶段与范围的唯一权威；本表只答「还剩什么」，两项冲突时以清单为准）

## 为什么要重写

上一版按「32 项待办」组织，但**其中 18 项早已交付且从未回填**——它自己列的「已交付」只有 14 项，中间那 18 项既不在待办也不在已交付里。照它排期，会把已经跑在生产代码里的 B8 / B18 / B19 / B21 / B25 / B26 / B27 / B28 全部重做一遍。

所以改成三档：**已交付 / 真缺口 / 外部阻塞**。另有两类不计入三档的说明（验证闸、本版明确不做）单独列在第五节，不与「真缺口」混为一谈。

---

## 一、已交付（不再进队列）

**A1–A19（19 行）+ B1–B29（29 行）共 48 行，没有一行是「未开工」。** 逐项交付证据与 commit 见 `docs/feature-checklist.md`，本表不重复。

| 档 | 状态 |
|---|---|
| A1–A19 壳层 / 基础框架 | 全交付。其中 **A6 / A10 / A16** 标 🟡 部分，残留项见第五节，**不是功能缺口** |
| B1–B29 业务模块 | 全交付。其中 **B6** 标 🟡 部分（交付闸 18/20），残留项见第五节，**不是功能缺口** |

已交付、但历史上被误判成「没做」过的几项，重点记一下：

- **B27** 协议号通道 —— 入站 + 出站腿均已接线，离线联调 harness 6/6 通过。卡的是自托管网关真机联调（第三节），不是代码
- **B28** AI 知识库 —— 三栏 + 文档管线 + 人设助手 + 养号 + 接管队列 + 规则引擎，前后端全闭环。**2026-10-13 补第五/六段**：向量检索（V51）+ AI 自动应答（V52）。但**人设引擎本身仍空**，见「二之二」
- **B22** 部门三字段 / 子账号端口上限 / 重置密码 —— 补章时确认真实缺失，已于 `fc2b07d` 补齐
- **B7** 批量群发 —— 已交付（`BatchSendService` + `BatchSendController` + `BatchSendServiceTest` 都在）。只差真发/真撤回各 1 次的**验证**（第三节）

---

## 二、真缺口（可开工，代码里确实没有）

**2026-10-13 复核后剩 1 项。** 另有一项当天补上，故数量从 2 降到 1。

| # | 项 | 清单依据 | 核验证据 | 量级 |
|---|---|---|---|---|
| 1 | **B12 钱包余额卡** | checklist 第 172 行「开工时应补」明列 | 全仓搜 `wallet\|balance\|余额`：仅命中 lucide 的 `Wallet` 图标名与 WA 账号后缀 `s.wallet`，**无任何钱包 / 余额数据模型或卡片**。`entity/Tenant.java` 实测只有 5 个 INT 配额列，无金额字段；V48 加的是配额不是钱 | 小 |

**B12 那一项有个陷阱**：B12 的另一半「资源用量卡」已随 B24 交付（首页用量统计卡），所以 B12 行看起来是 ✅，但**钱包余额卡这一半从未开工**。`tenant` 表无 `wallet_balance` 类字段，真要做得先加列 + 迁移（按仓库惯例走 `information_schema.COLUMNS` 守卫 + PREPARE/EXECUTE）。

---

## 二之二、当天补上的：B28 的真实缺口（2026-10-13 记录）

**这一节是复核发现，比原第二节更值得读。**

本表上一版说「真缺口只有 2 项」，复核后确认：那 2 项属实，**但漏了更关键的一项**——**checklist 把 B28「AI 知识库」标为已交付，实际只有数据层，没有大脑**：

- 后端**零模型调用**：`grep -i "openai|chat/completions|deepseek|qwen|hunyuan|dashscope|anthropic"` 在 server 侧**零命中**
- `AiPersonaService` 自述「助手**不调外部模型**，按语气标签套内置模板产草稿」= 3 个硬编码模板
- `KnowledgeQaService` 当时只有 list/create/update/delete，**无任何检索方法**——知识库存得进、检索不出
- `TakeoverService` 自述 `ai_persona_id` 是 forward hook，**not consulted by any logic yet**

**当天已补**（V51 向量检索 + V52 AI 自动应答，详见 checklist 的 B28 第五/六段）。**当前仍空**：AI 人设引擎（`ai_persona_id` 这个 hook 至今没被消费，现有 AI 走的是知识库检索，两者不是一回事——人设引擎 = 调模型按角色提示词生成，检索 = 从已有 QA 里找）。

> 教训记在这里，别再犯：台账标 ✅ 之前应 grep 一次实际能力，不只看表结构和 CRUD 有没有。本表上一版就是这么废掉的。

---

## 二之三、B2 翻译 SSE 的性质（补记）

原第二节列 B2「流式翻译 SSE」为真缺口，复核确认它**确实不存在**，但性质与 B12 不同：**它是当初主动裁掉的，不是漏做**。`docs/superpowers/specs/2026-09-19-translation-center-design.md:53` 明写「流式（SSE）输入预览：本地引擎即时返回，改为单次请求 + 300ms 防抖」。要重开需先推翻这条裁定，故不与 B12 并列为「可开工」。

---

## 二之四、对标后新增的真缺口（2026-11-05 核验）

这一节是 2026-11-05 做横向对标时逐项 grep 出来的缺口，**每条都附核验证据**。
和第二节的区别：第二节是台账复核时发现的，这一节是对标时发现的——**对标材料里有六项
被列成「别人领先、我们没有」，grep 之后发现我们早已交付**（见 5.3）。
所以这一节只收**核验过、代码里确实没有**的。

| # | 项 | 核验证据 | 量级 |
|---|---|---|---|
| 2 | **剧本包导入导出（xlsx 三件套）** | 全仓 `剧本包\|scriptPackage\|manifest.json` **零命中**。现有 `script_role` / `script_playbook` / `script_playbook_step` 三层只能靠 UI 手敲，无批量入口。导出侧只有群成员那一条 `groupCollect/export.ts`（ExcelJS 14 列），**剧本域没有任何 Excel 依赖** | 中 |
| 3 | **敏感词按账号分组生效** | `V22__sensitive_word.sql` 只有 `tenant_id / word / category / enabled`，`category` 注释明写「不参与命中」。无账号分组维度，也无 group_id 外键 | 中 |
| 4 | **AI 阶梯养号（按天分阶段 + 模型生成对话）** | `AiNurtureSetting` 有 `tone / template / daily_limit / active_ratio / quiet_hours`，但**没有「阶梯」结构**（无 day 级动作表）；`AiPersonaService` 类注释白纸黑字「助手**不调外部模型**……按语气标签套内置模板产草稿」。`NurturePlan` 有 `at_points / speaking_rounds`，但那是**一天内**的时间点分布，不是跨天阶梯 | 中 |
| 5 | **知识库团队 / 个人分层** | `V26__ai_knowledge_core.sql` 的 `knowledge_qa` 无 `scope` / `owner_account_id` 列，只有 `role_id / category_id`。检索侧 `KnowledgeSearchService` 按租户 + 角色 + 分类召回，没有归属人维度 | 小 |
| 6 | **群链接（invite link）入群 + 入群时间** | `V32__group_ops.sql` 的 `group_join_item` 有 `invite_code` 和 `group_name`（预览回填），**无 `group_link`、无 `joined_at`**。当前只能凭邀请码入群 | 小 |
| 7 | **协议号消息回执独立落库** | 全仓无 `protocol_message_receipt` 一类表。B27 的入站/出站腿都通了，但回执状态无处存，只在采集批次里带过 | 小 |
| 8 | **协议号原生 UI（账号页 + 会话页）** | `apps/desktop/src/renderer/src/pages/` 28 个页面里**没有协议号账号页、也没有协议号会话页**；B27 目前只有后台链路 + `useProtocolSync` 钩子，**没有人工可点的界面** | 中 |
| 9 | **会话分组（会话文件夹）** | 无会话分组表。`chat_group` 是群注册表不是分组；`cloud_account_group` 是云账号池分组，也不是 | 小 |
| 10 | **指纹补 domRect + webgpu 两类 hook** | `fingerprint/tasks/` 只有 7 个：audio / canvas / font / iframe / mediaDevices / navigator / webgl（timezone 走 CDP `Emulation.setTimezoneOverride`，不在 tasks 里）。**缺 domRect 与 webgpu** | 小 |
| 11 | **发送后自检 + 自动撤回** | `batchSend/sensitiveGate.ts` 是**发送前**拦截（命中就不发）；`batch:recall` 是**人工/批次触发的**撤回。缺「发出去之后回读校验、命中就自动撤回」这一段 | 小 |
| 12 | **账号级陌生人配额 / 群发扣活跃度** | `tenant` 侧只有 `seat_limit` / `ai_token_limit` / `translation_char_limit`（V15 / V48），**没有账号级的「每日陌生人上限」「群发超量扣活跃度」** | 小 |

---

## 三、外部阻塞（排期无用，等外部条件）

| 阻塞 | 卡住了什么 | 解除条件 |
|---|---|---|
| **TG 链 12a–12d**（真机 DOM 探针 → 选择器 → 采集 → 发送） | TG 的采集 / 发送 / 翻译回归 | 需一次 TG 扫码登录 + 真机 DOM 快照，**本机无 TG 账号**，且官方站 `/k/` 的选择器是否真命中仍未实测 |
| **B27 出站腿真机联调** | 协议号的真实发送与撤回 | 外部 protocol 服务可用（`protocolUrl` / `protocolWsUrl`）+ 测试号。**开源红线**：代码只留 env 注入口，不得默认外连商业云 |
| **B7 真发 / 真撤回各 1 次** | 群发那两格「待验证」 | 需用户在场并明确放行（spec §9 那一档）。目前全部自动化腿跑的是 `dryRun=1` |
| **B5 发送链的第三方回执** | 「已验收」只到自聊口径 | 需用户点头才能往真人会话发（守「不往真人会话发」，自聊不产生真 ack） |

---

## 四、备注

- 本表是**待办**，不是阶段计划。阶段与范围的唯一权威是 `docs/feature-checklist.md`。
- 「真缺口」不等于「随手可做」：钱包余额卡虽小，但要动 `tenant` 表结构（加列 + Flyway 迁移），按仓库惯例得走幂等迁移那套（`information_schema.COLUMNS` 守卫 + PREPARE/EXECUTE）。
- **开工前先出 spec**：本项目约定 spec → 计划 → 实施，出设计文档是开工的一部分，不是拖延。上一版满表的「需 spec」不是「不做」，而是「还没写设计」。
- **每交付一个功能，记得回填本表**——本表上一版就是这么废掉的：交付时没回来改，待办区越堆越长，最后跟代码完全脱节。

---

## 五、不计入三档的两类说明

### 5.1 验证闸（功能在，闸没全开）

这两项**不是功能缺口**，是「代码写完了但验收没全绿」，别当新功能重开：

| 项 | 现状 | 性质 |
|---|---|---|
| **B6 的 5c CDP 界面腿 20 条** | 已实跑 **18/20**（2026-10-05）。L3 归 16（本机 CDP 的「坐标→命中」层退化：`elementFromPoint` 对任何视口坐标都只回 `<html class="dark">`，连 `(10,10)` 都是），L20 属 `spawnSync` 对任何子进程都 `EBUSY`。台账 `docs/notes/2026-10-05-b6-5c-ui-leg.md` | **本机环境限制，非代码缺陷**。B6 的「可用」以 5c 完成为准，故台账仍标 🟡 |
| **打包态已全链路跑通**（含 electron-builder），仅剩安装/签名/auto-update 下载三项 | 2026-10-07 实测推翻旧推断：`file://` 页面的跨源请求**不带 `Origin` 头也不发预检**（服务器只见 `Sec-Fetch-Site: cross-site`），`DefaultCorsProcessor` 因 `requestOrigin == null` 跳过；同一探针在 `http://` 下会被拦，证明探针有效。另排除：产物资源路径是 `./assets/…`（相对路径，不必配 `base`）。**登录链路端到端**（真实库数据：账号 4/共8、客户 6、群发 78、LINE 2/3）。**electron-builder 分发链路**：`build:unpack` 出 202MB exe，`file:///.../app.asar/out/renderer/index.html` 证明 **asar 内 `__dirname` 解析成立**；`build:win` 出 NSIS 安装包 97MB（有效 PE）+ `.blockmap` + `latest.yml`（A6 更新元数据侧一并验证到）。**顺带修一个真 bug**：`electron-builder.yml` 三处 `artifactName` 用 `${name}`，而包名带作用域（`@smartscrm/desktop`）→ `/` 被当路径分隔符 → 输出到不存在的 `dist\@smartscrm\` → makensis `Can't open output file` 退出 1；已全改 `${productName}`。`CorsOriginTest` 固化「回环放行 / 外部拒绝」两条真规则 | **余下三项需用户在场**：① 真执行安装（写 Program Files / 建快捷方式 / 注册卸载器）；② 代码签名（无证书，当前产物未签名）；③ auto-update 下载与替换（需部署方自托管更新源，`publish.url` 仍是 example.com 占位，符合开源红线） |

### 5.2 本版明确不做（裁定，非遗漏）

| 项 | 理由 |
|---|---|
| **A6 自动安装 / 替换 exe** | 检查 + 通知 + 下载到本地均已交付，只差自动安装。核验：全仓无 `quitAndInstall` / `autoUpdater`。Windows 替换正在运行的程序有坑，主动留后续 |
| **B7 v2 随机 Emoji / 话术干扰** | v1 明确只到纯文本；这是抗风控手段，不在 v1 范围内 |
| **每日养号计划 runner** | 不属 B9（本地互聊）也不属 B10（云手机），形态依赖云端下发。**属形态裁定，不是实现问题**，裁定前不占阶段、不给编号 |

### 5.3 对标时核销的六项（2026-11-05，别再做一遍）

做横向对标时，外部材料把这六项列成「竞品领先、我们没有」。**逐项 grep 之后，我们早已交付**——
记录在此，免得下次又被当成缺口重开一遍：

| 曾被说成缺口 | 实际状态（核验证据） |
|---|---|
| 群成员进出群事件追踪 | `V12__group_member_analysis.sql` 有 `group_member_event`（`event_type` = added/joined/left/removed/promoted/demoted，带 `actor_key` / `target` / `dedup_key`）+ `group_member_state`（`is_in_group` / `latest_join_at` / `latest_leave_at` / `exit_method` / `join_count`）。`GroupMemberService` 有完整写入链 |
| 定时调度 + 随机间隔 | `V29__script_engine_core.sql` 的 `script_task.next_run_at` + `idx_st_due` 索引 + `heartbeat_at`；`ScriptSchedulerService` / `ScriptSchedulerDriver` / `NurtureSchedulerDriver` 三套驱动；随机间隔 + 抖动在 `NurturePlan.interval_min_sec/interval_max_sec/jitter_pct` 与 `group_join_task` 同款，且 `shared/groupOps.ts` 用「种子 + 线性同余」保证可复现 |
| 客户自定义人群（标签 + 关键词） | `AudienceService` 已实现 `keyword` + `tagIds` 两条件 AND，`AudiencesPage` 有界面，`customer_audience` 表在库里 |
| 存储管理 + 性能监控 | `StorageCard.tsx` 有存储用量卡；`SettingsPage.tsx:374` 有主进程运行时指标 3s 轮询 |
| 对话内独立翻译设置 | `V9__conversation_setting_scope_key.sql` 已做会话级 scope key；`TranslationSetting` / `TranslationMediaController` 支持图片 OCR + 语音 ASR |
| 按钮消息字数约束 | `MaterialButtons.requireValid` 已按 wa-js 4.6.0 真实规则校验（1–3 个按钮、按钮文字 ≤20 字、reply 按钮不可与 url/call 混用） |

---

## 六、本次重写发现的台账漂移

顺手记一下，免得下次又照着错的地方排期：

1. ~~**`feature-checklist.md` 的 B7 / B6 行阶段列仍是裸 `P7` / `P8`**，没标 ✅~~ —— **已修（2026-10-08）**：两行都补成 🟡 并写明残留各是什么（B7 是 `dryRun=1` 那道验收闸，真发/真撤回各 1 次需用户在场；B6 是 5c 那 2 条红的本机环境归因）。顺带把 B17 **P3** 补进 `README.md` §8（`1fa6406` V20 数据模型 + `faa89f2` 快捷回复可空 + `9346c36` 素材页接按钮三笔此前都没入账）。`README.en.md` §8 是摘要级、没有逐腿条目，故不镜像这条。
2. ~~**`DashboardPage.tsx` 的「群发任务」卡片用了 lucide 的 `Wallet` 图标**，八竿子打不着，估计是复制粘贴残留。不影响功能，一眼能看出来。~~ —— **已修（2026-10-08，`12398a1`）**：改 `Megaphone`，与侧栏 `/broadcast` 的导航图标同源。
3. A16 有一处**有意例外**：`MessageController` 的 `/batch` 消息入库不按菜单码判定（2026-10-06 裁定）—— 它是机器对机器的采集口，不是人在 UI 的操作。**这是裁定不是缺口**，别「修」。
4. **（2026-10-13 新增）本表第二节曾把 B28 记为「已交付、无缺口」，是错的** —— 详见新增的「二之二」节。同类风险：台账里凡是标 ✅ 的 AI 类能力，都应 grep 一次是否真有模型调用，而不只看表结构与 CRUD。