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
| Telegram 消息通道 | **页内 API 钩子**：封装 web.telegram.org 页面自身暴露的全局 API（`window.sendMessage` / update 事件流）；动手前先做存在性探测（§11）。**P6 裁定（2026-09-21）：暂缓，TG 这一路整体移出本期**（§11） |
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
│    msgBridge 页内脚本：wa-js 钩子 或 TG 全局 API 钩子
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
4. **实时**：WA `onAnyMessage`（含自己发出的）/ TG update 事件 → 归一化 `MessageEvent {platform, chatKey, msgKey, direction, senderKey, body, mediaType, msgTime, ...}` → (a) Hub 批入库 (b) 同事件推 renderer live 尾。
5. **live 尾语义**：渲染层对"当前打开会话"订阅；插入前按 msg_key 去重；与翻页窗口重叠时以库为准、live 仅补 `msg_time > 游标` 的尾部。
6. **客户匹配**：入库时按对端手机号（单聊 chat_key 前缀数字）查 `customer.phone`，命中填 `customer_id`；未命中留空照入库。
7. **去抖与内存**：Hub 上限 10k 条，超出丢最旧并告警（DB 挂了也只影响缓冲，恢复后由增量事件自然续上；缺口由"重补底"按钮触发）。

## 5. 发送链（应用内回复）

契约（渲染 ↔ 主进程）：

```
scrm:msg:send  {accountId, chatKey, text, localId}
  → 回执 {localId, ok, msgKey?, error?}
  错误码：BRIDGE_OFFLINE(会话未在线，不排队) | SEND_FAILED | CHAT_NOT_FOUND
状态推进：pending → (桥回msgKey) sent → delivered/read（WA 事件驱动）；TG 本期不接入，其档位（只到 sent/failed）留待后续
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
| TG 全局 API 缺失 | §11 探测失败 → TG 降级为"仅打开会话可见采集"（domScan 级）或整块移出 P6，按实测结论定，不猜。**P6 走的是"整块移出"这一支，原因是本期裁定暂缓（未探测），不是探测失败**——两者结论相同、依据不同，后续重启 TG 时 §11 的探测仍要照做 |

## 10. 安全

- C2 红线：桥脚本零凭据、无 fetch；通道仅 `window.postMessage` ⇄ 主进程固定 channel。
- preload 暴露面：仅 `scrm:msg:*` 固定几个 channel（renderer→main：send；main→renderer：live、state、send 回执），不暴露 `webContents` 句柄。
- 消息正文不进 console/日志；日志只记 id/计数。

## 11. Telegram 前置探测（P6 Task 0）

在应用内嵌的 web.telegram.org 里探测既定全局 API（`sendMessage`/`getMessage`/update 事件源）是否存在、版本形态如何，**先出探测报告再决定 TG 侧实现深度**；结论回写本 spec §1 表格附注。未探测通过前不得声称 TG 链路可用。

**P6 裁定（2026-09-21）：本节探测不做，TG 采集与 TG 发送整体移出本期。** 落地的口径不是"档 3 的降级实现"，而是**根本不挂 TG 桥**：TG 账号在视图里照常能看（P2a 的内嵌能力，与本阶段无关），但不会有任何 `platform='telegram'` 的采集行；`chat_key`/`ChatKeys`/DTO 里的 TG 形态判定全部保留（它们是纯函数与列形状，不是采集实现），将来接 TG 时不必改表、不必改归一化规则。这一裁定只影响 P6 的采集面与断言面，不影响 §3 的 `platform` 取值域（`'whatsapp' | 'telegram'`）。

## 12. 验证方案（每条都要能区分"生效 / 没动"）

| 层 | 手段 |
|---|---|
| 后端 | JUnit：batch 幂等（重发同批→duplicated 计数）、游标、搜索过滤、stats、link-customer 回填；curl 契约 8 条全过 |
| 桥/WA | 真实登录态：小参数补底（N=5）前后 DB 行数与 msg_key 集合比对；发送自聊一条→状态推进到 delivered→**删除测试消息**；native 页手发一条→事件流入库（证明双入口同源）；断线重挂后增量续采不重不漏 |
| TG | 本期不做（§11 未探测，用户裁定暂缓）：断言整段撤下，改成一条反向断言——跑完 WA 补底与发送后，`GET /api/conversations?accountId=<tg>` 返回空列表、`chat_message` 里 `platform<>'telegram'` 的行数为 0。"没有 TG 数据"要说清是没做，不是做了没采到 |
| 渲染层 | CDP 回归：列表/翻页/live 尾去重/回复（先译再发开、关两态）/语向弹层/陌生建客户闭环/搜索跳转/统计卡数字与库内 COUNT 一致 |
| 输入路径 | 涉及页内交互的断言一律真实鼠标/键盘事件（P5e 教训），不接受 `element.click()` 独证 |

## 13. 与相邻模块的缝

- P5 翻译：语向解析新增 customer scope；注入层翻译链本身不动。
- P7 群发：将复用 §5 发送契约（批量=多次 send + 主进程侧节流/看门狗），故 `scrm:msg:send` 契约从 P6 起按"可批量调用"设计（无会话内状态）。
- P8/P13：群统计与报表以 `chat_message` 为事实源，P6 不预建聚合表。
