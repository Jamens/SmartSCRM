# P7 / B16 会话级设置设计（conversation-settings）

**日期** 2026-09-25 · **清单** B16（`docs/feature-checklist.md`，标「P7 前置」）
**目标**：给"某个账号视图里的某个会话"一份自己的翻译设置，优先级高于客户档，且**内嵌聊天页的页内气泡与输入框预览按这一档生效**。
**范围**：只做 B16。批量群发（B7）与素材按钮消息 / 归属分层（B17）各有自己的 spec → plan，不并进来。

## 0. 约束与红线

- 本地 MySQL（`smartscrm_react`）+ Java 后端是唯一数据层；迁移只加不改已发布迁移（V9 只做 `ALTER`）。
- 发送与采集只走主进程那条桥；页内脚本永远说不出"我属于哪个账号的哪个会话"（`ipc.ts` 的盖章口径），本设计不削弱它。
- 所有业务行按 `tenant_id` 隔离；平台 id 列一律二进制排序（V8 已为 `chat_key` 立此口径）。
- 验证分档：后端 HTTP 契约 / `node:test` 纯函数 / 渲染层 CDP / 真实登录档。后一档没跑完就不写"已验证"。
- 本文只描述本项目的规则，不与其他实现比较。

## 1. 现在有什么（设计前提，读码所得）

| 事实 | 位置 |
|---|---|
| 设置表两档：`scope='global'` 与 `'customer'`，唯一键 `uk_tset_tenant_scope(tenant_id, scope, scope_key)`，`scope_key VARCHAR(64)` | `V5__translation.sql` |
| 控制器强制 `scopeKey` 是数字客户 id，并以 `Long` 形态传进 `updateScopedSettings` | `TranslationController.java:51-60` |
| 客户档写入"从全局整份复制后覆盖" | `TranslationService.java:98-120` |
| 两档解析：`customerId ?? customerOfChat(accountId, chatKey)` → `customerRow` → `ScopeSettings.resolve(customer, global)` | `TranslationService.java:288-304`、`msg/ScopeSettings.java` |
| 翻译请求已带 `accountId` + `chatKey`（主进程盖，`activeChatOf` 取值，>128 丢弃） | `webContentsView/ipc.ts:93-131` |
| 主进程手里有"这个视图正在看哪个会话"：`activeChat` map，来源是桥的 `chat.active_chat` 事件 + 命令驱动双轨 | `services/msgBridge/index.ts:49,75,279` |
| 渲染层拿桥状态有两条路：`msg:state` 推送 + `msg:bridges` 拉取，同出一个组装口 `bridgeStates()`；"活动会话"这个词在 shared 里已有名字（`LiveFrame.activeChatKey`） | 同上 `:57-68,71-73`、`main/ipc.ts:89`、`shared/chatTypes.ts` |
| 会话键宽度与大小写口径：`chat_key VARCHAR(128) COLLATE utf8mb4_bin` | `V8__chat_history.sql:17,40` |
| 记录页那颗「语向」开的是客户档弹层；`LangRow` 目前私有于该组件 | `ConversationActions.tsx`、`CustomerDirectionDialog.tsx:26-56` |
| 设置提交是**局部提交**，`settingsInputOf` 才是整份构造器 | `api/translation.ts:30-53,205-235` |
| 页内开关是**进程级一份 flags**，来源只有 `useTranslationSettings()`（全局行），一次广播给所有内嵌页 | `lib/translationSync.ts:24-55,61-90` |
| 后端 `translate()` 从不按 enabled 位设闸：`receiveEnabled / sendEnabled / previewEnabled / enterToSend / disableChinese` 只进 VO 装配，开关判断全在注入层 | `TranslationService.java:514-517`、`inject/core/translation/domScan.ts:39`、`inputPreview.ts:82` |

## 2. 数据模型（V9）

`V9__conversation_setting_scope_key.sql`：

```sql
ALTER TABLE `translation_setting`
    MODIFY COLUMN `scope`     VARCHAR(16) NOT NULL DEFAULT 'global'
        COMMENT 'global | customer | conversation',
    MODIFY COLUMN `scope_key` VARCHAR(160) COLLATE utf8mb4_bin NULL
        COMMENT 'key form per scope: global=NULL | customer=<customerId> | conversation=<accountId>:<chatKey>';
```

- **不新增 `account_id` / `chat_key` 两列。** MySQL 唯一键不约束 NULL，`(tenant_id, account_id, chat_key)` 对 global/customer 行形同不存在，要挡住重复得引入 generated column。单列键保住"一个 `settingRow(tenant, scope, key)` 走全部三档"。代价：键形态每档一种写法，写进列注释。
- **`COLLATE utf8mb4_bin` 是必须的**：表本身 `utf8mb4_unicode_ci`，两个只差大小写的平台 id 会撞进同一行、后写的静默覆盖前一份且无痕迹。纯数字客户 id 不受影响（无可观察差异）。
- 宽度算得过来：`accountId` 最长 19 位 + `:` + `chatKey` 最长 128 = 148 ≤ 160。索引键长 8 + 16×4 + 160×4 = **712 字节**，在 InnoDB DYNAMIC 的 3072 之下。
- 不加"本会话独立"开关：**行的存在性就是独立性**，与 P6 客户档同一语义。
- 陌生会话（`chat_conversation` 尚无行）**允许**写会话档：设置先于采集、或这个会话从没入库都是正常时序。但写入必须校验 `accountId` 属于本租户（§7）。

## 3. 后端接口

| 端点 | 变化 |
|---|---|
| `GET /api/translation/settings` | 参数 `customerId` 之外新增 `accountId` + `chatKey`；两者齐备时走会话档。响应形状不变（§3.1）。语义与今天一致：答的是**这个作用域下的生效行**（`conv ?? cust ?? global`），不是"这一档有没有行"。 |
| `PUT /api/translation/settings` | `scope` 白名单 → `global\|customer\|conversation`。请求体新增 `accountId` / `chatKey` 两个可选字段，**会话档靠它们定位，不接受客户端拼好的 `scopeKey`**；`scopeKey` 的数字校验只在 `customer` 档保留（见 §3.4）。 |
| `DELETE /api/translation/settings/customer/{id}` | 不变。 |
| `DELETE /api/translation/settings/conversation?accountId=&chatKey=` | 新增。键里带 `:`/`@`/`.`，走 query 并 `encodeURIComponent`，不进路径段。返回 `{cleared:0|1}`，`0` 也是 200（沿用客户档口径）。 |
| `POST /api/translation/translate` | 请求体不变（已有 `customerId` / `accountId` / `chatKey`）。响应 `TranslateVO` **新增 `scope` 字段**（§3.2）。 |

### 3.1 读：三态不需要新字段

`TranslationSettingVO` 现有 `scope` + `inherited` 两个字段足以表达三态，渲染层按组合渲染：

| 生效档 | `scope` | `inherited` |
|---|---|---|
| 本会话专属 | `conversation` | `false` |
| 该客户专属 | `customer` | `false` |
| 沿用全局 | `global` | `true` |

不给 `inherited` 加第三种取值、也不加 `resolvedScope`：那会让 P5/P6 已交付的两态读法（翻译中心、回复框）在没同步升级时把三态读成两态。

会话档生效时，`scopeKey` 原样回传那条成形键（`5:8613…@c.us`）。渲染层**只显示、不解析**它：要 `accountId` / `chatKey` 就用自己的那两个字段（§3.4）。

### 3.2 解析链（唯一一处优先级定义）

```
conv   = conversationRow(tenantId, accountId, chatKey)        // chatKey 缺失/超长 → 不查
cust   = customerRow(tenantId, customerId)                    // customerId = dto.customerId ?? customerIdOfChat(...)
生效    = conv ?? cust ?? global
inherited = (conv == null && cust == null)
TranslateVO.scope = 生效档的 scope
```

`ScopeSettings.resolve` 改成收三档输入，返回同一个 `Resolved(setting, inherited)` 并额外带出 `scope`；只有一处调用方，不留两参重载。

**会话档优先于客户档，连请求显式带 `customerId` 也算。** 客户档答"我对这位客户一般怎么说"，会话档答"我在这个会话里怎么说"，语义上更近的赢。判定只看键能否命中行，不看请求带了哪个字段——否则同一会话在两个入口会读出不同生效值。

### 3.3 写：整份复制的源改成"当前生效行"

P6 客户档的写入是"从全局整份复制后叠加"。会话档的源改成**它要覆盖的那一档**：`conversation` 的源 = `cust ?? global`，`customer` 的源保持 `global`。否则在客户档已改过 `send_to_lang` 之后新建会话档，会落回全局值，用户看到的"继承来的那份"与实际写入的那份分叉。前端仍用 `settingsInputOf` 整份提交（弹层手里攥的就是生效值），服务端这份复制是**兜底**，两者对同一份输入必须给出同一行。

### 3.4 键的拼装只有一处作者（Java）

会话档的 `scope_key` 形态 `<accountId>:<chatKey>` 由后端一个函数成形（`ConversationScopeKey.compose(accountId, chatKey)`，与既有 `service/msg/ChatKeys.java` 同目录同风格），四处调用它：PUT 写入、DELETE 删除、GET 解析、translate 解析。**渲染层永远不拼、也不解析这个串。**

- **为什么不给 TS 一份镜像实现**：`shared/chatKeys.ts` 那份镜像是因为"群判定"在渲染层与主进程真的要用、Java 够不着；会话键没有这种需求——前端手里只有 `accountId` 与 `chatKey` 两个字段，交给后端就够了。两处各拼一次的风险不是编译错，是**写进去的键与读出来的键差一个字符**：保存提示成功、气泡仍按上一档走、日志一句不响。
- 后端 `updateScopedSettings(tenantId, scope, Long scopeKey, input)` 的 `Long` 参数改成**已成形的键**（`String`，global 为 `null`）：controller 按 scope 分派校验（customer → 数字、conversation → `compose`），service 不再关心键的形态。调用方只有 controller 一处，不留重载。
- 键宽由两个上游约束保证（`accountId` 是 `Long`、`chatKey` 见 §7 的 128 上限），160 列宽不会被写爆；`compose` 自身不接受空 `chatKey`。

## 4. 生效面（逐条写清谁负责，注入层负责什么）

**① 内嵌页气泡 / 输入框预览的语种与线路** — 注入层与桥**零改动**。链路是页 → `view:invoke` → 主进程按 `event.sender` 反查 `viewId`、盖 `accountId` + `activeChatOf(viewId)` → 后端 `translate()` resolve。语种 / 线路是后端每次请求现算的，改了 §3.2 就等于页内生效，这是本设计最便宜的地方。

**①b 内嵌页的开关位不跟着变（有意的边界）** — `receiveEnabled / sendEnabled / previewEnabled / enterToSend / disableChinese` 今天只有一份**进程级 flags**，来源是全局行（§1 那两行证据），后端从不按它们设闸。要让开关按会话生效，得把注入层的 `StateManager` 从"一份 flags"改成"按 chatKey 分桶的 flags"，并给 `update-translation-flags` 那条通道加会话维度——那是另一件事，本阶段不做（§9），代价记在 §10 D-09。所以会话档改的是**怎么说**（语种、线路），不是**要不要说**（开关）。

**② 记录页回复框「先译再发」** — 两处都要改，它们现在是"只认客户"的：

- 取数：`ReplyComposer.tsx:28` 的 `useTranslationSettings(conversation.customerId)` 要按 §3 的 GET 加上 `accountId` + `chatKey`，否则**发送前摘要**（`directionSummary`）显示的是客户档，而实际发出去用的是会话档。
- 请求：`ReplyComposer.tsx:54-57` 的 translate 只带 `customerId`，必须补 `accountId` + `chatKey`（`:22` 的 props 里 `conversation` 两个字段都是现成的，`chatKey` 已在用）。否则会出现"会话档已生效、回复框却按客户档预览"的反例。

**③ 生效档标注** — 摘要旁渲染一枚小徽标（本会话 / 该客户 / 全局）。档位取两处：发送前的 `TranslationSettingVO.scope`（来自 ② 那次 GET，它答的就是生效行，§3），发送后的 `TranslateVO.scope`（新字段，那次翻译**实际**用了哪一档）。两处都要是因为 §6 有意让记录页的弹层只编辑客户档——弹层显示的那一档与实际生效的那一档可能不同；不标注就是屏幕上摆一句假话。

**④ 翻译中心全局页** — 不变，继续只编辑 `global` 行。

## 5. 活动会话出口（新通路）

不新增 IPC 通道，改成**把 `activeChatKey` 挂进已有的 `msg:state` 广播**：

- `shared/chatKeys.ts`：新增 `activeChatKeyOf(raw: string | null | undefined): string | null`——空白或长度 >128 归 `null`，其余原样。把 `ipc.ts:116` 那句内联判断（`activeChat && activeChat.length <= 128 ? activeChat : undefined`）换成调它，让"盖章处丢弃"与"广播处裁剪"是同一份代码。这不是顺手重构：**按钮能不能点亮必须与后端会不会用上这个 chatKey 同口径**，否则弹层会让你给一条翻译永远不会resolve到的会话设语向。
- `shared/chatTypes.ts`：`BridgeState` 增 `activeChatKey: string | null`。字段名沿用 `LiveFrame` 里已有的 `activeChatKey`，不引入第二个叫法。
- `services/msgBridge/index.ts`：在 `bridgeStates()`（`:71`）里逐条补 `activeChatKey: activeChatKeyOf(activeChatOf(s.viewId))`——它是 `msg:state` 广播（`:58`）与 `msg:bridges` 初次拉取（`main/ipc.ts:89`）的共同组装口，改这一处两条路都有值，别只补广播那一支；`handleBridgeReport` 里 `report.kind === 'active_chat'` 分支（`:279`，现在 `set` 完直接 `return`）在 `set` 之后追加一次 `broadcastState()`。
- `unmountView` / `stopMsgBridge` 已经在清 `activeChat`，随之广播的 `null` 自然把渲染层那份也刷掉。
- **渲染层零新增**：`useLiveTailSync` 已经把 `msg:state` 推送与 `msg:bridges` 首帧拉取两份都写进 `queryKeys.bridges` 缓存（`lib/liveTailSync.ts:257-273`），加一个字段自动到位；dev 探针 `window.__p6f.bridgeStates()` 读的就是这同一份缓存（§8 的断言入口）。

**为什么不新开通道 + 轮询**：`msg:state` 是"最后一次已知值"的单一来源，渲染层已有 store 存着它；开通道要么让渲染层轮询（多一条无谓往返），要么在 mount 时补一次拉取（多一个时序分支）。代价是每次切会话多广播一帧——最多 7 个视图、一帧 IPC，换掉的是"弹层可能读到过期 chatKey"。

## 6. UI

- **入口**：`AccountStage.tsx` 工具条在「注入开关 / 刷新」之前加一颗「会话设置」。
- **取活动会话**：舞台从 `queryKeys.bridges` 缓存里挑 `accountId === 本舞台账号` 且 `ready` 的那一条，读它的 `activeChatKey`。**不能拿"最后一条"或"任意一条"**——多个账号视图同时在线时（最多 7 个），那会把语向设置写到另一个账号的同名会话上。禁用条件因此只有一条链：挑不到桥、或挑到的那条 `activeChatKey === null`（桥不在线时它本就是 `null`，两个条件同源）。禁用时 `title="会话未在线"`。
- **不显示会话标题**：标题在 `chat_conversation.title`，为工具条一颗按钮去拉会话列表不划算；且陌生会话可能压根没有行。标题只在弹层里出现，显示 `chatKey` 原文（`8613…@c.us` 形态本身可读），并注明"未关联客户时这是唯一标识"。
- **弹层** `components/translation/ConversationSettingsDialog.tsx`（与下面那条共享的 `DirectionLangRows.tsx` 同目录，两处都属"翻译设置的控件"，不为一个弹层另开 `stage/` 目录）：控件三样——收信行、发信行、线路（channel）。**不放任何 enabled 开关**：按 §4①b，会话档的开关位不会在后端设闸、也不会在页内生效，给了控件就是给一个按了没反应的按钮。其余列由 §3.3 的整份复制带过去，不给控件。按钮「恢复继承」（DELETE）+「保存（n 处改动）」，徽标三态见 §3.1。
- **`LangRow` 抽共享**：从 `CustomerDirectionDialog.tsx` 提到 `components/translation/DirectionLangRows.tsx`，两个弹层共用，不复制逻辑块。签名里的 `enabled / onEnabled` 改成**可选**——客户档弹层继续传（那里有开关），会话档弹层不传，组件在不渲染那颗 Switch 时其余部分（标题、两个语种下拉、线路下拉、禁用态联动）保持一致。会话档那一份的开关取值由 §3.3 的整份复制从生效行带过来，只是没有控件。
- **记录页那颗「语向」仍只编辑客户档**。两个入口开同一个弹层会让用户分不清自己在改哪一层；档位差异由 §4③ 的标注承担。连带效果要写清：会话头那枚摘要（`ConversationActions.tsx` 的 `LinkedIdentity`，读 `useTranslationSettings(customerId)`）继续显示客户档，于是同一屏会并列两枚摘要——头像是"这位客户一般怎么说"，回复框旁是"这一条实际怎么说"。所以 §4③ 的档位徽标是必要的，不是装饰。
- **取数与缓存要加第三个维度**：`useTranslationSettings(customerId)` 与它的 `settingsKeyOf`（`api/translation.ts:126-135`）现在只有 `number | 'global'` 两态。会话档得有自己的查询参数与缓存键位，否则弹层与回复框共用一份缓存、互相把对方那一档的值铺进界面。失效不用改：`useUpdateTranslationSettings` 早就是整前缀失效。
- **顺手修一句已过期的说明**：`CustomerDirectionDialog.tsx:116` 写着"内嵌 WhatsApp 页里的气泡仍按全局语向翻译"，而气泡按客户语向生效是 P6 Task 17b 已经交付的（`36ad104`）——那句话今天在屏幕上就是假话，会话档上线后更不准。改成不承诺具体哪一档，只说这份覆盖作用于这位客户、页内与回复框都按 §3.2 的优先级解析。

## 7. 错误处理与边界

| 情况 | 处理 |
|---|---|
| `scope='conversation'` 但 `accountId` / `chatKey` 缺一个（PUT body 或 DELETE query） | `40000`，文案点明会话档要这两个字段。不存在"客户端自己拼 scopeKey"这条入口（§3.4）。 |
| `chatKey` 含空白 / 控制符 / 长度 >128 | `40000`。与 `activeChatKeyOf`（§5）同一个上限：**页内能被后端用上的会话，弹层里就一定存得下**，反过来存不下的那条翻译也不会用它——两个口径分家时就会出现"保存成功但不生效"。 |
| `accountId` 不属于本租户 | `40000`，不是 `40404`：这不成形，不是"资源不存在"。 |
| `scope='customer'` 的 `scopeKey` 不是数字 | `40000`，沿用今天的校验与文案（`TranslationController.java:52-59`）。 |
| 会话档不存在时 GET | 回落到生效档，`inherited` 按 §3.2。 |
| DELETE 没删到行 | `{cleared:0}` + 200。 |
| 渲染层拿不到 chatKey | 按钮 `disabled`，弹层不挂载。 |
| 桥掉线后会话档残留 | 不级联删除：会话档是设置，不是采集数据，重连后同键命中。 |

## 8. 验证方案

**后端契约（HTTP，`tmp/p7a-conv-settings.mjs`，中文载荷走 UTF-8 文件）** — 每条都要能区分"生效了"与"什么都没做"：

**驱动器前置**：需要一个**属于本租户的真实 `accountId`**（从 `/api/platform-accounts` 取现成的，或复用 P6 夹具里那批）。§7 那条租户校验如果拿不到合法账号，1/2/3/4 会同时红且原因只有一个——那不是被测行为的失败，先把这一步断言成"取到了 id"再往下跑。

1. 大小写敏感：用同一个 `accountId` 写 `AA@c.us` 与 `aa@c.us` 两条会话档（PUT body 带 `accountId` + `chatKey`，不是拼好的 `scopeKey`），设不同 `send_to_lang`，各自读回必须不同值（V9 前会合并，这条即迁移的验收）。
2. 三档优先级：客户档 `send_to_lang=vi` + 会话档 `send_to_lang=hi`，带 `customerId` + `accountId` + `chatKey` 的 translate 必须返回 `scope='conversation'` 且语种为 hi。
3. 回落：DELETE 会话档后同一请求返回 `scope='customer'`、`inherited=false`；再 DELETE 客户档返回 `scope='global'`、`inherited=true`。
4. 整份复制源：客户档改 `receive_to_lang=en` 后新建会话档（只带 `send_to_lang`），落库的 `receive_to_lang` 必须等于 `en` 而不是全局的 `zh-CN`。
5. 边界：`chatKey` 128 接受 / 129 → 40000；`accountId` 跨租户 → 40000；`scope='conversation'` 而 `chatKey` 缺失 → 40000；`customer` 档的 `scopeKey` 非数字 → 40000（回归今天那条，证明分派没把老校验弄丢）。
6. DELETE 幂等：第二次 `{cleared:0}` 且仍 200。
7. 缓存隔离：两条语种不同的会话档交替请求同一句原文，`cacheKey` 必须不同（证明没串译文）。
8. 开关位不设闸（负面断言，守住 §4①b 那条边界）：把某会话档的 `receive_enabled` 写成 `false` 并读回确认落库，再用同键发 translate——**必须照常返回译文**且 `scope='conversation'`。这条区分的是"会话档只改了语种口径"与"会话档顺手把翻译关了"，后者不是本设计承诺的行为；哪天有人给 `translate()` 加了 enabled 判断，这条会红。

**没有的一条断言**：会话档的开关位影响内嵌页行为。§4①b 明确不做，代价记 D-09，所以验证面里不该出现它——如果出现，说明实现顺手扩了范围。

**纯函数单测（`node:test`，TS 侧）**：`shared/chatKeys.ts` 的 `activeChatKeyOf()`——WA `@c.us` / 群 `@g.us` / TG 纯数字原样返回；`null`、空串、纯空白、含换行 → `null`；128 字符通过、129 → `null`。TS 侧**没有**键拼装函数要测：§3.4 把键的作者定为 Java，这里若冒出 `conversationScopeKey()` 就是实现越了范围。

**Java 单测（`./mvnw test`）**：`ConversationScopeKeyTest` 测 compose（`5` + `8613…@c.us` → `5:8613…@c.us`；`chatKey` 为 `null`/空白/含空格 → 拒绝），风格照 `service/msg/ScopeSettingsTest.java`。`ScopeSettingsTest` 补三档组合：conv 命中 → `scope='conversation'`+`inherited=false`；仅 cust → `'customer'`+`false`；只有 global → `'global'`+`true`。这两份是"优先级正确"与"键形态正确"唯一的离线证据，跑不到的部分全在上面的 HTTP 契约里。

**渲染层 CDP（`tmp/p7a-stage-dialog.mjs`）**：先 `tmp/p5c-top.ps1` 并断言 `visibilityState==='visible'`，否则中止。断言行：

1. 按钮禁用态要能**区分两种失败**：`ready===false`（桥不在线）与 `ready===true && activeChatKey===null`（桥在线但没选中会话）——`__p6f.bridgeStates()` 里两个字段各断言一次，只断言"`disabled===true`"的话，把挑错桥（§6 那条按 `accountId` 筛）的 bug 也一并放过了。
2. 真实 `Input.dispatchKeyEvent` / `insertText` 走完"改语种 → 保存 → 徽标翻成本会话专属"，**保存后从后端按同键读回**（不是读表单现值）确认落的确实是会话档那一行，且 `scope='conversation'`。
3. 「恢复继承」→ 徽标翻回它下面那一档（有客户档时是「该客户专属」，不是「沿用全局」）——这条同时验 §3.2 的回落与 §3.1 的三态渲染。
4. 切换记录页会话后，回复框旁的生效档徽标跟着变（§4②③）。

**实跑结果（Task 10）**：这份驱动六行 **44 条**断言全绿（打印的是 `ALL PASS (44/44)`，exit 0）。比上面四类多出来的是"会话目标在点开那一刻冻住"（1k–1n）、"恢复失败与保存失败两条出口分得开"（2.5a–c）、"客户档弹层里没有线路那一格"（6a–c）与两种帧序各一遍（`1e`/`1f`/`1g` 与 `1e2`/`1e2b`/`1e2c`/`1g2`，后一组里 `1e2` 单独断"反序那一帧确实换了渲染层手里那一格"——见下）。出口码按两种红分开：`BLOCKED(premise)` → exit 2（布景或环境坏了），`FAIL(assertion)` → exit 1（被测行为坏了）。

**这一行里哪些断言有分辨力**：行 1 的 `1b`/`1d` 读的是 `__p6f.bridgeStates()` 那份缓存，而那份缓存正是 `setBridges` 自己写进去的 ⇒ 它们只证"探针往返 + 组装没吞字段"，不证"应用读对了帧"。区分两种禁用失败靠的是 `1a`/`1c` 那一差分（两帧只差 `ready` 与 `activeChatKey` 之一，而入口在两帧下都禁用）；"按 `accountId` 筛"靠的是 `1e`/`1g` 与反序那一组的差分。

分辨力另做一次**变异验证**（跑的是当前这份 44 行的驱动）：把 `useBridgeOf` 里那句按 `accountId` 筛的 `data?.find((s) => s.accountId === accountId && s.ready)` 临时改成不筛账号的 `data?.find((s) => s.ready)`，同一份驱动以 **41/44** 收场，红在三条上——`1g2`（反序那一序里读出的是另一个账号那条帧的会话键 `P7DECOY-…`）、`1k` 与 `1l`（两条"冻结"断言同样读到 DECOY）。改回 shipped 写法后重跑回 **44/44**（exit 0）。`1e2` 那一格在变异下仍绿，是它本来就该绿：它读的是探针缓存里那一格的 `viewId`，不经过 `useBridgeOf`——它的职责只是证明"反序帧进了手里"，分辨力在 `1g2` 那一条上。这条证的是"两种帧序都喂"确有分辨力，而不是喂了两种顺序恰好都能过（两份日志：`tmp/p7a-t10-mutation2.log` 红的那一轮、`tmp/p7a-t10-run19.log` 还原后的绿一轮）。变异是工作树里的临时改动，验完 `git checkout --` 还原、`git status` 干净，未进任何提交。

同一类问题在修复轮 2 又堵了一个：反序那一帧与正序那帧的 `ready`/`activeChatKey` **同值**，两帧下入口都该点亮，于是驱动里"等禁用态跟上这一帧"那条轮询会立刻返回——正序帧还留在手里时也是，`1e2`/`1f2`/`1g2`（当时三条）读同一份余值却三条全绿。改成先按两帧唯一不同的字段（`viewId`）证明帧换了手里那一格，再读 DOM；那一组现在是四行（`1e2` 帧落地 / `1e2b` 入口点亮 / `1e2c` 弹层可开 / `1g2` 弹层取的是本账号那条）。

**已知缺陷（应用侧，本阶段只记账不改）**：`ui/select.tsx:64` 与 `ui/dialog.tsx:41,83` 的出场动画（`data-[state=closed]:animate-out`）期间，那份已经 `data-state="closed"` 的浮层仍挂在 DOM 里并**继续参与命中测试**（opacity 动画不影响命中），两处都没有 `pointer-events-none`。实测表现：选完一项后紧接着点「保存」，那一点被一份正在退场的 `select-item` 接走，PUT 根本没发。本轮的对策只在驱动侧——等浮层彻底 unmount 再发下一次点击，并把"点击被吃掉"报成断言失败（exit 1）而不是前置不满足（exit 2）。应用侧的修法见 §10 D-12。

这条出口码本身也验过一次：把驱动里"等浮层退场"那 4s 换成 1ms 再跑，第一条下拉就报成**计数过的断言失败**（`20 FAIL … 还剩 1 份 select-content 在 DOM 里`，exit 1，日志 `tmp/p7a-t10-stuckprobe.log`）——不是崩溃、也不是 exit 2 的"前置不满足"。修轮 1 之前它到不了这个出口：那一句里手抄的选择器多出一个 `}`，`querySelectorAll` 当场抛 `SyntaxError`，缺陷出口自己变成未分类崩溃。现在两处读同一份串（一个局部 `leftContent()`），抄错的机会没了。顺带说明现场的修法：崩在弹层/下拉里时 radix 会在 `<body>` 上留下 `pointer-events:none`，驱动开局读到就报 exit 2 不硬跑；`node tmp/p7a-t10-recover.mjs` 发一次真实 Escape 关掉残留弹层并读回判据（实测那一轮：`开局 {"pe":"none","dlg":true,"sel":0,"ov":1}` → 一次 Escape 后 `{"pe":"","dlg":false,"sel":0,"ov":0}` → `CLEAN`，exit 0；那次终端输出没落成文件，留了档的 `tmp/p7a-t10-recover.log` 记的是绿色一轮跑完后的现场，`开局` 一行即 `pe:""`）。

**真实登录档（需你在场：代理 + WhatsApp 已登录）**：在 WhatsApp 里给会话 A 设 `en`、会话 B 设 `vi`，切换会话看气泡是否跟着变。这档未跑完之前，§4① 只能标"读码成立"。

**未跑原因（Task 11 本轮：前置不成立，不是断言失败）**：两棒都没开火，所以这一档本轮没有实跑数，上面那句原话照旧成立。当场量到的是——代理开着（`ProxyEnable=1` / `127.0.0.1:7892`）、WhatsApp 视图已登录（`#pane-side` 在、0 颗 QR 画布、无登录面板）、主进程确实是 Task 6 之后的构建（现拉的 `msg:bridges` 帧里带 `activeChatKey` 这一格，那一格只由 `bridgeStates()` 组装），可用单聊 33 条（键非空、≤128、非群），全局行 `scope=global recv=zh-CN send=en channel=1`。坏在第三件前置：视图里此刻没打开任何会话（`#main` 不存在），而页侧 `active_chat` 只有两个发布者、都是事件驱动（`bridge/whatsapp/collect.ts` 的 wa-js `chat.active_chat` 事件与 `open_chat` 命令回执），本阶段没有驱动侧的 `open_chat` 通路，于是"真桥给不给得出键"这一格只能由一次真人切会话来回答；B 棒的结构本身就是"人在 A 棒之后亲手切到同账号另一条会话"。真人不在场 ⇒ 按 Step 1 给的出口记未验证。另记一句本轮量到的形状，免得下一轮误读：那一格现拉值是 `null`，说的是"这一拍没人切过会话"，不是"真桥给不出键"——两者的分别正是 A1 要做成断言而不是前置的原因。逐件读数、闸门抄录与 `tmp/p7b-prereq.mjs` 那一次 `BLOCKED(premise) … —— []` 的原文，见 `docs/notes/2026-09-25-conversation-settings-verification.md`。

**已知验证缺口**：Telegram 会话档只能到 fixture（Task 12a 未做），本阶段不声称 TG 生效。

## 9. 不在本阶段

- **不由单一"客户语言"反推收发语向**：语向始终是 `receive_from/to` 与 `send_from/to` 四列显式读写，不提供"选一种语言、两个方向自动算出来"的控件。
- **页内开关按会话生效**：不做（§4①b）。要做得把注入层 `StateManager` 从一份 flags 改成按 `chatKey` 分桶，并给 `update-translation-flags` 通道加会话维度，代价记 D-09。
- 语音翻译、敏感词 / 中文拦截的会话级控件：只随整份复制携带，不给入口。
- 注入层里的页内设置面板（往 WhatsApp DOM 塞 UI）：不做，弹层归应用层。
- 批量群发（B7）、素材按钮消息与归属分层（B17）：各自 spec。
- 字段级 patch（只存改过的那几列）：不做，整行覆盖是既有语义。

## 10. 裁定记录

| # | 裁定 | 理由 | 错了的代价 |
|---|---|---|---|
| D-01 | 会话档优先于客户档，且不看请求带了哪个字段 | 语义距离更近；判定只看键能否命中 | 两入口生效不一致，回来得改优先级方向 |
| D-02 | 单列 `scope_key` 扩到 160 + `utf8mb4_bin`，不加两列 | 保住一条 `settingRow()`；NULL 不参与唯一约束 | 若以后要按账号统计会话档，得回填 `account_id` |
| D-03 | 整份复制的源 = 当前生效行 | 否则会话档落地会丢客户档已改的值 | 一次写入语义返工 |
| D-04 | `activeChatKey` 挂进 `msg:state`，不开新通道 | 单一"最后已知值"来源，免轮询免时序分支 | 若广播被证明不够及时，再补一次拉取 |
| D-05 | 三态用 `scope` + `inherited` 组合，不加字段 | P5/P6 两态读法不必同步升级 | 老客户端把三态读成两态（已知，由 §4③ 标注兜住） |
| D-06 | 陌生会话可写会话档 | 设置先于采集是正常时序 | 键空间可能被无主会话填污（本地库，可接受） |
| D-07 | 记录页弹层仍只编辑客户档，会话档只在 stage 有入口 | 一处入口一档，用户不必判断自己在改哪层 | 若要求记录页也能改会话档，加一档切换即可 |
| D-08 | B16 与 B7 / B17 各自 spec → plan → 提交 | 三者无接口依赖，混在一份计划里验收面互相纠缠 | 计划返工 |
| D-09 | 会话档只改**怎么说**（语种、线路），不改**要不要说**（开关位）；页内 flags 仍是进程级一份、来源全局行 | 开关判断全在注入层 `StateManager`，它手里只有一份 flags；按会话分桶要同时改 StateManager 的键结构与 `update-translation-flags` 的载荷，与本阶段"后端多resolve一档"不是同一层改动 | 用户在会话 A 关掉接收翻译、会话 B 开着，页内实际只有一份开关，与弹层里"这一档的取值"看起来不一致。要补就做 §9 那条分桶，另开 spec |
| D-10 | 会话键由 Java 单点拼装，API 传 `accountId` + `chatKey` 两个字段，不接受客户端拼好的 `scopeKey` | 前端拼一次、后端读一次 → 差一个字符就是"保存成功但不生效"，且没有任何一层会报错 | 以后若真要开放任意形态的 `scopeKey`（别的档位），得给 service 再加一条成形入口 |
| D-11 | 把 128 裁剪从 `ipc.ts:116` 的内联判断提成 `shared/chatKeys.ts` 的 `activeChatKeyOf()`，盖章与广播共用 | 两个口径分家时，按钮可能对一条翻译永远用不上的会话点亮 | 动到 P6 已交付的取数路径（行为等价，由 §8 的单测与既有翻译回归兜住） |
| D-12 | 浮层退场期间仍吃命中测试这一格记为**应用侧已知缺陷**，本阶段只在驱动里等它 unmount，不动 `ui/select.tsx` / `ui/dialog.tsx` | 那两处是 P4/P5 起所有弹层共用的底座，改了要把已验过的 P5/P6 弹层面整体回归一遍，与 B16 没有依赖关系；B16 的验收面靠"等 unmount"已经站得住 | 用户手点时仍可能被一份正在退场的浮层吃掉一次点击（表现为"点了没反应"，再点就好）。补 `pointer-events-none` 时连带回归，别顺手改动画时长 |
