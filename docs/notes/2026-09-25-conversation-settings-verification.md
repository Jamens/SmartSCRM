# P7 / B16 会话级设置 · 验收结论

日期：2026-09-26 · 关联：`docs/superpowers/specs/2026-09-25-conversation-settings-design.md` · 计划：`docs/superpowers/plans/2026-09-25-conversation-settings.md`

> 本文只记本项目的实测口径。驱动都在 `tmp/`（gitignore，不入库），断言均为当场真跑的数；未跑的行如实标 blocked / 待验证，不合并成"全绿"。

## 总体结论（不是"全部通过"）

Task 1–10 的机械面本轮在 HEAD `314577f` 之上**全部复跑并绿**：Java 单测、后端 HTTP 契约、TS 单测、typecheck、渲染层 CDP 六行（同日 F1 那一棒把它扩成七行，数在下面按各自的跑记）。Task 11 自己那一步要的那格证据——**真桥到底会不会给出 `activeChatKey`、给了会不会跟着 WhatsApp 里的切会话走**——本轮**未跑**：Step 1 的第三件前置不成立（现场没有真人可以在 WhatsApp 里切会话，而两棒的结构就是"第二棒要人在 A 棒之后手动切过去"），所以 `tmp/p7b-live.mjs` 一棒都没开火。

于是各处证据词按下面这样定，不往上抬：

| 面 | 本轮证据词 | 一句话 |
|---|---|---|
| 后端三级解析 / 写侧分派 / 边界闸 | **实测** | `./mvnw test` 68 条（63 条到 F4 收口为止，`TranslationServiceRaceTest` 那 5 条是复评自查后补的）+ `tmp/p7a-conv-settings.mjs` 32 条（F2 加了真并发那两行、F4 补上客户档那一支的同形并发，见"后端"一节），全在真库 `smartscrm_react` 上跑 |
| V9 那一次列宽变更 | **读码 + 行为实测** | 列宽本身无直查证据（本机无 mysql CLI），能拿到的只有"只差大小写的两条键存成两行"这一条行为差异，见下节 |
| 渲染层三档生效面（禁用链 / 冻结目标 / 写回哪一档 / 缓存分键 / 徽标所指那位客户） | **实测（布景为 A 档手喂）** | `tmp/p7a-stage-dialog.mjs` 七行 58 条全绿（F1 那一棒把驱动从六行 44 条扩到七行，加了行 7 与它的夹具）；它证的是"渲染层读对了那两个字段"，**不**证"真桥会不会给值" |
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
2. **dev app 是主进程改动之后起的：成立**。判据不是进程启动时刻与提交时刻比大小，而是**帧里有没有 `activeChatKey` 这一格**：那一格由 `bridgeStates()` 组装（`services/msgBridge/index.ts:77-82`，`21871e7` 引入，Task 6），旧构建根本不会带这个键，而表第 5 行现拉的帧里它确实在（值是 `null`，字段在）。渲染层那一侧另有一条形码：`tmp/p7a-stage-dialog.mjs` 的每一次跑（本棒记的 44/44 与 F1 之后的 58/58，见"渲染层"一节）都要求 `[data-p7-stage-settings]` / `[data-p7-conv-dialog]` 在页上存在，那两个标记是 Task 9 的。
3. **该账号真的登录 + 两条单聊各有中文可看 + 第二棒要真人切会话：不成立**。登录是真的（表第 3 行）、会话数量是够的（表第 6 行），但**此刻视图里没打开任何会话**（`#main` 不存在），而页侧 `active_chat` 只有两处发布者、都是事件驱动（`bridge/whatsapp/collect.ts:78-92` 的 wa-js `chat.active_chat` 事件与 `open_chat` 命令回执；主进程那一支见 `services/msgBridge/index.ts:294-302`），本阶段没有驱动侧的 `open_chat` 通路（那是 P6 Task 12a，未做）。于是：A 棒的 A1 只会量到"这一拍没人切过会话"，B 棒的"切到另一条"更是要人在 A 棒之后亲手做。**这一件不成立就不开火**，按 Step 1 给的出口直接进 Step 5 记未验证。

## 逐步实测

### 后端（V9 行为证据 / `ConversationScopeKeyTest` + `ScopeSettingsTest` / `tmp/p7a-conv-settings.mjs`）

证据词一律 **实测**（Task 11 那一轮真跑的日志是 `tmp/p7b-gate-java.log`、`tmp/p7b-gate-conv.log`；同日 F2/F4 两个修复轮各在下面的条目里点名自己的工件）：

- `./mvnw test` → `Tests run: 63, Failures: 0, Errors: 0, Skipped: 0` + `BUILD SUCCESS`。其中 B16 新增的两份是 `ConversationScopeKeyTest` `Tests run: 8` 与 `ScopeSettingsTest` `Tests run: 4`（三档组合：conv 命中 → `conversation`+`inherited=false`；仅 cust → `customer`+`false`；只有 global → `global`+`true`）。
- `tmp/p7a-conv-settings.mjs` → `ALL PASS (29/29)  [brief 的 16 条 + extra 13 条；HTTP 往返 65 次]`。C14：计划推演写的是"那 16 条"，实跑是 29 条，多出来的 13 条是评审轮加的边界与"未越层"对照（`5a–5i` 八条闸与文案、`X1–X9` 的客户档/全局行逐列未变与分辨力对照、`X7` 的 `code` ⇔ HTTP 码全跑配对）。以实跑为准。
- 契约里三档语义的现场值（本轮日志）：`#2 会话档存在时 GET 读会话档（th），客户档那一份 hi 被压过`、`#4 POST /translate 带 customerId 仍按会话档出译文（两个入口同一条 resolve）`、`#8 同 text 两条会话（会话档 vs 客户档）→ cacheKey 不同`、`#6` 关到底仍出译文（§4①b 那条负面断言）。
- **F2 修复轮（同日，改动落在 `7fafe4e` 与 `fc72dc1` 两个提交上，本次实跑跑的就是这两处的内容）**：驱动加两行后 `ALL PASS (31/31)  [brief 的 16 条 + extra 15 条；HTTP 往返 70 次]`，exit 0（`tmp/p7a-f2-conv-run2.log`）。新增的是真并发那一格与它的清理对照：
  - `X10`：同一条从未建过档的会话，两个 `PUT` 用 `Promise.all` 同时发出 ⇒ 两边都 `code:0` + HTTP 200，且两边报的是**同一行 id**（现场 `id=325`）。这一条不是幂等检查——两发都要真进过 create 分支才算竞态，判据在第二通道：`tmp/p7-server.log` 里这个 scopeKey 有**两条** `TranslationSettingMapper.insert`（14:45:29.787 / .788，线程 exec-8 / exec-5，两条前面各自的 `LIMIT 1` 都读到 `Total: 0`），随后失败那支的 `LIMIT 1 FOR UPDATE` 读到 `Total: 1`，两支的 `updateById` 都以 `325(Long)` 结尾。
    同一形状在本日四次连跑（14:36 / 14:40 / 14:45 三跑由实施席，14:55:36 那一跑由评审席独立复跑，行 id 312 / 318 / 325 / 332）里每次都出现两发 insert ⇒ 撞键那一支不是靠运气命中的单次事件。第四跑的日志是 `tmp/p7a-f4-review-run.log`（`ALL PASS (31/31)`，那次驱动还是 31 行）。
  - `X11`：清理网对那一键回 `cleared:1`，即"这一键名下确实只有一行"。它单列而不并进收尾1 的聚合，因为收尾1 只断每条键各清各的。
  - 这两行抓到过一次真的坏行为：M-3 的初版写成"撞键后用快照读 `settingRow` 重读"，第一跑 `29/31` exit 1， loser 回的是 `HTTP=400 code=40901`（`tmp/p7a-f2-conv-run1-40901.log`）。根因与修法见提交 `fix(P7/B16): F2·M-3 …`：REPEATABLE READ 下本事务的普通 SELECT 读的是快照，撞键之后仍然看不见对手刚提交的那一行，只有 `FOR UPDATE` 是当前读。`X7` 的配对表因此加了一格 `[40901, 400]`——记的是重试臂的形状，不是用来消红的。
  - `X10` 只证后端解析链在真并发下不串档，**不**证"两个窗口同时点保存"这条 UI 路径；后者要真实登录档那一棒（见下）。
- **F4 收口轮（同日，评审推翻当时的 R-22：客户档那一支与会话档同形的"先查后插"不能只修一处）**：两支现在共用同一个私有口子 `insertOrAdopt`，驱动再加一行后 `ALL PASS (32/32)  [brief 的 16 条 + extra 16 条；HTTP 往返 75 次]`，exit 0（`tmp/p7a-f4-conv.log`，15:16:53）。同轮 Java 侧改后再跑仍是 `Tests run: 63, Failures: 0` + `BUILD SUCCESS`（日志 `tmp/p7a-f4-mvnw-test.log`；F2 那一轮的 63 只留在 `apps/server/target/surefire-reports/` 里，没另存 tmp 工件——这是当时记漏，不是没跑）。
  - `X10c`：同一位**开跑前没有覆盖行**的客户（本跑选到 `id=43`；候选取 `GET /api/customers` 里 `CUST` 之外的全部，逐个用 `inherited:true` 现场判"这一档还没行"，一位都没有则按前提不成立退 2，不设"跳过"分支），两个 `scope=customer` 的 `PUT` 用 `Promise.all` 同时发出 ⇒ 两边都 `code:0` + HTTP 200、同一个 `data.id`（现场 `id=341`）、`scopeKey` 都是 `"43"`；独立 GET 读回落在这位客户自己那一行（`scope=customer`、`inherited=false`、`sendToLang="id"` ∈ 两提交值）；随后的清理 `DELETE` 回 `cleared:1`（那一键名下只有一行）。
  - 第二通道同一套判据（`tmp/p7-server.log`）：`exec-2` / `exec-4` 两支各自的 `LIMIT 1` 都读到 `Total: 0`，15:16:53.239 两发 `INSERT … 1(Long), customer(String), 43(String)` 都发了出去，`exec-2` 先 `Updates: 1`；`exec-4` 在 15:16:53.250（约 11ms 后）发出带 `FOR UPDATE` 的当前读、读到 `Total: 1`，两支的 `updateById` 随后都以那一行收尾。会话档与客户端那一支在同一跑里各留了一条 `FOR UPDATE`（15:16:53.204 / .250），所以"当前读真的被走到"这一格现在是两档各有一份现场值，不是只有一份。
  - `X10c` 与 `X10` 一样，**只证解析链在真并发下不串档**，不证"同一个人在客户抽屉与记录页会话头两处同时点保存"这条 UI 路径。
- **F4 复评自查（同日更晚，`10465c1` 之后）**：上面那支"≥3 发会死锁"的兜底**写错了位置**——`ConcurrencyFailureException` 的兄弟 catch 罩不住 `catch (DuplicateKeyException)` **体内**抛出的异常，而死锁恰恰发生在体内那发 `FOR UPDATE` 上（各支持着重复键记录的 S 锁、再互相要 X 锁）。也就是说：那一格坏法没被消掉，仍会冒成 50000。这一格用真库凑不出来，所以补了第一份 mock 版单测 `TranslationServiceRaceTest`（5 条，把 mapper 桩的异常形状喂进那四条出口）——**先红后修**：新增那次"当前读被选为牺牲者"的用例在修之前就是 `Unexpected exception type thrown, expected BizException but was DeadlockLoserDataAccessException`，修之后 5 条全绿。
  - 修完按 C8 重建重启（`tmp/p7a-f4fix-package.log` → jar 16:08 → `tmp/p7-server.log`，PID 24632），契约驱动在新 jar 上复跑仍是 `ALL PASS (32/32)`、exit 0、HTTP 往返 75 次（`tmp/p7a-f4fix-conv.log`，16:08:46）。这一跑的现场值：会话档那一行 `id=357`（两边 200 + 同 id，读回 `sendToLang="vi"`）、客户档那一行 `id=359`（`scopeKey="43"`，读回 `inherited=false` / `sendToLang="id"`、清理 `cleared:1`）。第二通道在同一份日志里两档各留一份：`16:08:46.415` 两支对 `conversation / 7:P7A-7-RACE@c.us` 各发一发 `INSERT`，`16:08:46.528` 撞键那支发 `... LIMIT 1 FOR UPDATE`；`16:08:46.565` 两支对 `customer / 43` 各发一发 `INSERT`，`16:08:46.577` 撞键那支发 `FOR UPDATE`（本跑 `LIMIT 1 FOR UPDATE` 共 2 条，正是这两处）。
  - Java 侧从这一跑起是 **68 条**（`./mvnw test` → `Tests run: 68, Failures: 0, Errors: 0` + `BUILD SUCCESS`，日志 `tmp/p7a-f4fix-mvn-test.log`）：63 是 F4 之前的数，`TranslationServiceRaceTest` 那 5 条是本次加的。

**V9 的列宽没有直接证据**（本机无 mysql CLI，全程只走 HTTP API）。这一格不能写成"迁移成功"就完事，证据形态只有一条行为差异：

```
PASS | #1 只差大小写的两条会话档 → 两条行、两个值（unicode_ci 会撞成一条）
       actual:   id=257/258 key="7:P7A-7-CASE-UP@c.us"/"7:P7A-7-CASE-up@c.us" 读回="hi"/"vi"
```

同一账号下两条只差大小写的键拿到两个不同自增 id、读回两个不同值 ⇒ `scope_key` 那一列按大小写敏感存了两行（`V9` 改 `utf8mb4_bin` 的效果，读码）。宽度那一侧能拿到的最接近的证据是 `5g PUT chatKey 恰好 128 字符 → 接受 + 独立 GET 读回同一行` 与 `5b PUT chatKey 129 字符 → 40000`：**这两条断的是应用层那道闸与列宽同口径**（`shared/chatKeys.ts` 的 `activeChatKeyOf` 与 Java 侧同一上限，D-11），**不是** `SHOW CREATE TABLE` 里的 `VARCHAR(160)`。列宽数值本身维持 **读码**。

**V9 的回滚代价**（记下来，是为了别把这次变更当成"随时可退"）：

1. Flyway 社区版没有 undo 迁移——`V9` 一旦 apply 过，就不存在一条自动往回走的路径。
2. 宽度收回 `VARCHAR(64)` 在数据到位之后是**结构性做不到**的：会话档键的形状是 `accountId ≤ 19 位 + ':' + chatKey ≤ 128`（V9 注释里那条算式，上界 148），只要库里存在一条超过 64 字符的键，任何改窄的 DDL 都会在那一行上失败——**前提是 strict `sql_mode`**（MySQL 8 默认带 `STRICT_TRANS_TABLES`；本机没有直查该变量的通道，这一句按默认值说，属**读码**）。非严格模式下改窄不报错而是**静默截断**，那比失败更糟：两条不同的键会截成同一条，再撞唯一键。所以回滚只有两条路：**恢复备份**，或先删掉 `scope='conversation'` 那些行、再上一条 V10 去改列。
3. 排序规则那一侧要分两个方向说。**往前（V9 本身）不是数据完整性风险**：表默认是 `utf8mb4_unicode_ci`，而唯一键 `uk_tset_tenant_scope` 里"只差大小写的两条键"在那套判等下本来不可能同时存在，所以把这一列改成 `utf8mb4_bin`（判等更严、允许并存的行更多）不会让任何既有行突然变成重复。**往后（改回 `ci`）则是另一道硬拦**：一旦库里真并存了两条只差大小写的会话档键，`bin → ci` 的那次 `ALTER` 会在唯一键上直接报 `Duplicate entry` 而失败。所以宽度与判等各是一道独立的拦条——要回到 V9 之前，得先把超宽的键和只在大小写上不同的键对都清掉。
4. `MODIFY COLUMN` 带排序规则变更是 copy-table 重建，期间该表写入阻塞。**代价小的理由是行数，不是"ALTER 本身便宜"**，而行数由键数决定：`uk_tset_tenant_scope` 限的是"每一档**每一键**最多一行"，所以这张表的行数 = 各档键数之和——global 每租户一行、customer 每位建过档的客户一行、**conversation 每条建过档的会话一行**（一次契约跑就在同一租户、同一 `scope='conversation'` 下铺开多条：本轮实测 ACCT 名下登记 9 条键、其中 5 条真落库并各删回 `cleared:1`；F2 那一跑是 6 条）。当前量级：到本文最后那一跑（16:08:46）为止，`X10c` 建出的那行自增到了 `id=359`（同一跑里 15:16 那一跑是 341），而 `id` 是 `AUTO_INCREMENT`（`V5` 的 DDL，MySQL 8 的重启也不回退），所以"插入尝试次数 ≥ 359、现存行数 ≤ 359"，几百行以内 ⇒ 这次重建便宜。**这一格没有 `COUNT(*)` 可查**（本机无 mysql CLI、验收只走 HTTP），用的是自增 id 给的上界：它只大不小，所以是个**单调变松**的界，跑得越多越不准，别把它当现值。**会话档真被用起来之后"便宜"这一句就不再成立**：届时要么接受一次写阻塞窗口，要么先按上面第 2 条删行再改。

### 渲染层（`activeChatKeyOf` 9 条 + `scopeLabel` 18 条 + `directionDraft` 线路 2 条 / `tmp/p7a-stage-dialog.mjs` 七行）

- `pnpm --dir apps/desktop test:unit` → `pass 181`、`fail 0`（Task 11 那一轮记在 `tmp/p7b-gate-unit.log`；F4 收口轮重跑仍是 181/0）。本轮按文件核对过归属：`shared/chatKeys.test.ts` 里 `activeChatKeyOf` 是 9 条（同文件另有 4 条属 P6 的群判定/号码形态），`lib/scopeLabel.test.ts` 18 条，`lib/directionDraft.test.ts` 6 条里"线路"那 2 条。
- `pnpm -r typecheck` → `apps/desktop` 四段（node/web/inject/unit）与 `packages/shared` 全 `Done`，无诊断输出（Task 11 与 F4 两轮各一次）。
- `node tmp/p7a-stage-dialog.mjs` → 六行那一版 `ALL PASS (44/44)`（exit 0；本轮连跑两轮都是 44/44，日志 `tmp/p7b-gate-stagedialog.log`）。C14 要说白：**计划里这一行的推演分母是 32 条，实跑是 44 条**，多出来的是评审轮加的——`1e2`（反序那一帧确实换了渲染层手里那一格）与两种帧序各一遍的其余几条、`2.5a–c`（恢复失败与保存失败两条出口分得开）、`6a–c`（客户档弹层里没有线路那一格）、`1k–1n`（会话目标在点开那一刻冻住）。
- **F1 那一棒（同日）把驱动扩到七行 58 条**：新增行 7 = 建/关联客户之后，回复框那颗开关写的就是**徽标所指的那一位**客户（夹具由该行自己合成一条会话，不消耗真实会话）。实跑 `ALL PASS (58/58)`、exit 0，日志 `tmp/p7a-t10-row7.log`（14:16；同批还有 run1…run4 四份）。**这一格的跑记归 F1 那一席**：本席没有重跑它——重跑要 CDP 与一个"主进程改动之后起的"应用窗口，而 M-2/F4 之后那个窗口需要用户重启主进程（那是用户的手）。所以 58/58 证的是 `314577f` + F1 的那一版，**早于** F2 的 M-2 主进程改动；M-2 只改主进程两条实时帧的赋值表达式，不经渲染层，覆盖它的是同轮的 typecheck / 181 条单测 / `pnpm --filter desktop build`。
- **行 2 下拉那一格的判据本身被反证过**（M-9，日志 `tmp/p7a-t10-m9probe.log`，11:44，`EXIT=1` 是那一跑设计成那样的，不是没跑完）：三腿各证一件事——`old` 判据（"全文档数到 0"）碰上别人留下的残留 → **假红复现**，红在判据上；`new` 判据（回到本次点选开始前的基线计数）碰同一种残留 → 不红；`new` 判据碰上**本应用自己没退场的浮层** → 仍以**计数过的断言失败**红（exit 1，不是 exit 2 的"前置不满足"）。那份"别人留下的残留"是人造的（屏幕外、无子节点、`pointer-events:none` 的一份 closed `select-content`），它吃不到任何命中测试，所以那一腿只要红，原因只可能在判据。这一格留下的结论不变：浮层退场期间仍吃命中测试，按 spec §10 D-12 记为应用侧已知缺陷，B16 不改。

**A 档与 B 档要分开写**（C11），这几行两样都占：

- **A 档（手喂布景）**：桥帧由 `__p6f.setBridges` 手喂、会话档与客户档行由 HTTP 预先 PUT 出来。手喂的是"哪一帧在场"，不是行为。
- **B 档（真实行为）**：真实 `Input.dispatchMouseEvent` / `dispatchKeyEvent` 点开的下拉与保存按钮、真实 `PUT`/`DELETE` 落到 `smartscrm_react`、后端按同一 `accountId`+`chatKey` 读回。
- **这几行覆盖到的**：禁用链两种坏法分不分得开、多账号时按 `accountId` 筛哪一帧（变异验过：去掉筛账号那半条，驱动在 44 条那一版上以 41/44 收场，见 spec §8）、弹层显示与冻结的是哪条会话、改动写到的是哪一档、缓存按 `accountId+chatKey` 分键所以两档不互铺、开关位不级联到全局/客户行，以及行 7 那一格"界面建客户 + 关联之后，落下来的客户档那一行就是徽标所指的那一位"。
- **这几行没覆盖的**：**真桥会不会给出 `activeChatKey`**、给的键与 `chat_conversation.chat_key` 同不同源、切会话之后它跟不跟着换。这三格分别只有 A1、A2、B2 能回答，而它们属真实登录档，本轮未跑。所以 58/58 不能写成"真桥已验"。

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
6. **全局行 `requireSettings` 那一支仍是"先查后插"**（F4 裁定：刻意不修，记下来）：它被**读路径**（`GET /settings` / `POST /translate`）也调用，而那两个入口没有 `@Transactional`，那一次 `insert` 跑在 autocommit 里——既没有"撞键后在本事务内改用当前读"的前提，也不该为了这一格给 GET 加事务。它只在"该租户的第一条全局行"时可达，而现网 DEMO 租户那一行由 `V5` 末尾的种子建好（读码）。真撞上的话就是 50000 + 重试，与会话档/客户档修前的形状同级。
7. **≥3 发同一毫秒首存同一键，仍可能被 InnoDB 选为死锁牺牲者**：两支都会在重复键错误上持住那条记录的 S 锁、再各自要 `FOR UPDATE` 的 X 锁，S→X 升级是经典死锁形状；被选中的那支**整个事务**已被 InnoDB 回滚，所以 `insertOrAdopt` 里把 `ConcurrencyFailureException` 挡成 40901 + 请重试，而不是并进撞键那一支继续写。它挡在**两个位置**（`insert` 那一发自己等锁超时；撞键之后那次当前读被选为牺牲者），因为 Java 的兄弟 catch 罩不住兄弟体内抛出的异常——只写外面那一支等于没挡死锁这一格，这是 F4 复评自查发现自己上一版写错的地方。真库那一格**未被实跑触发**（两发不死锁：五次会话档 + 两次客户档的实测里，loser 都只在 `insert` 上等约 10ms 后拿到重复键），InnoDB 真会这么走属**读码**；出口的**形状**（哪一种 DAO 异常 → 哪一个业务码）有单测钉住，见限制 10。
8. **`X10` / `X10c` 的"两发真的并发了"那一半是人工判据**：驱动只断两边 200 + 同一行 id + `cleared:1`。若后端把两发串行了，第二发走的是正常更新路径，两条照样全绿——所以那一半只能从 `tmp/p7-server.log` 里"同一 scopeKey 有两条 insert"读出来（人工）。没有第三条通道可用：驱动自己去读 `tmp/` 或 `target/` 会把契约验证绑到本机文件布局上。
9. **`M-2`（两条实时帧也过 `activeChatKeyOf`）的行为差异面要分两半说**：未读判定与落库结果**无可观察差异**（`chat_key` 入库前有 `ChatKeys.matchesPlatform` 与 `@Size(max=128)` 两道闸，库里的值永远良构，裁剪只影响非成形值）；非成形值那一格的**批次划分会合并**——旧版 `acct|坏值` 与 `acct|` 是两个桶，新版都归到后者，于是一次 `POST /messages/batch` 替代两次，每行仍带着自己的 `chatKey` 入库。两半都是**读码**，不是实测。
10. **`TranslationServiceRaceTest` 是本项目第一份用 mock 的后端单测，它钉的只有"异常形状 → 业务码"这一格**：桩喂的是 `DuplicateKeyException` / `DeadlockLoserDataAccessException` / `CannotAcquireLockException`，所以它**不**证明 MySQL 会抛这些异常、**不**证明撞键那一支发的真是 `LIMIT 1 FOR UPDATE`（尾串要 MP 的 lambda 列缓存才解析得动，离线环境没有）、也**不**证明两发真的并发了。前两者的真凭据仍是服务端日志里的 SQL 原文与那两发 `INSERT`，即限制 8 那条人工判据。为这一格把 `insertOrAdopt` 从 `private` 放宽到包私有——除这一处之外本仓的服务类没有为测试放宽过可见性。

## 交付与提交范围

- 本次提交**只有两份文档**：本文与 `docs/superpowers/specs/2026-09-25-conversation-settings-design.md`（§8 只补"真实登录档未跑原因"与验收文档指向，§4① 的证据词维持原样；§10 裁定表未重开）。零 shipped-code 变更。
- 上一句的"零 shipped-code"只界定 **Task 11 收官那一次提交**，不覆盖同日的 F2 / F4 两个修复轮。F2 那一轮改了源码，落库四个提交——`refa:`（M-1/M-2/M-4/M-5/M-6：键成形处与活动会话出口各归一、两份单测的指针改指提交物）、`fix:`（M-3：会话档首存撞键改走 `FOR UPDATE` 当前读）、`update:` × 2（本文的 V9 回滚段与 F2 实跑数，以及随后把现场值对齐到被引用那份日志的一次更正）。
- **F4 收口轮（本轮，评审席推翻当时的 R-22）** 落四个提交，两组"源码 + 文档"：
  - 第一组——`fix:`（会话档与客户档两支首存合并成同一个 `insertOrAdopt`，加一支 `ConcurrencyFailureException` → 40901；三份注释的因果/清单/指针改正：`TranslationService` 的 `winner == null` 那一支与 `settingRowForUpdate` 的锁范围、`chatKeys.ts` 的"四个出口"、两份单测指针的"按类别列出"）+ `update:`（本文的 I-1 假前提、N-6/N-7 的工件与跑数、F4 的 `X10c` 现场值、已知限制加到 9 条）。
  - 第二组是这一组自己留下的坏法被复评自查抓到之后补的——`fix:`（那支 `ConcurrencyFailureException` 的**位置**：死锁发生在撞键体内那次当前读上，兄弟 catch 罩不住，于是一整格 50000 没被消掉；改法是当前读那一发单独套一层同码出口，并加本仓第一份 mock 单测 `TranslationServiceRaceTest` 5 条，先红后修）+ `update:`（本文：后端一节加 F4 复评自查那三小条、Java 侧从 63 到 68、已知限制加到 10 条）。
  - 评审席点名的另一处同类指针 `service/provider/TencentProvider.java:23` **不在本批清**：它指的那条探针事实（腾讯 `InvalidAction`）目前没有任何提交物记录，删掉就等于让那句结论没有出处——先补出处再删指针，那是 P5 文档的一次独立收口。
- 三轮的驱动行（F2 的 `X10`/`X11`、F4 的 `X10c`）同样只在 gitignore 的 `tmp/` 下；契约与闸门日志 `tmp/p7a-f2-conv*.log`、`tmp/p7a-f4-conv.log`、`tmp/p7a-f4fix-conv.log`、`tmp/p7a-f4-mvnw-test.log`、`tmp/p7a-f4fix-mvn-test.log`、`tmp/p7a-f4fix-package.log`、`tmp/p7a-f4-review-run.log` 与 `tmp/p7-server.log` 一并如此。
- `tmp/p7b-prereq.mjs`、`tmp/p7b-live.mjs`、`tmp/p7b-step1-probe.mjs`、`tmp/p7b-wa-dom.mjs` 与本轮四份闸门日志（`tmp/p7b-gate-*.log`）都在 gitignore 的 `tmp/` 下，不进提交；`tmp/p7b-live-state.json` 未产生（A 棒没跑）。
- `docs/notes/2026-09-22-legacy-feature-gap.md` 按仓库约定不入库。
- **push 由用户手动执行，助手不 push。**
