# P6 聊天记录 · 端到端验收结论

日期：2026-09-25 · 关联：`docs/superpowers/specs/2026-09-20-chat-history-design.md` §8/§12 · 计划：`docs/superpowers/plans/2026-09-20-chat-history.md` Task 19

> 本文只记本项目的实测口径。所有驱动在 `tmp/`（gitignore，不入库），断言均为当场真跑的数，未跑的行如实标 blocked / n/a，不合并成"全绿"。

## 总体结论（不是"全部通过"）

Task 19 的 Step 1–6 里，**采集链、发送链、记录页组合全链、P5 回归、后端契约与机械闸门**都在真实登录态或真库上跑到了各自的区分性断言并绿。三处**未验证**如实保留，都不是本轮疏漏：

- **Telegram 真实站点**：A/B 两档皆未验证。A 档依赖 Task 12a 的真机 DOM 快照，而 12a 需一次 TG 扫码登录、本机无账号 → 快照从未产出 → `tg-fixture.html` 与其 A 档驱动从未存在；B 档前置是用户扫码。故"TG 采集/发送链本阶段未验证"，且**没有假装复跑一个不存在的驱动**。
- **手机侧物理并发的 backfill×live 严格版**：本轮用"页内原生发（live 事件流）＋同刻点『同步历史』（backfill）"制造同键并发去重，绿；"一边点同步历史一边用手机真发"这一更严格形态属用户的的手，未开火。
- **第三方真发 / 真第三方设备回执（⏱→✓→✓✓ 整链）**：自聊不产生真 ack；守 C4 不往真人会话发，未开火，等用户单独点头。

## 前置分母（Step 1，`tmp/p19-prereq.mjs` 只读记录）

| 项 | 起点值 | 末值（本轮结束实测） |
|---|---|---|
| `/api/health` | `code:0` | — |
| 真实登录态 | `window.scrm.msg.bridges()` 有 `{platform:'whatsapp', ready:true}` | 同（WA 会话持久化，无需重扫码） |
| customers | 5（ids 1–5） | 5（ids 1–5，种子原封） |
| label-groups / audiences | 2 / 2 | 2 / 2 |
| material-groups / materials | 3 / 4 | 3 / 4 |
| quick-reply-groups / quick-replies | 3 / 3 | 3 / 3 |
| 账号7 `stats.total` | days=7/30 → 193 / 193 | days=30 → **213**（append-only 测试行累积，见下） |
| 账号7 会话数 | 记录页左列 | **37** 条 records |
| 自聊 chatKey | `261963795943523@lid` | 同 |

`stats.total` 从 193 涨到 213，全是本轮契约脚本（`p6b-anchor`/`p6b-bob-*` 等夹具行）+ 采集/发送 live 行的 append-only 累积：`chat_message` **无删除端点**，WhatsApp 侧删了库行仍在（已知限制 1）。七张种子表全程 **5/2/2/3/4/3/3 一字未动**，C4 未破坏。

## 逐步实测

### Step 2 · 采集链端到端（`tmp/p6g-e2e.mjs`，exit 0，断言失败 0）

分母：账号7 `stats.total(30d)`=209；自聊 56 条/56 唯一键/`source=[app_send,backfill,native_send]`；桥 ready；页内 uid `8613226651570@c.us`。

| 行 | 操作 | 实测 | 判定 |
|---|---|---|---|
| 1 | 记录页左列真点「同步历史」 | 提示=「补底已开始，消息到一条刷一条」（命令经 IPC 下到主进程且桥接住）；渲染层 batch POST **0 次**（补底不经 HTTP，上报由主进程做）；`stats` delta=0 | PASS（热库该段已同步齐，"跑了但没新行"由行2分辨） |
| 2 | 隔 3s 再点一次 | 同样桥接住；delta=0（重复被 `uk_msg`+`INSERT IGNORE` 挡回不涨行）；自聊 56/56 唯一 | PASS |
| 3 | 原生 WhatsApp 侧 `WPP.chat.sendTextMessage` 发 `P6E-native-*` | 20s 内进 `chat_message` 且 `source==='native_send'`（双入口"原生"这一口接得住、归属判定正确） | PASS |
| 4 | 同一 chatKey 混两种来源 | 自聊 `source` 含 app_send(18)+native_send(21)+backfill，混来源仍 57 键/0 重复 | PASS |
| — | 清理 | 删 WhatsApp 侧挪到强制 reload 之前（reload 后 `getMessages` 持续抛 `reading 'chat'`，实测 40s 回不来）；`deleteMessage sendMsgResult=OK`、45s 内消失=true、页内不留 P6E | PASS |
| 5 | 内嵌页 `webContents.reload` → 桥重挂 | 重新 ready、delta=0、57/57 唯一（重挂自动补底**不重**）；行3 native 那条重挂后仍只 1 条；reload 前已有键 reload 后一个没少（**不漏**） | PASS（spec §12 不重不漏） |
| 6 | dev 终端 `msgs=` 与 stats 增量对照 | 本仓库无 mysql CLI，库内真值由后端 stats 端点给；stats 增量 +1 可报 | 口径如实（不声称直查了库） |

C4 收口：total 209→210（+1 即 native 那条 DB 行，WhatsApp 侧已删但 append-only 留库）。

### Step 3 · 发送链端到端（`tmp/p6g-send.mjs`，exit 0，断言失败 0）

分母：七计数 5/2/2/3/4/3/3；`stats.total`=203；自聊。

| 行 | 操作 | 实测 | 判定 |
|---|---|---|---|
| 1 | 回复框真键盘敲 `P6E-send-*` + Enter | 立即出现 `data-msg-key` 以 `~` 开头的乐观气泡（`status:'pending'`） | PASS |
| 2 | 轮询消息列表，最长 3s | 3s 内 `msg_key===回执 msgKey`、`source==='app_send'`、`send_local_id` 等于那个 localId（兜住 Task 12 Step 6 的"补写行 vs 事件流"取舍）；`msg_key===data-msg-key`、库 body 与气泡一致 | PASS |
| 3 | 等 ack 帧（15b 行1–4） | ⏱→✓✓ 同节点、只升不降；5 种坏形状全拒；`POST /api/messages/status` 调用 ≥1 | PASS |
| 4 | 手机侧确认已读 | 自聊不产生真第三方设备回执，停在能推进到的最高档 | **blocked（B档，不声称看到了没看到的）** |
| 5 | 清理：自聊逐条删 `P6E-*` | 2 条 `WPP.deleteMessage` 逐条删且 3.3s 内页内消失；无残留草稿 | PASS |
| 6 | 同会话连发两条（不同 localId，<1s） | 两个乐观气泡同存、两份回执各自配平、一条失败不拖累另一条（〈硬缝第1条〉SendRegistry 按 localId 而非 chatKey 登记的现场证据） | PASS |
| — | 失败注入：无桥账号 2 | 页内零副作用、库零增量、`BRIDGE_OFFLINE` 回执不抛错 | PASS |
| — | 中文拦截 / Shift+Enter | 拦截时 0 translate/尾巴不增/库不增/草稿留存；Shift+Enter 不发 | PASS |
| 8 | （兼 P5 回归）翻译中心开关翻转 | 落库 + refetch 不回弹 + 内嵌页收 `update-translation-flags` 且 revision 2→3 递增 | PASS |

C4 收口（行10）：自聊 messages 219→221 恰好=真发 2；conversations 30→30；账号2 `[1,3,0]` 不变；仅 PUT 设置/POST 译文/POST 清未读三类写；**全局翻译设置逐字段复位 diff:[]**。

### Step 4 · 记录页与外围全链（含三条组合行）

**行 4（后端契约脚本 + 单测 + typecheck）** 见下方「机械验证数字」。五份契约里两条未"原样绿"，经根因直查均为**环境/档位**、非回归、不动 shipped code：

- `p6b-query 16/17`：唯一红 `#1` 的"TG 账号会话列表为空"子条 —— TG 账号(id=2, platformType=4)确有一条 `{chatKey:"990000001", platform:"telegram"}`（Task 15 驱动经 HTTP batch 种的合法 TG 行，platform 正确无 WA 泄漏），脚本基线写死 `length===0`（早于任何 TG 数据）。**过滤本身正确**，是驱动基线随活库漂移；未去放宽它（放宽=藏红）。
- `p6b-scope-contract 9/10`：唯一红 `#4`（"真走百度、译文不含中文"）—— 当前全局 `channel=1` 走**离线模拟引擎**（`CHANNEL_TO_PROVIDER` 只有 `"5"→baidu`/`"7"→tencent`），结构上不可能产出"无中文"译文，属**在线百度专属断言、档位 n/a**；其 P6 半条（客户覆盖解析 `to="vi" degraded=false`）在 channel=1 即绿。在线整条改由 `tmp/p24-online-baidu.mjs` 在 channel=5 单独证绿（`degraded=false` / 译文不含中文），**两档分开写、不合并成 10/10**。

**行 1（补底 × live 同时来去重）** 与 **行 2（陌生→建客户→立刻搜正文→只看当前客户）** 由 `tmp/p6g-row12.mjs` 跑通（exit 0，断言失败 0）：

| 行 | 关键实测 | 判定 |
|---|---|---|
| 1 | 右栏按 `[data-p6-thread]` 会话 id 确认打开的是自聊（157=157，不靠行内文本——自聊标题被 WhatsApp 解析名覆盖）；页内原生发一条 `P6G-race-*`（`source=native_send`）+ 同刻真点「同步历史」→ 提示「补底已开始」；该 msgKey 在 `chat_message` **只 1 行**；自聊 **60 条/60 唯一**；尾巴里该键 **[data-msg-key] 只 1 颗气泡**、整段 31/31 唯一非空；WhatsApp 页内删该条（删1/消失=true），DB 行 append-only 保留 | PASS（库侧 `uk_msg`+`INSERT IGNORE` 与渲染层 `mergeTail` 并发下各只留一份） |
| 2 | 选一条 customer-less 有正文的**合成**噪声会话（绝不碰真实业务会话）；前置其正文行 customerId 全 null；建客户 newId + `link-customer` → **messagesLinked≥1**（回填了正文行、非只改会话头）；**立刻**搜正文，命中本会话行 `customerId` **已=新 id**（回填与搜索读同一份归属、无缓存死角）；UI 选中→「全局搜索」出命中→「只看当前客户」`disabled:false`→点→`aria-pressed=true`→筛出命中全部属本会话；DELETE newId 还原 customers=5 | PASS |
| 3 | TG 两档 | **A 档 n/a（前置 12a 快照从未发生，驱动从未存在）；B 档 blocked（真实站点未验证）** |

行 2 收尾留下一条真实限制现场：目标会话的 `customer_id` 仍指向已删的 newId（无「反关联」端点）——即已知限制 2。

### Step 5 · P5 回归（P6 动过 P5 的三处 + 两个 P5e 修复现场，全 exit 0）

| 行 | 断言 | 实测 | 判定 |
|---|---|---|---|
| 1 | 翻译中心开关不回弹 / 推送带递增 revision / 内嵌页收 flags | 由 Step 3 行8 覆盖（revision 2→3 递增、refetch 不回弹） | PASS |
| 2 | 试译仍按全局语向（`tmp/p5r-trial.mjs`） | 带 `customerId` 译→`toLangCode===覆盖值`；**不带**→`===全局 receiveToLang` 且≠覆盖（钉开"试译确实不落某客户"）；`type:send`→全局 sendToLang；收尾删覆盖 + 全局逐字段 diff:[] + 七种子不变 | PASS |
| 3 | `LangSelect` 提取回归（`tmp/p5r-langselect.mjs`） | 冷挂载 reload 破 draft 一次性锁→前提"自动检测"可信；源下拉 109 条含「自动检测」→radix typeahead 选「英语」落 en、再选「自动检测」回落 `''`，fetch 记录器捕获真发的 `PUT body={"receiveFromLang":""}`（分辨"改了显示"与"发了空串落库"）；目标下拉渠道1=108 vs 渠道2(DeepL)=32 且点渠道按钮 channel 真落 2 | PASS |
| + | P5e #66 修复现场（`tmp/p5s-replace.mjs`） | 前提门槛 `{inj,vis:visible,sendEnabled,previewEnabled}` 先立住；四条候选三条被模拟词典原样返回、唯一"译文≠原文"作可分辨样本；真点「用译文替换输入框」→composer==**整串译文**（len 12，非首字符）、1.5s 不回滚；收尾 diff:[] + 种子不变 | PASS |

### Step 6 · 全量机械验证（夜间已跑，未重启 :8180）

- `./mvnw test` → **Tests run: 52, Failures: 0, Errors: 0 / BUILD SUCCESS**（30 基线 + 22 P6，正中计划目标）。
- `pnpm test:unit` → **135 pass / 0 fail**（计划 `# pass 103` 是 C14 推演值，135 是其超集，绿）。
- `pnpm typecheck` → 四段（node/web/inject/unit）无输出，绿。
- `build:bridge` → `msg-bridge.bundle.js`(7.0kb) + `wa-js.bundle.js`(518kb) 都在。
- `pnpm build` → `out/` main+preload+renderer 2137 modules success。
- `grep -c 'CREATE TABLE' V8__chat_history.sql` → **2**（〈硬缝第2条〉"P6 不预建聚合表"成立；第三张表出现即为违约）。

### 本轮真实并发数（自聊删掉的测试消息）

- Step 2：1 条 `P6E-native-*`（WhatsApp 侧已删，DB append-only 留）。
- Step 3：2 条自聊 `P6E-*`（逐条删，页内消失）。
- Step 4 行 1：两次 live 各 1 条 `P6G-race-*`（WhatsApp 侧已删，DB 留）→ `stats.total(30d)` 211→213。
- Step 4 行 2：临时客户建后已删，customers 还原 5；合成会话留一条悬空 `customer_id`（限制 2）。

## blocked / n/a 清单与原因

| 项 | 档位 | 原因 |
|---|---|---|
| TG 真实站点采集/发送（Step 4 行3-B / spec §12 TG 行） | 未验证 | 本机无 Telegram 账号，前置是用户扫一次码 |
| TG 本地 fixture A 档（`p6-tg-fixture.mjs`） | n/a | 依赖 Task 12a 真机 DOM 快照，快照从未产出→fixture 与驱动从未存在 |
| 手机物理并发 backfill×live（Step 4 行1 严格版） | n/a | 需用户在手机侧真发，属外部不可逆副作用 |
| 第三方真发 + 真第三方设备回执 ⏱→✓→✓✓（Step 3 行4 / Task 17 行10b） | blocked | 自聊不产生真 ack；守 C4 不往真人会话发，等用户单独点头 |
| 在线百度 scope-contract `#4` | 档位 n/a | channel=1 走离线模拟引擎，无中文译文结构性不可能；在线真值由 `p24-online-baidu.mjs`（channel=5）单证 |
| `p6b-query #1` TG 空基线 | 已知漂移 | 驱动写死 `length===0` 早于任何 TG 数据；过滤正确，未放宽（放宽=藏红） |

## 已知限制（≥3）

1. **WhatsApp 侧删除不回删 `chat_message` 行**：`chat_message` append-only、无删除端点。测试期发的自聊/合成消息在 WhatsApp 页内删净后，DB 仍以 `_out` 留痕并计入 `stats`。生产语义下这是"消息事实源不随前端删除而销毁"的取舍，非缺陷。
2. **删除客户后 `chat_conversation`/`chat_message` 的 `customer_id` 仍指向已删 id**：`link-customer` 是单向的（`ConversationLinkCustomerDTO.customerId` `@NotNull`、无反关联端点）。删客户只删 `customer` 行，聊天记录里的 `customer_id` 成悬空引用，记录页显示为「客户 #\<id\>」。本轮 Step 4 行 2 收尾即现场复现。
3. **会话切换事件没到位的那一拍，内嵌页气泡可能按上一个会话的客户语向多译一次**：生效面 ②（内嵌页气泡）语向由主进程按 `viewId` 现取活跃会话 `chatKey` 投影得出；切换当刻若 `activeChatOf` 尚未更新，可能用旧会话解析出的客户语向多译一次，下一轮扫描自然纠正。属尽力值，不作强一致。
4. **`stats` / 会话头计数是尽力值，与 WhatsApp 原生侧栏不保证一致**：会话头是投影，统计是实时聚合，两者都只反映已入库且落定后的数据，不镜像 WhatsApp UI 的未读/同步状态。
5. **在线渠道译文依赖 `channel` 与外部 provider**：默认 `channel=1` 为离线模拟引擎（半词典命中，可能中英混排）；真无中文译文需 `channel=5`（百度）且需网络。验收里"译文不含中文"这类断言只在对应渠道成立，不同档分开写。
6. **TG 采集/发送链本阶段完全未验证**：`chat_message` 里出现的 `platform='telegram'` 行仅由 HTTP batch 手工种的夹具，非任何 TG 采集实现产物（TG 注入/采集/发送实现从未落地）。

## 客户级语向：两处生效面的实测结论

数据形状：`translation_setting.scope/scope_key` 启用 `scope='customer'`（P5 已留列，P6 不改表、不加列、不改写入方）。解析顺序固定 **显式 `customerId` → 会话投影 → 全局**，两处生效面共用同一个解析口 `ScopeSettings.resolve`。

- **生效面 ① · 记录页回复框**（由 **Task 6** 兑现）：渲染层已知 `customerId`，翻译请求直接带上 → 落 `scope='customer'/scope_key=<customerId>` 覆盖。实测见 Task 6 表与本文 Step 5 行2（`p5r-trial.mjs`：带 customerId 走覆盖值、不带走全局且可分辨）。
- **生效面 ② · 内嵌页气泡**（由 **Task 17b** 兑现）：由**主进程**按 `viewId` 给翻译请求盖 `accountId`+`chatKey`（`accountId` 取自账号目录，`chatKey` 取自该视图活跃会话，即会话投影），后端拿 `(tenant_id, account_id, chat_key)` 在 `chat_conversation` 上精确匹配投影出 `customer_id`，再走同一解析口。**页面上报的账号与会话一律不进后端**——注入层只有页内 `chatHint`，仅用于把本页 inflight 去重键按会话分开，语种判定不依赖它；投影查不到行（陌生会话/平台错配/桥未挂）回落全局，与 ① 缺省态同语义。实测见 Task 17b 表与 `tmp/p6c-page-direction.mjs`。
- **两面的相对优先级**：记录页回复框（①）继续显式带 `customerId`，且它压过 ② 的会话投影。契约表（17b Step 2）确认「② 按会话投影取语向」与「① 显式 customerId 压过 ②」两条同时成立。

## 交付与提交范围

- 本任务**零 shipped-code 变更**：所有 live/回归红经过根因直查，均为驱动口径或环境/档位，未动生产代码。若后续发现要改代码，须按"改的是哪个任务"单独提 `fix(P6): …` 并复跑**那个任务自己的** CDP 表，不并入本提交。
- 提交范围**仅两份文档**：本文 + `docs/superpowers/specs/2026-09-20-chat-history-design.md`（§5 按客户语向行落两处生效面口径、§12 加实测列）。`tmp/*.mjs` 驱动在 gitignore 的 `tmp/` 下，不进提交。
- **push 由用户手动执行，助手不 push。**
