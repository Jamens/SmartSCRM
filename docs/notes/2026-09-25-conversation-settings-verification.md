# P7 / B16 会话级设置 · 验收结论

日期：2026-09-26 · 关联：`docs/superpowers/specs/2026-09-25-conversation-settings-design.md` · 计划：`docs/superpowers/plans/2026-09-25-conversation-settings.md`

> 本文只记本项目的实测口径。驱动都在 `tmp/`（gitignore，不入库），断言均为当场真跑的数；未跑的行如实标 blocked / 待验证，不合并成"全绿"。

## 总体结论（不是"全部通过"）

Task 1–10 的机械面本轮在 HEAD `314577f` 之上**全部复跑并绿**：Java 单测、后端 HTTP 契约、TS 单测、typecheck、渲染层 CDP 六行。Task 11 自己那一步要的那格证据——**真桥到底会不会给出 `activeChatKey`、给了会不会跟着 WhatsApp 里的切会话走**——本轮**未跑**：Step 1 的第三件前置不成立（现场没有真人可以在 WhatsApp 里切会话，而两棒的结构就是"第二棒要人在 A 棒之后手动切过去"），所以 `tmp/p7b-live.mjs` 一棒都没开火。

于是各处证据词按下面这样定，不往上抬：

| 面 | 本轮证据词 | 一句话 |
|---|---|---|
| 后端三级解析 / 写侧分派 / 边界闸 | **实测** | `./mvnw test` 63 条 + `tmp/p7a-conv-settings.mjs` 29 条，全在真库 `smartscrm_react` 上跑 |
| V9 那一次列宽变更 | **读码 + 行为实测** | 列宽本身无直查证据（本机无 mysql CLI），能拿到的只有"只差大小写的两条键存成两行"这一条行为差异，见下节 |
| 渲染层三档生效面（禁用链 / 冻结目标 / 写回哪一档 / 缓存分键） | **实测（布景为 A 档手喂）** | `tmp/p7a-stage-dialog.mjs` 六行 44 条全绿；它证的是"渲染层读对了那两个字段"，**不**证"真桥会不会给值" |
| 生效面 ① · 内嵌页气泡按会话档出译文 | **读码成立**（本轮维持 spec §8 原话） | 一棒都没跑，够不上"读码 + 部分实测"那一档（那一档要 A5/B4 至少绿）；页内那一半（A6/B5）**待验证** |
| 真桥给不给得出 `activeChatKey` / 切会话跟不跟 | **待验证** | A1/A2/B2 三格本轮没有实跑数；本轮只量到"这一拍真桥给的是 `null`"，两者不是同一句话 |
| Telegram 会话档 | **待验证** | 只到 fixture，P6 Task 12a 那条真机 DOM 链未做，本阶段不声称 TG 生效 |

## 前置分母（`tmp/p7b-prereq.mjs` 只读记录）

计划里这份驱动要打印三分母。本轮它**只走到第一道闸就按前置不成立退出**，原文一行：

```
BLOCKED(premise) 没有 ready 的 WhatsApp 桥（代理 / 登录态 / 主进程改过没重启） —— []
```

exit 2。`[]` 是它从 `window.__p6f.bridgeStates()`（渲染层那份桥缓存）读到的长度，**不是**"没有桥"——同一个瞬间从主进程现拉的 `msg:bridges` 是有值的（下面第 4 行）。所以 `分母②` / `分母③` 两行它没机会打印，本轮那两格的数取自 `tmp/p7b-step1-probe.mjs`（同一套只读判据：不写任何设置、不点任何页面、只读缓存/内嵌页 DOM/HTTP 端点），来源在表里逐行标出来。Node 在那次 `process.exit(2)` 之后另外吐了一行 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`——那是 Windows 上 libuv 的收尾噪声，不算第三种失败。

| # | 量到的东西 | 实跑值 | 来源 |
|---|---|---|---|
| 1 | 后端在跑 | `{"code":0,...,"dbVersion":"8.0.45"}`（`/api/health`） | p7b-step1-probe |
| 2 | 系统代理开着（`web.whatsapp.com` 出得去） | `ProxyEnable=1`、`ProxyServer=127.0.0.1:7892`；配合第 5 行的 `phase=ready` 一起读，才是"出得去且已登录"的闭环 | 注册表 + 桥帧 |
| 3 | 内嵌 WhatsApp 视图 target 存在且是登录态 | `https://web.whatsapp.com/`、`#pane-side` 存在 = `true`、QR 画布 0 颗、登录面板 `#app .drawings` = `false`、侧栏 `innerText` 非空（读出"@Jamensd (自己) 07:57 …"与"WhatsApp 星期二 …"两行以上）⇒ **已登录且列表在渲染**；但 `[role=listitem]` / `#pane-side div[title]` 都命中 0，那是 WA 当前构建下的选择器没跟上，本轮不据此说"列表是空的"。`#main` 不存在 = **此刻没有打开任何会话** | 视图只读 DOM（`tmp/p7b-wa-dom.mjs`，同套只读判据） |
| 4 | 渲染层桥缓存 | `[]`（`useLiveTailSync` 只 `setQueryData`、不是观察者，条目按 `gcTime` 被收走 → 见已知限制 3） | `__p6f.bridgeStates()` |
| 5 | 分母① 真桥帧（主进程现拉） | `[{viewId:acc-189d6520, accountId:7, platform:whatsapp, phase:ready, ready:true, activeChatKey:null}]` ⇒ ready 的 WhatsApp 桥 **1 条**，其中带 `activeChatKey` 的 **0 条** | `window.scrm.msg.bridges()`（应用自己开局用的那一条 IPC 拉取） |
| 6 | 分母② 账号 7 可用单聊 | **33 条**（键非空、≤128、且不是 `@g.us`）——数量本身够两棒；前 6 条里近 50 条消息含中文的 **4 条**（例：`8613800001001@c.us` 10 条中文，最近一条"你好，我想问下订单"） | `/api/conversations` + `/api/messages` |
| 7 | 分母③ 全局行 | `{"scope":"global","recv":"zh-CN","send":"en","channel":"1"}` ⇒ 会话档删干净之后，B7 那一行该看到 `global`（本轮没跑，记下来是给下一轮当参照） | `/api/translation/settings` |
| 8 | 开局有没有残留会话档 | 抽看的 3 条会话全是 `scope=global inherited=true recv=zh-CN`，无残留 | `/api/translation/settings?accountId&chatKey` |

Step 1 那三件事据此逐件判：

1. **代理 + WA 可达：成立**（表第 2、3、5 行）。
2. **dev app 是主进程改动之后起的：成立**。判据不是进程启动时刻与提交时刻比大小，而是**帧里有没有 `activeChatKey` 这一格**：那一格由 `bridgeStates()` 组装（`services/msgBridge/index.ts:77-82`，`21871e7` 引入，Task 6），旧构建根本不会带这个键，而表第 5 行现拉的帧里它确实在（值是 `null`，字段在）。渲染层那一侧另有一条形码：`tmp/p7a-stage-dialog.mjs` 本轮 44/44 要求 `[data-p7-stage-settings]` / `[data-p7-conv-dialog]` 在页上存在，那两个标记是 Task 9 的。
3. **该账号真的登录 + 两条单聊各有中文可看 + 第二棒要真人切会话：不成立**。登录是真的（表第 3 行）、会话数量是够的（表第 6 行），但**此刻视图里没打开任何会话**（`#main` 不存在），而页侧 `active_chat` 只有两处发布者、都是事件驱动（`bridge/whatsapp/collect.ts:78-92` 的 wa-js `chat.active_chat` 事件与 `open_chat` 命令回执；主进程那一支见 `services/msgBridge/index.ts:294-302`），本阶段没有驱动侧的 `open_chat` 通路（那是 P6 Task 12a，未做）。于是：A 棒的 A1 只会量到"这一拍没人切过会话"，B 棒的"切到另一条"更是要人在 A 棒之后亲手做。**这一件不成立就不开火**，按 Step 1 给的出口直接进 Step 5 记未验证。

## 逐步实测

### 后端（V9 行为证据 / `ConversationScopeKeyTest` + `ScopeSettingsTest` / `tmp/p7a-conv-settings.mjs`）

证据词一律 **实测**（本轮真跑，日志 `tmp/p7b-gate-java.log`、`tmp/p7b-gate-conv.log`）：

- `./mvnw test` → `Tests run: 63, Failures: 0, Errors: 0, Skipped: 0` + `BUILD SUCCESS`。其中 B16 新增的两份是 `ConversationScopeKeyTest` `Tests run: 8` 与 `ScopeSettingsTest` `Tests run: 4`（三档组合：conv 命中 → `conversation`+`inherited=false`；仅 cust → `customer`+`false`；只有 global → `global`+`true`）。
- `tmp/p7a-conv-settings.mjs` → `ALL PASS (29/29)  [brief 的 16 条 + extra 13 条；HTTP 往返 65 次]`。C14：计划推演写的是"那 16 条"，实跑是 29 条，多出来的 13 条是评审轮加的边界与"未越层"对照（`5a–5i` 八条闸与文案、`X1–X9` 的客户档/全局行逐列未变与分辨力对照、`X7` 的 `code` ⇔ HTTP 码全跑配对）。以实跑为准。
- 契约里三档语义的现场值（本轮日志）：`#2 会话档存在时 GET 读会话档（th），客户档那一份 hi 被压过`、`#4 POST /translate 带 customerId 仍按会话档出译文（两个入口同一条 resolve）`、`#8 同 text 两条会话（会话档 vs 客户档）→ cacheKey 不同`、`#6` 关到底仍出译文（§4①b 那条负面断言）。

**V9 的列宽没有直接证据**（本机无 mysql CLI，全程只走 HTTP API）。这一格不能写成"迁移成功"就完事，证据形态只有一条行为差异：

```
PASS | #1 只差大小写的两条会话档 → 两条行、两个值（unicode_ci 会撞成一条）
       actual:   id=257/258 key="7:P7A-7-CASE-UP@c.us"/"7:P7A-7-CASE-up@c.us" 读回="hi"/"vi"
```

同一账号下两条只差大小写的键拿到两个不同自增 id、读回两个不同值 ⇒ `scope_key` 那一列按大小写敏感存了两行（`V9` 改 `utf8mb4_bin` 的效果，读码）。宽度那一侧能拿到的最接近的证据是 `5g PUT chatKey 恰好 128 字符 → 接受 + 独立 GET 读回同一行` 与 `5b PUT chatKey 129 字符 → 40000`：**这两条断的是应用层那道闸与列宽同口径**（`shared/chatKeys.ts` 的 `activeChatKeyOf` 与 Java 侧同一上限，D-11），**不是** `SHOW CREATE TABLE` 里的 `VARCHAR(160)`。列宽数值本身维持 **读码**。

### 渲染层（`activeChatKeyOf` 9 条 + `scopeLabel` 18 条 + `directionDraft` 线路 2 条 / `tmp/p7a-stage-dialog.mjs` 六行）

- `pnpm --dir apps/desktop test:unit` → `pass 181`、`fail 0`（日志 `tmp/p7b-gate-unit.log`）。本轮按文件核对过归属：`shared/chatKeys.test.ts` 里 `activeChatKeyOf` 是 9 条（同文件另有 4 条属 P6 的群判定/号码形态），`lib/scopeLabel.test.ts` 18 条，`lib/directionDraft.test.ts` 6 条里"线路"那 2 条。
- `pnpm -r typecheck` → `apps/desktop` 四段（node/web/inject/unit）与 `packages/shared` 全 `Done`，无诊断输出。
- `node tmp/p7a-stage-dialog.mjs` → `ALL PASS (44/44)`（exit 0；本轮连跑两轮都是 44/44，日志 `tmp/p7b-gate-stagedialog.log`）。C14 要说白：**计划里这一行的推演分母是 32 条，实跑是 44 条**，多出来的是评审轮加的——`1e2`（反序那一帧确实换了渲染层手里那一格）与两种帧序各一遍的其余几条、`2.5a–c`（恢复失败与保存失败两条出口分得开）、`6a–c`（客户档弹层里没有线路那一格）、`1k–1n`（会话目标在点开那一刻冻住）。文档只收 44 这个数。

**A 档与 B 档要分开写**（C11），这六行两样都占：

- **A 档（手喂布景）**：桥帧由 `__p6f.setBridges` 手喂、会话档与客户档行由 HTTP 预先 PUT 出来。手喂的是"哪一帧在场"，不是行为。
- **B 档（真实行为）**：真实 `Input.dispatchMouseEvent` / `dispatchKeyEvent` 点开的下拉与保存按钮、真实 `PUT`/`DELETE` 落到 `smartscrm_react`、后端按同一 `accountId`+`chatKey` 读回。
- **这六行覆盖到的**：禁用链两种坏法分不分得开、多账号时按 `accountId` 筛哪一帧（变异验过：去掉筛账号那半条，驱动以 41/44 收场，见 spec §8）、弹层显示与冻结的是哪条会话、改动写到的是哪一档、缓存按 `accountId+chatKey` 分键所以两档不互铺、开关位不级联到全局/客户行。
- **这六行没覆盖的**：**真桥会不会给出 `activeChatKey`**、给的键与 `chat_conversation.chat_key` 同不同源、切会话之后它跟不跟着换。这三格分别只有 A1、A2、B2 能回答，而它们属真实登录档，本轮未跑。所以 44/44 不能写成"真桥已验"。

### 真实登录档（`tmp/p7b-live.mjs` A 棒 6 条 / B 棒 7 条，两棒之间由人切会话）

**本轮未跑：两棒都没有开火**，所以下表没有实跑数，6 与 7 只是计划里的分母形状（不是得分）。驱动已按计划落到 `tmp/p7b-live.mjs`（gitignore，不入库），下一轮真人在场时按 `--a` → 真人切到同账号另一条会话 → `--b` 两棒跑，A5 写进真实会话的那一行由 B6 删回继承、B7 断回落。

| 行 | 要断的东西 | 本轮 | 证据词 |
|---|---|---|---|
| A1 | 真桥给得出 `activeChatKey`（Task 10 的桥帧是手喂的，这一格第一次要由真桥回答） | 未跑 | 待验证 |
| A2 | 桥报的键与 `chat_conversation.chat_key` 同源 | 未跑 | 待验证 |
| A3 | 舞台那颗「会话设置」在真桥下亮着（禁用链的反面） | 未跑 | 待验证 |
| A4 | 弹层显示的就是桥给的那条会话，五格下拉齐 | 未跑 | 待验证 |
| A5 | 真实点击保存写进会话档那一行（后端按同键读回） | 未跑 | 待验证 |
| A6 | 页内那一笔 `translate-api` 的 `res.scope=conversation` 且 `toLangCode` 就是刚选的语种 | 未跑 | 待验证 |
| B1 | 人切过去的那条也在 `chat_conversation` 里 | 未跑（且前置是真人动作） | 待验证 |
| B2 | 弹层跟着换到 B（渲染层读的是桥的新键） | 未跑 | 待验证 |
| B3 | 两条会话各一行、互不覆盖 | 未跑 | 待验证 |
| B4 | 同一句原文在两档下按各自语种解析（**后端直发，不经过注入层，不算页内证据**） | 未跑 | 待验证 |
| B5 | 页内在屏的 B 会话按它自己那一档出译文 | 未跑 | 待验证 |
| B6 | 两条真会话各删一行（`cleared` 各 1） | 未跑 | 待验证 |
| B7 | 删掉后回落到它下面那一档（现值参照上面分母③：`global`） | 未跑 | 待验证 |

一句必须留档的分辨：**本轮量到的是"这一拍真桥给的是 `null`"，不是"真桥给不出键"**。前者是当场的一个值（表第 5 行，实测），后者的成因（`active_chat` 纯事件驱动、视图没有打开任何会话、驱动不能替 WhatsApp 切会话）是读码。把这两句混起来写，就等于把"没测到"写成"测不了"——那正是 A1 要作为断言而不是前置的理由。

**生效面 ①（内嵌页气泡）的证据词按 Step 5 第 3 条定**：A6 与 B5 都绿才写"实测"；只绿到 A5/B4 写"读码 + 部分实测，页内语种切换仍待验证"；**一棒都没跑就保持 spec §8 的原话**，即 §4① 仍是"读码成立"。本轮落最后一格。特别记一句口径：不拿 B4 那类在线 HTTP 对照（`POST /api/translation/translate` 直发）冒充页内证据——它不经过注入层，证明的是解析链按会话分岔，不是气泡跟着会话变；页内那一半只由 A6/B5 承担。

**TG 一行**：会话档在 Telegram 上只能到 fixture（P6 Task 12a 未做），本阶段不声称 TG 生效（spec §8 已知验证缺口）。证据词：**待验证**。

## 已知限制（≥3）

1. **会话档的开关位在页内不生效**（D-09）：用户在会话 A 关掉接收翻译、会话 B 开着，页内实际只有一份进程级 flags（来源全局行）。回复框那一侧会跟着会话档变（它读的就是生效行），页内那一侧不会——同一屏两种表现，是设计边界不是 bug。
2. **桥掉线后 `activeChatKey` 归 `null`，会话档不级联删除**：重连后同键命中；期间那颗「会话设置」按钮是灰的。切会话事件没到位的那一拍仍可能按上一个会话解析一次（P6 已知限制 3 的同一口径，会话档上线后不影响它成立）。
3. **渲染层那份桥缓存没有观察者续命，真实登录档的驱动开局会读到 `[]`**（本轮实测）：`lib/liveTailSync.ts:304-317` 的注释就是这件事的另一面——写缓存的 `useLiveTailSync` 只用 `setQueryData`、不是这条 query 的观察者，条目按 `gcTime`（默认 5 分钟）被收走；dev 探针 `__p6f.bridgeStates()` 读的正是这一格。应用自己不受影响（`useBridgeOf` 一挂载就 refetch），但 `tmp/p7b-prereq.mjs` / `tmp/p7b-live.mjs` 在应用空闲几分钟后跑就会按"没有 ready 的桥"退出，报的是缓存而不是桥。下一轮跑之前先让页面重新一拉（开一次舞台或选一条会话），或按本轮那样直接读 `msg:bridges` 现拉值做对照；这不是应用缺陷，是驱动前置的口径。
4. **V9 的列宽没有直查证据**（本机无 mysql CLI、验收只走 HTTP）：能给的只有"大小写两条键存成两行"与"128 接受 / 129 拒绝"这两条行为差异，`VARCHAR(160)` 与 `utf8mb4_bin` 本身维持读码。
5. **真实登录档整档未跑**：§4① 本轮维持"读码成立"，A1/A2/B2 那三格（真桥给不给键、键同不同源、切会话跟不跟）本轮无证据。跑它的前置不是"再点一次运行"，是一次真人切会话的动作。

## 交付与提交范围

- 本次提交**只有两份文档**：本文与 `docs/superpowers/specs/2026-09-25-conversation-settings-design.md`（§8 只补"真实登录档未跑原因"与验收文档指向，§4① 的证据词维持原样；§10 裁定表未重开）。零 shipped-code 变更。
- `tmp/p7b-prereq.mjs`、`tmp/p7b-live.mjs`、`tmp/p7b-step1-probe.mjs`、`tmp/p7b-wa-dom.mjs` 与本轮四份闸门日志（`tmp/p7b-gate-*.log`）都在 gitignore 的 `tmp/` 下，不进提交；`tmp/p7b-live-state.json` 未产生（A 棒没跑）。
- `docs/notes/2026-09-22-legacy-feature-gap.md` 按仓库约定不入库。
- **push 由用户手动执行，助手不 push。**
