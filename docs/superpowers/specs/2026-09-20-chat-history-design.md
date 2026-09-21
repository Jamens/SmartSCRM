# P6 聊天记录模块设计（chat-history）

- 日期：2026-09-20 · 阶段：P6（feature-checklist `B5 聊天记录：存储/搜索/统计` + `sendMessage 落地` + P5 遗留的按客户语向）
- 前置：P5 翻译中心已交付（注入层/桥接/渠道路由可复用）；P2a 多账号视图、P2b 注入管线在位。
- 本文只描述本项目的方案与契约。

## 0. 约束与红线

| # | 约束 |
|---|---|
| C1 | 全部数据留在本地栈（Electron + Java + MySQL）；除 P5 已获批的翻译出口外不新增外呼。 |
| C2 | **桥脚本零凭据**：运行在第三方页内的一切脚本（含 wa-js 桥）不得持有 JWT/API key，不得直接发 HTTP 到后端；只与主进程通信，凭据留在主进程。 |
| C3 | 消息内容明文入本地库属既定隐私模型（与 P3 客户域同级）；不进任何缓存/日志的额外副本。 |
| C4 | 测试产生的 WhatsApp 消息（自聊）测后删除；DEMO 种子数据保持原样。 |
| C5 | pnpm only；后端 `./mvnw`；提交前缀 feat/fix/refa/update；push 由用户执行。 |

## 1. 决策记录（本阶段头脑风暴结论）

| 决策 | 选法 |
|---|---|
| WhatsApp 消息通道 | **页内 wa-js**：`@wppconnect/wa-js` 注入到用户正在看的内嵌 WhatsApp 视图，与原生页共用同一个 Store；不建隐藏第二会话 |
| Telegram 消息通道 | **官方 K 版 DOM 契约**：内嵌 `https://web.telegram.org/k/`（官方站点，路径钉死，不自建页面），TG 采集与发送都读它渲染出来的 DOM，选择器集中在一份由真机探针产出的清单里。**P6 裁定（2026-09-22 三次）：TG 留在本期，读取面从"页内 store 契约"改为 DOM 契约**——实测官方 `/k/` 上 `"getGlobal" in window === false`，旧口径要求的那层 API 在公网站点上不存在；代价是类名跟着构建产物变，所以选择器集中成配置。详见 §11 |
| 内嵌地址 | TG 用 `https://web.telegram.org/k/`。根地址 `https://web.telegram.org` 会被页面自己的路由带到 `/a/`（2026-09-22 实测），不钉路径就不是 K 版；切到 `/k/` 后需要重新扫码一次（K 与 A 不共用会话登录态） |
| 代码归属 | **主进程直挂桥**：桥脚本独立于翻译注入 bundle，由 `main/services/msgBridge/` 构建与挂载；两链只共用登录观察 |
| 记录页数据源 | **DB + 页内 live 双源**：历史读库；live 尾由同一事件流推送（不做逐条页内 pull 查询），渲染层按 msg_key 去重 |
| 历史补底 | 每会话最近 N 条（默认 200，可配置），限速批量；之后事件流增量 |
| P6 含发送 | 是：应用内单条回复落地到记录页；群发/撤回属 P7 |
| 客户映射 | 手机号自动匹配 `customer`；陌生号码照入库（`customer_id` 空），记录页可一键"建为客户"并回填历史 |
| 媒体 | 存类型 + 摘要文本，不下载本体 |
| 按客户语向 | P6 落地（兑现 P5 spec 预留的 `scope='customer'`） |

**非目标（明确移出本阶段）**：媒体文件本体、撤回、批量群发、群成员统计、已读回执精细度、FTS 全文索引、i18n。分属 P7/P8/P13/P14。

## 2. 架构总览

```
┌─ 内嵌视图 (web.whatsapp.com / web.telegram.org)
│    msgBridge 页内脚本：wa-js 钩子 或 TG DOM 钩子（类名集中在 §11.1 那份清单）
│    · 只产出归一化 MessageEvent / 执行发送原语 / 上报状态
│    · 通道：window postMessage ⇄ 主进程（经 preload 的中转通道 scrm:msg:*）
└──────────┬────────────────────────────────────────────
           ▼
  main/services/msgBridge/            ← 桥生命周期（挂载/探活/重挂/卸载）
   · CollectorHub：事件批队列（500 条或 2s flush）
   · SendRegistry：localId → pending 回执表
   · 持 JWT，与 Java 通信；向 renderer 广播 live 尾与在线态
           │                                   │
           ▼ HTTP(批量入库/查询)                 ▼ IPC(scrm:msg:live / :state)
  apps/server: Message/Conversation API   renderer: #/messages 聊天记录页
           ▼
  MySQL: chat_message / chat_conversation (V8)
```

翻译注入 bundle（P5）与消息桥（P6）在页内并存但互不引用；共用点仅有：主进程对"登录成功"的既有观察钩子。

## 3. 数据模型（V8 迁移）

```sql
CREATE TABLE chat_conversation (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,               -- platform_account.id
  platform VARCHAR(16) NOT NULL,            -- whatsapp | telegram
  chat_key VARCHAR(128) NOT NULL,           -- WA: <数字>@c.us / <id>@g.us；TG: chatId 字符串
  title VARCHAR(256) NULL,                  -- 对方昵称/群名快照
  is_group TINYINT NOT NULL DEFAULT 0,
  customer_id BIGINT NULL,                  -- 单聊匹配到客户时回填
  last_msg_time DATETIME(3) NULL,
  last_msg_body VARCHAR(512) NULL,          -- 摘要（媒体为占位文本）
  unread_count INT NOT NULL DEFAULT 0,      -- 尽力维护，非强一致
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_conv (tenant_id, platform, account_id, chat_key),
  KEY idx_conv_list (tenant_id, account_id, last_msg_time)
);

CREATE TABLE chat_message (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  platform VARCHAR(16) NOT NULL,
  chat_key VARCHAR(128) NOT NULL,
  msg_key VARCHAR(128) NOT NULL,            -- WA: message.id._serialized；TG: 平台消息 id
  direction VARCHAR(8) NOT NULL,            -- in | out
  customer_id BIGINT NULL,
  sender_key VARCHAR(128) NULL,             -- 群内发送者 id（单聊为 NULL）
  sender_name VARCHAR(128) NULL,
  body TEXT NULL,                           -- 文本正文；媒体为 NULL
  media_type VARCHAR(16) NOT NULL DEFAULT 'text',  -- text|image|audio|video|document|sticker|contact|location|unknown
  media_summary VARCHAR(256) NULL,          -- 「[图片]」类摘要
  msg_time DATETIME(3) NOT NULL,            -- 平台时间戳，UTC 存储
  status VARCHAR(16) NOT NULL DEFAULT 'received',
    -- in: received；out: pending|sent|delivered|read|failed
  source VARCHAR(16) NOT NULL,              -- live(事件流) | backfill(补底) | app_send(本应用发出) | native_send
  send_local_id VARCHAR(64) NULL,           -- out 消息关联 SendRegistry
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_msg (tenant_id, platform, account_id, chat_key, msg_key),
  KEY idx_msg_conv (tenant_id, account_id, chat_key, msg_time),
  KEY idx_msg_customer (tenant_id, customer_id, msg_time)
);
```

要点：

- **幂等**：一切写入走 `uk_msg` `INSERT IGNORE`；重复事件、补底与实时交叠都靠它消解。
- 会话头是**投影**不是事实源：任何消息入库顺带 upsert `chat_conversation` 的 `last_msg_*`；错乱可由"重算某会话头"接口修复（内部运维命令，不出 UI）。
- `tenant_id` 全表隔离，语义名列，无临时列。

## 4. 采集链

1. **挂载**：主进程观察到某视图登录成功 → `executeJavaScript` 挂对应桥脚本（esbuild 预构建，带 `bridgeVersion`）→ 桥握手回 `ready`。
2. **探活/重挂**：30s 心跳；WA 页面热更新（module reload）会让钩子失效，桥掉线即重挂（沿用注入层"版本探活"思路，独立实现）。视图销毁即卸载。
3. **补底**：`ready` 后拉会话列表 → 对每个会话拉最近 N 条（默认 200；全局配置项 `msgHistoryLimit`）→ 限速（会话间 ≥200ms、每批 ≤50 条）批量入 CollectorHub。单会话失败：记 `backfill_gap`（日志），不中断其余。
4. **实时**：WA `onAnyMessage`（含自己发出的）/ TG 消息列表的 `MutationObserver`（§11.2）→ 归一化 `MessageEvent {platform, chatKey, msgKey, direction, senderKey, body, mediaType, msgTime, ...}` → (a) Hub 批入库 (b) 同事件推 renderer live 尾。
5. **live 尾语义**：渲染层对"当前打开会话"订阅；插入前按 msg_key 去重；与翻页窗口重叠时以库为准、live 仅补 `msg_time > 游标` 的尾部。
6. **客户匹配**：入库时按对端手机号（单聊 chat_key 前缀数字）查 `customer.phone`，命中填 `customer_id`；未命中留空照入库。
7. **去抖与内存**：Hub 上限 10k 条，超出丢最旧并告警（DB 挂了也只影响缓冲，恢复后由增量事件自然续上；缺口由"重补底"按钮触发）。

## 5. 发送链（应用内回复）

契约（渲染 ↔ 主进程）：

```
scrm:msg:send  {accountId, chatKey, text, localId}
  → 回执 {localId, ok, msgKey?, error?}
  错误码：BRIDGE_OFFLINE(会话未在线，不排队) | SEND_FAILED | CHAT_NOT_FOUND
状态推进：pending → (桥回msgKey) sent → delivered/read（WA 事件驱动）；TG 到 `sent` 为止——§11.3 的"提交后目标会话里第一条未被认领的 `out` 行"就是它的落定事件，已读档位在 TG 侧不接（DOM 上只有会话级角标，推不到单条消息状态）
```

- 渲染层乐观展示 `pending` 气泡（localId 为 key），事件/回执到达后与库内行合并（msg_key 落地后以库为准）。
- 重试 = 新 localId 重发，幂等仍靠 `uk_msg`（对端真实重复由平台消息 id 区分，属产品可接受的"真重发"）。
- **先译再发**：回复框是普通 textarea，复用 P5 翻译 HTTP 通道与中文拦截；`sendLangSetting` 全局开关语义照旧。
- **按客户语向**：`translation_setting.scope/scope_key` 启用 `scope='customer'`（P5 已留列）；解析顺序 customer→global。生效面有两处：① 记录页回复框（已知 customerId）；② 内嵌页气泡——主进程从桥的 `activeChat` 事件维护「视图 → customerId」，随翻译请求下发给注入层，注入层按客户取语向。缓存 key 含 from/to，语向切换天然分键，不新增失效逻辑。

## 6. 陌生号码 → 客户

会话头/陌生标记旁「建为客户」→ 预填手机号与昵称（title 快照）调既有客户创建 API → 创建成功后前端紧接着调 `link-customer` 端点做历史回填（创建与回填是两个原子步骤，不隐式耦合）→ 刷新会话头。

## 7. 后端 API（全部租户隔离 + JWT）

| 端点 | 说明 |
|---|---|
| `POST /api/messages/batch` | Collector 批量入库（≤500/请求），逐条 INSERT IGNORE，顺带会话头 upsert；返回 `{accepted, duplicated}` |
| `GET /api/conversations?accountId&platform&q&cursor&size` | 会话列表（`last_msg_time` 倒序游标） |
| `GET /api/messages?accountId&chatKey&before&size` | 会话内消息（时间倒序取页，前端正序渲染） |
| `GET /api/messages/search?q&platform&accountId&direction&from&to&customerId&cursor` | 全局搜索：`body LIKE '%q%'`（本地量级够用）+ 维度过滤；返回消息卡片带会话锚点 |
| `GET /api/messages/stats?accountId&days=7|30` | 总数/活跃会话数/收发比/按日计数（统计卡数据源） |
| `POST /api/conversations/{id}/link-customer` | §6 回填 |
| `POST /api/conversations/{id}/replay-head` | 会话头重算（运维兜底，UI 不暴露） |
| `GET /customers/{id}/timeline` 扩展 | 时间线并入最近消息（分页参数兼容既有契约） |

## 8. 前端 UI（`#/messages`，侧栏「聊天记录」）

- **左列**：账号/平台过滤 + 会话搜索框；条目=标题、最后消息摘要+相对时间、未读角标、群/陌生标记。
- **右列**：消息流（日分组、in/out 气泡、媒体占位、out 状态 ✓/✓✓/failed+重试）；上滑 `before` 游标翻页；live 尾自动滚底；会话头含客户名/「语向」弹层/「建为客户」；底部回复框（Enter 发送、Shift+Enter 换行、先译再发开关）。
- **搜索视图**：顶部切到全局搜索（防抖 300ms；过滤条=平台/账号/方向/时间段/客户）；结果点击→跳会话并锚定高亮 2s。
- **统计卡**：页顶 7/30 天切换：总条数、活跃会话、收发比、近 7 天 div 柱条（不引图表库）。
- **离线态**：桥未 ready → 列表照常读库，回复框禁用并提示「会话未在线」（原生页手动聊天不受影响）。
- 客户详情时间线消费 §7 扩展，无新页面。

## 9. 错误处理

| 故障 | 行为 |
|---|---|
| 桥挂载失败/未 ready | 不采集不发送；UI 离线态；每 30s 重挂（指数退避封顶 5min） |
| 登录态丢失（手机退出） | 桥 `logged-out` 事件 → 清在线态、停发；登录恢复自动重挂并增量续采（不重复补底，`uk_msg` 幂等） |
| Java 不可用 | Hub 重试 3 次后落主进程日志、丢弃；恢复后不追历史缺口，页内提供「同步历史」按钮触发补底 |
| 单会话补底失败 | 记录跳过；「同步历史」可重试 |
| msg_time 异常（0/未来值） | 钳制为接收时刻 UTC，标记 `unknown` 精度（列不存，日志记录） |
| TG 站点改版、§11.1 清单失配 | 正判定与负判定**两边都不命中**即"未知态"：不采集不发送（宁可停，也不把空壳页当成已登录采出 0 条），桥侧记一行 `tg_contract_mismatch` 后停在该视图，重挂节奏同上面"未 ready"那行。修复面是重跑 Task 12a 探针、更新清单那一个文件，采集/发送/译文三处代码不动 |

## 10. 安全

- C2 红线：桥脚本零凭据、无 fetch；通道仅 `window.postMessage` ⇄ 主进程固定 channel。
- preload 暴露面：仅 `scrm:msg:*` 固定几个 channel（renderer→main：send；main→renderer：live、state、send 回执），不暴露 `webContents` 句柄。
- 消息正文不进 console/日志；日志只记 id/计数。

## 11. Telegram 契约基线与验证（P6 Task 12a / 12b / 12c / 12d）

**P6 裁定（2026-09-22 三次）：TG 走官方站点 + DOM 契约。** 内嵌 `https://web.telegram.org/k/`（官方 K 版），采集与发送都读它渲染出来的 DOM；登录方式与 WhatsApp 同形（扫码），登录后与 WA 共用同一条采集/发送链。技术路线从"页内 store 契约"改过来的依据是下面 11.0 的实测结论。

### 11.0 实测依据（2026-09-22，官方站点，未登录态，浏览器直连）

| 观察 | 结果 |
|---|---|
| 根地址行为 | `https://web.telegram.org` 由页面自己的路由落到 `/a/`（实测 `location.href` 停在 `/a/`，标题 `Telegram`）——不钉路径就拿不到 K 版 |
| K 版身份 | `https://web.telegram.org/k/` 标题 `Telegram Web`，`location.pathname === '/k/'`，产物是 `rolldown-runtime` / `solid` 系列 chunk |
| 旧口径的读取面 | `"getGlobal" in window === false`。`window` 上挂着的是构建产物自己导出的十余个名字：`AppStorage` `appStorage` `appNavigationController` `apiManagerProxy` `telegramMeWebManager` `webPushApiManager` `appDownloadManager` `appChatBackground` `useAppSettings` `createStickerAppearance` |
| `apiManagerProxy` 能不能当动作 API | 不能。原型上 104 个名字全是 API worker 的端口管道与 worker 侧存储读取（`processInvokeTask` `invokeCrypto` `getHistoryMessagesStorage` `getMessageById` `getPeer` `dispatchUserAuth`…），**没有 `invokeApi`**，也没有任何 `sendMessage` 形状的动作 |
| 未登录态 DOM | 只有空壳：`svg` / `.sidebar-left-overlay` / `#page-chats.whole.page-chats` / `#stories-viewer` / `.night`，类名集合里出现 `.sidebar` `.sidebar-content` `.chatlist-container` `.main-column` `.tabs-container` `.has-auth-pages` `.custom-scroll`；`.Message`、`.composer`、`input` 的命中数全为 0 |
| 未登录态会不会显示登录表单 | **不一定**。同一 profile 的 `localStorage` 里有 `auth_key_fingerprint` `number_of_accounts` `k_build`，页面既不渲染会话也不渲染登录表单，停在空壳 |

三条结论决定了本节的形状：**读取面只剩 DOM 一层**（11.0 第 3、4 行）；**会话路径必须钉死**（第 1 行）；**登录判定不能写成"没看见登录表单就是已登录"**（第 6 行，空壳态两边都不命中）。

代价也要说清楚：DOM 是构建产物，类名跟着版本变。所以本期把选择器当**配置**而不是代码常量——集中在一份清单里（11.1），站点改版时的改动面是那份清单，不是散布在采集/发送/翻译三处的字符串。

### 11.1 契约：一份探针产出的选择器清单，代码里不内联类名

`apps/desktop/src/bridge/telegram/tgSelectors.ts` 导出一个 `TgDomContract`，字段固定，**值全部由 Task 12a 的真机探针写回**（人只核，不编）：

```ts
export interface TgDomContract {
  build: string            // 探针当时的构建标识（k_build / 主 chunk 文件名），改版能一眼看出来
  probedAt: string         // ISO 时间
  loginForm: string        // 登录页容器（负判定）
  loggedIn: string         // 已登录才出现的节点（正判定）；两者都不命中 = 未知，不采不发
  chatList: string         // 会话列表容器
  chatRow: string          // 列表里一个会话
  chatRowActive: string    // 会话被打开时那一行多出来的态（决定未读加不加）
  chatRowTitle: string     // 行内标题节点
  chatRowUnread: string    // 行内未读角标节点（取文本里的数字）
  chatRowTime: string      // 行内时间节点（会话头 last_msg_time 的降级来源）
  messageList: string      // 打开会话后的消息滚动容器（补底靠滚它到顶）
  messageRow: string       // 一条消息
  incoming: string         // 行内"对方发的"判别
  outgoing: string         // 行内"本端发的"判别
  messageBody: string      // 行内正文节点
  messageTime: string      // 行内时间节点
  messageMedia: string     // 行内媒体容器（只判类型与占位，不下载）
  dateSeparator: string    // 日期分组头（时间解析要靠它补日期）
  composerInput: string    // 输入框（P5 的 replaceEditorText 写它）
  sendButton: string       // 发送按钮（真实点击，不 dispatch 合成事件）
  chatIdSource: 'hash' | 'attr' | 'none'   // 会话 id 从哪来，见 11.2
  chatIdAttr?: string
  msgIdSource: 'attr' | 'none'             // 消息 id 从哪来，见 11.2
  msgIdAttr?: string
}
```

清单是**唯一**的类名来源：采集（12c）、发送（12d）、译文注入（12b）三处都 import 它，谁都不许自带字符串。探针跑不出来 `none` 的字段，走 11.2 里写明的降级口径，不允许"先随手填一个类名让它跑起来"。

### 11.2 归一化映射（接进 §3 的两张表与 §5 的批量入库形状）

- `chatKey`：优先 URL hash——K 的会话链接把对端 id 直接放进 `location.hash`（形如 `#<id>` / `#-100…`），探针在"逐个点开会话"时记录 hash 与列表行的对应关系来确认。hash 与行属性两条路都拿不到时，采集只保**当前打开的那一个会话**（`chatKey` 来自 hash），列表侧不再产会话头；这条降级会砍掉"多会话补底"，所以探针必须给出确定答案，拿不到就停在 Task 12a 不改口径、不往下写代码。
- `msgKey`：`msgIdSource==='attr'` 时取 `String(el.getAttribute(msgIdAttr))`；否则用合成键 `tg<chatKey 去非数字><epoch 秒><in|out><正文 FNV-1a 的 8 位十六进制>`。合成键有两个**已知且接受**的代价，必须写进注释：编辑过的消息会成新行（多一行历史）、同一秒内同正文的重复消息会并成一行（少一行）。`uk_msg` 只保证不重复入库，管不了这两种语义。
- `msgTime`：`messageTime` 文本 + `dateSeparator` 上下文解析成 epoch 秒（时间只有 `HH:MM` 时，日期取自所在分组头；解析不出来按 §9 钳制为接收时刻并记日志）。这一条是 DOM 路线上最容易出错的一处，Task 12a 要把时间节点的原始文本一并记进探针产物。
- `body` = `messageBody` 的 `textContent`（`trim` 后为空则不落正文）；`mediaType` 由 `messageMedia` 子树里的 photo/video/document 判别，媒体**本体**仍按 §1 非目标处理，只落占位与摘要。
- 方向：命中 `outgoing` → `out`，否则 `in`；`senderKey` 群聊取行内发送者名节点文本的哈希，单聊留空。
- **群与频道不跳过上报**：`chat_key` 带负号也照常入库，`is_group` 由形态判定（`ChatKeys.TG_CHAT` / `isGroup` 已认这个形态）。会话归属客户这一侧另有闸门（`link-customer` 拒绝群），两者不是一回事。
- **变更事件** = `messageList` 上的 `MutationObserver`：新增/变更的行过一遍归一化，已见过的 `msgKey` 丢弃（同一批 mutation 里同一行会出现多次）。补底 = 把 `messageList` 滚到顶、分步采直到顶或到达 N 条上限（默认 200），滚不动或步数用完仍没到顶就报 `backfill_gap`。列表虚拟化时只采得到渲染出来的行，这正是要靠"滚到底再采"覆盖的场景。
- 已读、撤回、编辑**本期不接**：DOM 路线上已读只有会话级角标，推不到消息级状态（发出侧的状态天花板就是 `sent`，见 §4 的阶梯）；未读的增减一律由后端在入库时按"该行是否属于该视图的活动会话"算（`unreadDelta`），桥不上传任何已读帧。撤回/编辑如果后续要接，改动面是"观察处多认两种 DOM 变更 + 后端多一条状态迁移"，不改这两张表的形状。

### 11.3 发送与回执

DOM 路线没有 `localId`，发送是**用户级动作**：

1. 切会话——点 `chatList` 里目标那一行，等 `location.hash` 变成目标 id；不等或最终不等就回执 `CHAT_NOT_FOUND`，**不发**。
2. 写 `composerInput`（复用 P5 的 `replaceEditorText`，写不进去回执 `SEND_FAILED`），真实点击 `sendButton`。
3. 回执结清：提交成功后，目标会话里出现的**第一条未被认领的 `out` 行**（正文与提交文本完全相同、`msgTime ≥ 提交时刻`）即该 pending 的落定，状态推到 `sent`。同会话连发同一条文本时按提交 FIFO 认领；一个 pending 找不到候选行、或同一候选被第二个 pending 抢用时，记 `send_attribution_ambiguous` 日志（不静默）——这是 DOM 路线相对 store 路线**真实付的代价**，写清楚而不是假装不存在。
4. WA 与 TG 共用同一个 `SendRegistry` 与同一条状态阶梯，平台差异只在"回执从哪儿来"：WA 是 `SendMessageReturn.id` + `msg_ack_change`，TG 是 3 里的 DOM 认领。

### 11.4 客户侧的收敛

TG 的 `customer.open_id` 与 `chat_key` **同形**（纯数字串，群含负号）。这决定了 Task 12c 要顺带改 V3 里 `platform_type=4` 那两条种子的 `open_id` 形态——否则 §5 的自动匹配对 TG 永远命不中，"采集到了却认不出是人"。前提是 11.2 的 `chatKey` 确实拿到数字 id：探针结论是 `none` 时这一条同时作废，V9 不写。

### 11.5 译文注入（Task 12b）

P5 的注入层 TG 适配器现有类名是**未验证的猜测**（`.Imgs` 判登录、`.message-list-item`、`.text-content`、`#editable-message-text`、`.Transition_slide...>.MessageList`），Task 12b 把它们换成 11.1 清单里的真值，使 TG 内嵌页的气泡译文/输入框预览与 WA 同形。这一步在采集链之前：探针一次跑出的产物两处都要用，且译文注入的 B 档验证只依赖登录态、不依赖采集链。

### 11.6 划掉的旧口径（2026-09-21 二次裁定，留原因）

旧 11.1 要求承载页在 `window` 上暴露 `getGlobal()` / `getActions().sendMessage` / `apiUpdate` 事件流，并把"真实登录那一档"判成永久未验证。它成立的前提是"内嵌自建 Telegram Web"，官方站点不提供那层 API（11.0 第 3、4 行），所以旧口径在要用的站点上**永远不可能满足**——不是实现没做，是规格本身选错了读取面。本节按 DOM 路线重写后，B 档从"永久未验证"变成"有登录态就能出结论"。

## 12. 验证方案（每条都要能区分"生效 / 没动"）

| 层 | 手段 |
|---|---|
| 后端 | JUnit：batch 幂等（重发同批→duplicated 计数）、游标、搜索过滤、stats、link-customer 回填；curl 契约 8 条全过 |
| 桥/WA | 真实登录态：小参数补底（N=5）前后 DB 行数与 msg_key 集合比对；发送自聊一条→状态推进到 delivered→**删除测试消息**；native 页手发一条→事件流入库（证明双入口同源）；断线重挂后增量续采不重不漏 |
| TG | 分两档，**不混算**。**A 档（本期可出绿灯）**：本地 fixture 页 `apps/desktop/test/tg-fixture.html` **由 Task 12a 探针抓下的真实 DOM 快照裁剪而成**（同一批类名、同一层嵌套、同样的行属性，不靠记忆手写），再用脚本化时间线驱动：打开会话 → 往 `messageList` 里注入 3 条 `in`（其中一条正文与库里已存行完全相同，用来区分"去重生效"和"根本没采"）→ 应用内回复 → 造出那条 `out` 行。归一化纯函数走 JS 单测，整链走 CDP：采集 → `/api/messages/batch` → 记录页出现单聊与一个 `-100…` 群会话 → 回执推进到 `sent`。**B 档（前置是用户扫一次码）**：TG 视图指到 `/k/` 后需重新扫码（11.0 第 1 行：不钉路径会落到 `/a/`，两条路径不共用会话）→ Task 12a 在真登录态跑探针、产出清单与快照 → 12b 的气泡译文、12c 的补底与实时、12d 的发送各出一条可核对的证据（DB 行数、`msg_key` 集合、native 页手发一条能入库）。B 档不再是"永久未验证"，但**没扫码就是没跑**，扫之前一律如实标未验证。另留一条反向断言：TG 那一档没跑时，`chat_message` 里不该出现 `platform='telegram'` 的行 |
| 渲染层 | CDP 回归：列表/翻页/live 尾去重/回复（先译再发开、关两态）/语向弹层/陌生建客户闭环/搜索跳转/统计卡数字与库内 COUNT 一致 |
| 输入路径 | 涉及页内交互的断言一律真实鼠标/键盘事件（P5e 教训），不接受 `element.click()` 独证 |

## 13. 与相邻模块的缝

- P5 翻译：语向解析新增 customer scope；注入层翻译链本身不动。
- P7 群发：将复用 §5 发送契约（批量=多次 send + 主进程侧节流/看门狗），故 `scrm:msg:send` 契约从 P6 起按"可批量调用"设计（无会话内状态）。
- P8/P13：群统计与报表以 `chat_message` 为事实源，P6 不预建聚合表。
