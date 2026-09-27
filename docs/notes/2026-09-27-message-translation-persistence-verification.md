# 消息级译文回显 + 降级可见重试 · 验收记录

**日期**：2026-09-27
**规格**：`docs/superpowers/specs/2026-09-27-message-level-translation-persistence-design.md`
**计划**：`docs/superpowers/plans/2026-09-27-message-level-translation-persistence.md`
**提交区间**：起点 `ebf89fa`（spec/计划落档），到本提交为止；逐提交枚举 `git log --oneline ebf89fa..HEAD`
（其中 G1 修复轮 = `cb6aa6a` + `8a4eb3c`，G2 回评轮 = `b92fc4f` 及本提交）
**证据词口径**：实测 = 本轮真跑过并读到输出；读码 = 只从源码得出；推断 = 由环境事实推出；待验证 = 没跑过，不当结论用。
**本轮（真实登录视图那一跑）只动文档与 `tmp/` 驱动，无产品代码改动**；§4b/§4c/§5 的新增结论都各自带了现场日志文件名。

---

## 1. 四档总览

| 档 | 覆盖什么 | 结论 | 证据词 |
| --- | --- | --- | --- |
| 后端契约 | `/translate` 的消息级回显、成功回写、懒填 `msg_id`、降级永不回写 | 35/35 全绿（exit 0） | 实测 |
| 后端契约·发出方向 | `msg_key` 尾带 `_out` 的发出行按消息定位、回写、再回显（含收侧不回归、尾锚是字面下划线） | 7/7 全绿（exit 0）；修复前同一驱动 O2 必红、加锚前后 O7 必红（见 §2b） | 实测 |
| 单测（Java + node:test） | 迁移后服务行为、消息级三条不变量、纯函数（`normalizeWa` 产 msgId、`translateKey` 计入 msgId、`msgIds` 形状闸与 `_serialized` 反解） | Java 75/75 + BUILD SUCCESS；前端 197/197 | 实测 |
| 注入层 CDP | 降级气泡显可点重试、点击发一次 `noCache`、恢复后入库、下次直接回显、滚出滚回不重问厂商 | 真实登录视图上一跑 **23/24**：D/K/R/S 四组全绿，只有 E1（死档重扫后从库里直接回显）红；已定位到"跑的是重启前的旧主进程"，跨进程那一格本轮**未被证明**（§4b、§4c） | 实测（E1 除外） |
| 真实登录档 | 上面那一条链跑在真实登录的 WhatsApp 会话上、零发消息 | 前两条链在真实登录会话上看到了（降级显按钮 + 可点重试 + 滚出滚回不重发请求，实测）；第三条"点一下入库、下次直接回显"只有**后端侧**绿（§2/§2b 两档契约 + §5 那条 echoprobe 3/3；R5 只补"按 msgId 回显"那一格，不补"页面点一下→回写"，见 §4b 纠偏），**页面侧**那一格随 E1 待重启复跑 | 实测 + 待验证 |

机械档（前两档 + 单测）已闭合；行为档跑过一轮真实登录视图，只剩 E1 那一格——缺它就不写"整条链已验证"。

---

## 2. 后端契约（实测）

驱动：`tmp/p7f-translate-contract.mjs`（不入库）。本轮 `ALL PASS — 消息级回显后端契约 A–I+收尾`，35 条 PASS、0 条 FAIL、exit 0。

**这套断言为什么能分辨"库里那行在答题"而不是"缓存帮忙"**（读码 `TranslationService.translate`）：

- 降级结果的三个出口**都不写内容缓存、也不回写 `translated_body`**，所以把一个无凭据厂商通道（本轮 `DEAD=7`，`GET /api/translation/credentials` 现读：只有 baidu 存了 secret）设为生效 channel 后，这一档的 cacheKey 永远冷。
- 于是同一 `text/type/chatKey` 问两次：**带 `msgId` → `cached=true && degraded=false`**，**不带 → `cached=false && degraded=true`**。共用同一个 cacheKey 却只前者命中，唯一来源就是消息级那一行。
- 可重跑：每轮给全部语料挂唯一 ` #<9 位数字>` 尾巴。跨运行的内容缓存会被上一轮预热，新尾巴保证首译必走引擎、必回写。

按档记（A–I 为语料分组，Z 为收尾）：

- **E1/E2**：无凭据厂商通道首请求 `degraded=true`、`cached=false`、原因含「未配置密钥」，零出网；再来一发仍冷 → 降级结果没被写进行里。
- **E3/E4**：切回模拟通道（channel `'1'`，`CHANNEL_TO_PROVIDER` 不含它，压根不问厂商）拿到词典逐字译文；随后在必降级通道上回显 `cached=true` → E1/E2 确是"没写"、E3 确是"写了"。
- **E5/E6**：`noCache` 重试真的走了降级路（`degraded=true`），降级之后行里仍是成功那一份 → 降级出口既不回写也不清旧值。
- **F1/F2**：采集时不带 `msgId` 的老行靠 `msg_key` 尾部认出行、成功译文回写（懒填链闭环）。
- **H1/H2**：`msgId` 刻意不含于 `msgKey`（LIKE 支必不中）的判别行，回显命中即证明 `msg_id` 于采集时真落库。
- **D3/D4/D5**：超长（129）`msgId` 被 DTO `@Size` 挡下 `code=40000`；形状合格但不存在的 `msgId` 不命中、不写脏、不新增行；通配族跑完后各自行仍回显自己那份。
- **I0–I4**：切语向后行里没有该语向的可回显译文（基线冷）→ `noCache` 重试成功回写 → 回显拿到的就是重试那份；且库里已有合格回显时 `noCache` 仍不吃它（读侧跳过语义未被改丢）。
- **Z1/Z2**：本次建的会话档删净（`cleared>=1`）、种行会话消息数仍是 6（全程无新增行）。

### 2b. 发出方向那一支（修复轮新补，实测）

驱动：`tmp/p7f-outmsg-echo.mjs`（不入库）。上一份驱动种的全部是收侧行（`false_<chatKey>_<id>`），
所以"发出方向能不能按消息定位"在它里从头到尾没被问过——本档补的就是那一侧，7 条 PASS、exit 0：

- **O1**：只给 `msg_key = true_<chatKey>_<id>_out`、`msg_id` 留空的一行发出消息，在模拟通道上首译成功。
- **O2**：把会话档切到无凭据厂商通道（重算必降级）后同请求 → `cached=true && degraded=false`，
  译文就是 O1 那一份。这一条是"上一趟真把 `translated_body` 写进了那一行"的唯一凭据。
- **O3**：同一句话换一枚没种过的 `msgId` → 必降级、`cached=false`。它把 O2 的绿和"通道其实没死"分开。
- **O4**：读回那一行，`msgKey`/`body` 与种下去的逐字一致（自证种行没写歪）。
- **O5/O6**：收侧行（无 `_out` 尾、`msg_id` 也为空）同路径首译 + 必降级探针仍回显 ——
  定位拆成两条查询后，收侧那一支没被改坏。正文特意与 O1 不同（尾巴加 `x`）：同会话里两行文本相同时，
  服务层的 body 等值闸会把命中判给先扫到的那一条，两档就分不清自己验的是哪一侧。
- **O7**：另起一个会话种一条**诱饵**行，`msg_key` 尾巴是 `<id>Zout`（`Z` 不是下划线）。第二趟那条尾锚
  若写成裸 `_`（`LIKE CONCAT('%_', id, '_out')`），`_` 在 LIKE 里是"任意一个字符"，诱饵行会被当成发出行命中、
  译文写进一条形状并不相符的行；写成 `\_` 之后它不该再被定位到。断言方式是沿用 O2/O3 的判别：
  模拟通道首译 → 切必降级通道探针，**探针必为 `degraded=true && cached=false`**。

**两次"改前必红"的对照（都是实测，同一驱动只换 jar）**：

1. Major 1 本体：把 `ChatMessageMapper` / `TranslationService` 两个文件 `git stash` 回 `5d7bed1` 的形状、
   `./mvnw package` 出旧 jar、重启后跑本驱动 → `O2 FAIL / 其余 PASS / exit 1`（现场 `tmp/p7f-outmsg-prefix.out`）。
   恢复修复后重跑：`O1–O6 全 PASS、exit 0`，且上一份契约驱动 35 条仍全绿。
2. 尾锚的字面化：G1 修复轮**已含 `_out` 分支但仍是裸 `_`** 的那版 jar 上跑加进 O7 的同一驱动
   → `O1–O6 PASS / O7 FAIL（cached=true）/ exit 1`（现场 `tmp/p7f-outmsg-esc-before.txt`）；
   改成 `\_` 重建后 → `O1–O7 全 PASS / exit 0`（`tmp/p7f-outmsg-esc-after.txt`），契约驱动 35 条仍全绿
   （`tmp/p7f-contract-esc.txt`）。也就是说 O7 分辨的是"锚是字面下划线"这一处，不是环境碰巧答对了。

---

## 3. 单测（实测）

- 后端：`./mvnw test` → `Tests run: 75, Failures: 0, Errors: 0, Skipped: 0` + `BUILD SUCCESS`。其中与本计划直接相关的：`MessageTranslationEchoTest`（7，修复轮新增）、`TranslationServiceRaceTest`（5）、`ConversationScopeKeyTest`（8）、`SimulatedTranslationEngineTest`（15）。
  `MessageTranslationEchoTest` 钉的是消息级路径的三条不变量（库里存过同语种 → 回显且不二次写；算成功 → 按定位那一行回写一次；降级 → 既不回写也不落内容缓存），
  外加两条定位形状（第一趟 `msg_id` 没命中才发第二趟尾部模式；正文对不上就当没定位到、也不许再往下猜另一行）。
  **它不证明的事写在文件头**：两条 SQL 真能按 `msg_key` 尾形认出收/发两种形状、`COALESCE` 懒填只补空 —— 那是 §2/§2b 两档现场驱动的活，mock 掉的 mapper 不参与字符串匹配。
- 前端：`pnpm --dir apps/desktop run test:unit` → `tests 197 / pass 197 / fail 0`。本计划新增/改动的那几组各按自己的判别跑：`src/bridge/whatsapp/normalize.test.ts`（`msgId = raw.id.id`，并钉住"收侧键无 `_out` 尾"这一形状）、`src/shared/translateKey.test.ts`（同会话同文本但 `msgId` 不同不并进同一次 inflight；`msgId` 缺省回退旧形）、`src/shared/msgIds.test.ts`（形状闸 8 条：≤128 可见 ASCII、挡 `%`/`_`/`\`；反解 `_serialized` 4 条：`true_…_out` 取回裸 id、无尾的收侧形、非 WA 前缀一律 `null`、末段过不了形状闸也 `null`）。
- 类型与规范：`pnpm --dir apps/desktop run typecheck` 四路（node / web / inject / unit）无报错通过（实测）。
  `lint` 这一格要分三层说，不能一句"跑过了"糊过去（实测）：
  1. **本计划改动的 14 个桌面端文件**：`eslint <这些文件> --quiet` → 无输出、exit 0，**0 条 error**。
     修复轮又动的 3 个（`shared/msgIds.ts`、`shared/msgIds.test.ts`、`main/services/msgBridge/index.ts`）同档重跑，同样 exit 0（实测）。
  2. **仓库整体 `pnpm run lint`**：exit 2，但那是 eslint 自带的 stylish 格式化器在拼结果表时
     `RangeError: Invalid string length` 崩的（`lib/shared/text-table.js` 里 `Array.join` 超了字符串长度上限），
     **不是断言失败**。为什么会有那么大一包结果：读码 `eslint.config.mjs` 的 ignores 只有
     `**/node_modules`、`**/dist`、`**/out`，据此**推断**生成物（`resources/*.bundle.js` 等）与 vendored
     桥源码都在扫描范围内；这一条本轮未逐文件取证（全量 JSON 跑同样超限，已停），只记推断。
  3. `eslint src --quiet` 另有 138 条 error（`@typescript-eslint/explicit-function-return-type`），
     全部落在本计划未触碰的文件里——**既有欠账，本轮不扩权去修**，在此记档。

---

## 4. 注入层 CDP（真实登录视图跑过一轮：23/24）

驱动：`tmp/p7f-domscan-cdp.mjs`（不入库）。设计上全程零出网：降级档 = 会话档 channel 指到无凭据厂商通道；恢复档 = channel `'1'`（模拟引擎，不问厂商）；**全局档也在 setup 里一并钉成 DEAD**（R6 那一趟换掉 `chatKey` 后落的就是全局档，见 §4b 修正 3）。断言分组：

| 组 | 断言 |
| --- | --- |
| D1–D8 | 降级档下气泡显出 `.scrm-inject-translate-error`（不是静默消失）、文案逐字 = 「翻译失败 · 点此重试」、节点 id 就是 `translation-<页内 data-id>`、挂在同 `data-id` 的锚点里、自动扫描那趟带 `msgId` 且**不带** `noCache`、应答 `degraded=true && cached=false`、没有停在「翻译中…」占位上 |
| K1–K7 | 一次真实 `Input.dispatchMouseEvent` 点击恰好发出一条 `noCache:true` 且带的就是被点那条的 `msgId`；降级未恢复时不自己长成重试环；按钮原样挂回、可重复点 |
| R1–R6 | 恢复档（channel `'1'`）下**手点那一下**拿到非降级结果（只有 `noCache` 那一支谈得上回写，见下面 §4b 修正 4）、失败按钮不再在场；随后切回 DEAD 档做跨边界判别：带该 `msgId` 命中回显、不带不命中、换 `chatKey` 不回显（作用域仍是主进程盖的那把，且那一趟因全局档被钉死而零出网） |
| E1–E4 | 页面内存清光后重扫，死档也从库里直接回显真译文（`cached=true`、逐字一致、画的是译文不是失败按钮） |
| S1–S2 | 译文滚出可视区再滚回：节点重挂，且滚动前后该 `msgId` 的请求数不增（内存态那一支，不再问厂商） |
| F1–F3 | 真·整页重载后（生效档重取 + DOM 重建 + 注入层重挂）死档仍回显 —— 单独 `fresh` 档，代价是会话被重载弹走、要真人再点一次 |

**当前状态：D/K/R/S 四组在真实登录视图上跑绿（§4b），E1 那一格仍"待验证"，根因是跑的是重启前的旧主进程（§4c）；F 组（整页重载）本轮没跑。**

### 4a. 更早一轮的排查记录（三条驱动侧缺陷，都不是功能缺陷）

1. **`Page.reload` 自毁布景**（已修）。第一版 degrade/recover/echo 三档重载内嵌页以"取新档位"，实测重载把 WhatsApp 弹回「未选择会话」：只读取证给出 `{"rows":0,"translated":0,"translating":0,"error":0,"hasMain":false,"vis":"hidden"}`，于是 90 秒等不到任何节点，D1 被读成功能失败。修法是三档改成页内 `translationRevision++` 逼一轮全量重扫——`domScan.ts:40-46` 那一支就是 `clearMessageStates` + `removeAllTranslations` + `translatedMsgIds.clear()`，与"整页重载后首扫"在内存维度同形；而 channel 由后端按生效档现读，页面本来不需要重取。真·整页重载保留为独立 `fresh` 档，观测不到就如实 SKIP，不拿等价口径冒充。
2. **`die()` 跳过 `finally` 把用户档位留在降级档上**（已修）。前提失败走的是 `process.exit`，罩不住主流程的 `try/finally`，那次超时退出后用户的会话 `channel` 留在 `7` 上——真人侧表现就是"翻译不出来了"。现在 `die` 先还原再退，且用 `dirty` 挡住"什么都没改也 PUT 一遍"。还原已用 HTTP 读回确认：会话档回到 `channel=5`，其余字段逐字未动。
3. 顺带补齐：布景那格消息行改为条件等待（一次性读会把"还在拉历史"误报成前提失败）、`activeChatKey` 补 `"-"` 占位判别、点击档开始时重问一次可见性（隐藏视图里 `Input.dispatchMouseEvent` 会被静默吞，那时 K1 的"点中了"是假的）。

### 4b. 真实登录视图那一跑（23/24，实测）

驱动：`tmp/p7f-domscan-cdp.mjs all`（不入库），现场日志 `tmp/p7f-run-send3.log`（同一驱动的三次跑：
`tmp/p7f-run-send.log` 5 红 → `tmp/p7f-run-send2.log` 2 红 → 本轮 1 红，红的那一格逐轮收窄）。

布景那格读回来的事实（实测，全部来自本轮同一次跑）：真实登录的 WhatsApp 视图、`acct=7`、
`chatKey=261963795943523@lid`、会话档已存在、生效 channel=5、页内消息行 14、`visibility=visible`。
降级节点 13 颗，目标挑的是正文含非 ASCII 的那颗 `3EB03204C004075BE49D7F`（正文 `"Hello，生效面②验证"`）。

| 组 | 结果 | 关键读数（本轮实测） |
| --- | --- | --- |
| D1–D8 | 全绿 | 13 颗失败按钮、文案逐字命中、`anchorId` 与 `data-id` 逐字相等；自动扫描那趟带 `msgId`、不带 `noCache`、应答 `degraded=true && cached=false` |
| K1–K7 | 全绿 | 真点（`Input.dispatchMouseEvent`）落在按钮本体（坐标 752,352），一次点击恰好 1 条 `noCache:true` 且带的就是被点那颗的 `msgId`；降级未恢复时不自成长环（3 秒内增量仍 1）；可重复点（第二次累计增量 2） |
| R1–R6 | 全绿 | 恢复档那一下真点拿到 `cached=false && degraded=false`；对照组（同 text/type 不带 msgId）`cached=false && degraded=true`；测试组（带页内那颗 msgId）`cached=true && degraded=false` 且译文逐字等于恢复那趟那份（**这一格证的是后端按 `msgId` 从库里回显，不是"页内那一下写进了库"——那行的写入者见下面「R5 那一份译文的来路」**）；换 `chatKey` 不回显（`degraded=true`，理由 `tencent 未配置密钥…`） |
| E1–E4 | E1 红 | 死档重扫 90 秒内该 msgId 没出现"库里直接回显"那一条记录 → E2/E3/E4 连带没跑（见 §4c） |
| S1–S2 | 全绿 | 滚出再滚回节点重挂；滚动前后该 msgId 请求数 1 → 1（内存态那一支没重发） |
| F1–F3 | 未跑 | 整页重载会把会话弹回未选中、要真人再点一次，单独 `fresh` 档，本轮没排进去 |

**这一轮为了跑通做的四处驱动侧修正**（都不是功能改动）：

1. **D8 的口径**：上一轮按**全屏** `.scrm-inject-translating` 计数判"没停在占位上"，实测读回 `translating 节点=1`
   就判红（`tmp/p7f-run-send.log`）——那一格的问题不在于数不对，而在于它**说不出那 1 颗是不是目标这一颗**，
   把页面上别的气泡的在飞状态算在了目标头上。改成只看**目标那颗的锚点内**
   （`[data-id=…] .scrm-inject-translating`，`-1` 表示锚点不在），全屏数只作参照打印：两个数确实会分开
   （`tmp/p7f-run-send2.log` 目标 0 / 全屏 1，`tmp/p7f-run-send3.log` 目标 0 / 全屏 0）。
2. **S2 的口径**：上一轮按"滚回后总数为 0"判，把 E1 刚发的那条请求算成重发。改成滚动前后**同一 msgId**
   的请求数不增。
3. **R6 的零出网前提**：那一趟故意换掉 `chatKey`，后端按 `conv ?? cust ?? global` 解析会落到**全局档**
   （读码）。上一轮全局档停在 `channel=5`（baidu 有凭据），实测应答是 `cached=true`——那一趟命中的是热缓存，
   **并没有真出去**；但"零出网"不能靠缓存恰好是热的。本轮 setup 里先把全局档读回来、记账，再钉成 DEAD，
   收尾逐字段还原（本轮日志尾 `[还原] 全局档 channel=5｜会话档=原会话档`），并把判别写死：应答若是
   `degraded=false && cached=false`（= 真问了厂商）直接判 R6 红。
4. **恢复档那一支改成"真点"**：上一版是 `setChannel('1')` + 逼一轮自动扫描，而读码
   `TranslationService.translate` 的顺序是 消息级回显 → **内容缓存** → 引擎，缓存命中在 `echoTranslation`
   之前就 `return`（§6 已列为限制）。channel `'1'` 的 cacheKey 只要这句在别处译过一次就是热的，于是自动扫描
   那趟"看着恢复了"、行里却没写上 `translated_body`。R1/R2 现在断的是 `noCache` 手点那一支（跳过缓存**读**、
   按读码那一支实算后该回写——**回写要有可用 `msgId` 才走得到，本轮页内那一趟没有，见下面纠偏**），
   并把上一版那条 `R0`（永真的 `autoBefore >= 0`）降级成一行参照日志——它不构成断言。

**R5 那一份译文的来路（本档自查纠偏，实测）**：初稿把 R5 的绿写成"页面点一下 → 后端回写 → R5 读到"，
对着 `tmp/p7f-server.log` 的 SQL DEBUG 复核后**不成立**：

- `tmp/p7f-run-send2.log`（目标 `ACBEDD27C896DA51D983DBE737288C2D`）里 R1 是 PASS
  （`{"cached":false,"degraded":false}`＝手点那一下实算成功），同一轮 R5 却 FAIL
  （`{"cached":false,"degraded":true,"same":true}`）——页内点成功了，那一行没写上。
  （顺带说明：R1 的断言文案里那句"实算 + 回写"是**这一格的名字**，它读回来的只有 `cached/degraded` 两个字段，
  回写与否不在它的观测面内；真正观测回写的是 E1。）
- 本轮 run3 的目标 `3EB03204C004075BE49D7F`，那一行**在本轮开始之前就已经被写过**：
  `tmp/p7f-server.log` 22:15:44.376 这颗 msgId 点查还是 `Total: 0`，22:15:44.396 紧跟一条 `saveTranslation`
  （`UPDATE chat_message SET translated_body = ?…`），22:16:26.740 又一趟——这两趟都来自
  `tmp/p7f-echoprobe.mjs` 那一跑（现场 `tmp/p7f-echoprobe-run.log`，3/3），发起方是驱动的 HTTP，不是页面。
- 页内手点那一下（22:42:08.404）后面**没有** `saveTranslation`，只有 cache INSERT 与 hit_count（§4c 表第一行）。

所以 R5 的绿只算**"后端按 `msg_id` 点查 + 从库里回显"**这一格的证据（它和 §2/§2b 两档契约是同一件事的两种读法）；
**"页内点一下 → 后端按消息回写"这一格本轮没有任何证据**，它的观测面就是 E1，而 E1 红的原因在 §4c。
这个纠偏不削弱 §4c，反而把它说得更实：旧主进程丢掉 `msgId` 的那一趟不只是没回显，是连回写那一步都没走到。

**这一轮读到的两条页面侧事实**（一条是读码、一条是实测）：

- 页内 `sendLangSetting.enabled` / `receiveLangSetting.enabled` **只随挂载时那份全局档**变（读码
  `translationSync.ts:63` 是 `update-translation-flags` 唯一的自动发送方）。所以用 HTTP 改会话档或客户档的
  开关，页面里的开关状态不会动。本轮为了让 `send` 那一支被走到，是用 `tmp/p7f-sendflag.mjs` 改**全局档**、
  跑完再还原（本轮终端输出读到收尾 `[后端] 全局档 sendEnabled=false（期望 false）`；页面侧那一格**超时未确认**，
  正是因为没有重挂载——驱动里那一处的判据文案是「60 秒内注入层的 `sendEnabled` 没翻过来」
  （`tmp/p7f-sendflag.mjs:107-120`），本轮没为这次 sendflag 跑落现场日志，所以这里只记"超时未确认"这条事实，
  不写成读数）。`channel` 不受这条影响——后端每次都按生效档现读。
- 会话里的 14 行归属全是 `out`（`in=0`），receive 那一支在这一颗会话上没有可挑正文，所以 D/K/R/S 全走 send。
  换会话由真人点的，形态相同（自发消息）。上一轮目标挑中了 `"hello"` 那一颗，它同时踩满两件事：
  正文与译文逐字相同（页面按 R10 不画重复行），且 `"hello"` 在 `'1'` 档缓存里必然是热的（§6 那条限制）——
  所以 R5/E1 那两格当时的红是**挑目标**挑出来的，不是功能。

### 4c. E1 为什么红：跑的是重启前的旧主进程（跨进程那一格本轮未被证明）

**现象**（实测）：页面在恢复档手点那一下确实成功，但死档重扫后那条 msgId 从没走出"库里直接回显"。

**跨层取证**（实测，读 `tmp/p7f-server.log` 的 SQL DEBUG，时间轴与 `tmp/p7f-run-send3.log` 对齐）：

| 时刻 | 谁发的 | 后端日志里出现什么 | 说明 |
| --- | --- | --- | --- |
| 22:42:08.404 | 页面手点那一下（`noCache`，channel `'1'`） | `translation_cache` INSERT（cacheKey `send-1-auto-en-92169c59e0092c3a`），**前面没有 `findForTranslationByMsgId`，后面没有 `update chat_message`** | 实算成功、内容缓存写了；但那一趟到后端时**没有可用 msgId** → 没定位到行 → `translated_body` 没写上 |
| 22:42:09.938 | 驱动自己从 HTTP 问（R5，同 text/type、带那颗 msgId） | `findForTranslationByMsgId` → `Total: 1`，应答 `cached=true` | 后端侧的 locate 与回显是好的（`idx_msg_msgid` 那一支通） |
| D 组那 13 趟 | 页面自动扫描（实测应答 `degraded=true`，见 D7） | 该窗口内**零**条 `findForTranslationByMsgId` | 降级那几趟同样没带 msgId（降级本就不写缓存，所以窗口里没有别的翻译 SQL） |

两趟字节相同、结局不同，唯一差别是**谁把 `msgId` 交给后端**：页面那一趟要多穿一次主进程。

补一条时间轴事实，免得把 22:42:09.938 那一格的 `Total: 1` 当成页内那一下的成果：那一行的 `translated_body`
是 22:15:44.396 由 `tmp/p7f-echoprobe.mjs` 自己的 HTTP 写进去的（§4b「R5 那一份译文的来路」）。页内那一趟
22:42:08 之后**没有** `saveTranslation`——所以"页面点一下 → 回写"这一步本轮根本没走到，不只是没回显。

**进程事实**（实测）：CDP `:9223` 上的 electron 主进程是 PID 4112、起于 `2026-09-27 12:47:15`
（`tmp/p7f-mainstart.ps1` 读监听该端口的进程启动时刻）。而这条链的两笔提交是 16:48:43（`6bea3c8`
ipc 白名单放行 `msgId`）与 17:15:53（`5ffc62c` domScan 带 `msgId` 发请求）——**跑的进程比它们早四个小时**。
`apps/desktop/out/main/index.js` 的 mtime 是新的（20:20:33，predev 重写过），但 dev watcher 从不重载主进程，
所以页面 `inj.invoke` 之后由旧主进程重建 body，`msgId` 进不了后端（读码 + 推断：唯一与两趟差异相符的环节）。

**因此本档的口径是**：E1 不是功能失败，也不是"已验证"——它是"跨主进程那一格本轮没被证明"。
要结它只需要一件事：真人重启 dev app（`pnpm --dir apps/desktop run dev`）、再点开会话、复跑本驱动。
在那之前，"页面点一下 → 后端按消息回写 → 下次直接回显"这条链只有后端侧证据（§2、§2b 两档契约 + §5 那条
echoprobe 3/3；R5 那一格只算"按 `msgId` 回显"，不算页内那一下的回写，见 §4b 纠偏）。
同一个未知还罩着**主进程给页面那趟盖的 `accountId`/`chatKey`**：旧主进程照样能盖出降级应答，
所以那一格也只有 E1 复跑能定。

**驱动侧的盲闸已经修好**（实测）：上一版 `freshness()` 只比文件 mtime，所以文件全绿、进程全旧时不报警，
E1 被误读成"功能失败"。现在判据换成"9223 上那个进程的**启动时刻**与两个产物文件都要晚于 `5ffc62c`
（Task 6 的提交）"，不满足就以退出码 3 退，并把 PID 与启动时间打进错误行里。本轮重启前跑 `pre` 档
（现场 `tmp/p7f-run-pre.log`，驱动自身退出码实测为 3）：

```
PREMISE-FAIL(exit 3): 应用里跑的是旧产物，Task 6 的代码根本没进去：9223 上的主进程起于 2026-09-27 12:47:15（PID 4112）；
inject.bundle.js=2026-09-27T12:20:32.000Z main/index.js=2026-09-27T12:20:33.000Z，主进程的**启动时刻**与两个文件都要晚于
5ffc62c（2026-09-27T09:15:53.000Z）；bundle 里有按钮文案=true。文件新但进程旧也算旧产物：dev watcher 不会重载 src/main。
修法（真人的手）：退出这个 dev app 再起 pnpm --dir apps/desktop run dev（用 run 才会跑 predev 重建注入层，pnpm exec 不跑）
```

这一行同时把"为什么 D/K 会绿而 E1 红"讲清楚了：**注入层产物是新的**（`bundle 里有按钮文案=true`，
所以页面上那颗按钮与它的 `msgId` 都是真的），**主进程是旧的**（`msgId` 在穿主进程那一步被重建 body 丢掉）。

---

## 5. 真实登录档（两条链实测，第三条只到后端侧）

按 spec §8.4，三条都要在真实登录的 WhatsApp 会话上看：已译消息滚出再滚回从库里回显不再问厂商；厂商不可用时新消息显「翻译失败」并可点重试；恢复后点一下入库、下次直接回显。**全程不真发消息**（不碰输入框、不点发送）。

第 4 档那次 CDP 跑就是在真实登录视图上做的（布景读数见 §4b），逐条落到这里：

| spec §8.4 那一条 | 页面侧观测 | 证据词 |
| --- | --- | --- |
| 厂商不可用时新消息显「翻译失败」并可点重试 | D1–D8 + K1–K7 全绿：13 颗按钮、文案逐字、真点发出恰好一条 `noCache` | 实测 |
| 已译消息滚出再滚回不再问厂商 | S1–S2 绿：节点重挂、滚动前后该 msgId 请求数不增（走的是页内内存态那一支） | 实测 |
| 恢复后点一下入库、下次直接回显 | **只到"点一下实算成功"（R1/R2 实测）**。"入库"与"下次直接回显"这一页内闭环没观测到——`msgId` 在穿主进程那一步被旧产物丢掉（§4c）。后端侧那两件事有独立实测：§2 / §2b 两档契约，加上下面那条 echoprobe（真实会话真实行，3/3）。**R5 不算这一格的证据**：它 `cached=true` 读到的那一行是驱动自己的 HTTP 探针写的，不是页内那一下（§4b「R5 那一份译文的来路」） | 页面侧待验证 + 后端侧实测 |

**另有一条与上面并列的判别（实测，`tmp/p7f-echoprobe.mjs`，现场 `tmp/p7f-echoprobe-run.log`）**：
在同一颗真实会话、同一份文本上，先用 `noCache:true` 在活档实算一次，再把会话档切到无凭据厂商通道、
带 `msgId` 问一次，同时留一发"不带 msgId"的对照。挑中 3 颗气泡（`3EB03204…`、`3EB015B5…`、`3EB0ABAD…`），
**3/3 都是**：活档那趟 `cached=false && degraded=false`（真算了一次，语向 `en→en`、档 `conversation`）；
死档带 msgId 那一趟 `cached=true && degraded=false && channel=7`；死档不带 msgId 的对照
`cached=false && degraded=true`，理由是 `tencent 未配置密钥，此结果来自本地模拟引擎`。
判别力在"channel=7 既不会命中内容缓存、也不会回写"这一条上（§2 同一口径），所以 `cached=true`
只可能来自那一行的 `translated_body`——它**不依赖**译文与原文不同（本轮这三颗恰好逐字相同，
因为 send 那档目标语种是 `en` 而模拟引擎是按词典替换的）。收尾逐字段还原会话档。

这一档不替代 E1（它绕开了页面），但它把"回写 → 回显"这件事从"只在合成语料上成立"抬到了
"真实登录会话里的真实行上成立"。E1 结掉之前，本档不写整条链已验证。

---

## 6. 已知限制（沿用 spec §7，本计划不改）

- 会话档改动仍不让存量气泡即时重译：`translatedMsgIds` 只随全局 revision 清。消息级回显解决的是"重开/滚回旧消息别再赌厂商"，不是"改会话档立刻刷全屏"。
- `chatHint`（`document.title`）在窗口后台时可能是 `"WhatsApp"`，只影响页内 inflight 去重键，与后端消息定位无关。
- 一列一个方向译文：同一条消息在两个目标语间来回切会各重译一次并覆盖。
- 老行 `msg_id` 靠"被成功译一次"懒填；从没被译过的历史老行首次仍需走厂商。
- **内容缓存命中的那一支不回写 `translated_body`**（读码 `TranslationService.translate`：缓存命中在两个写点之前就 `return`）。
  后果是：某句文本只要在别处成功译过一次，这条消息的行就拿不到已存译文，要等一次 `noCache` 手动重试才补得上。
  计划 Task 3 把这一格明确排除了（不是漏），所以它只是限制、不是缺陷；用户侧不可见（缓存命中本来就没问厂商）。
  本轮在真实页面上看到过它一次（实测）：目标挑成 `"hello"` 那一颗时，`channel '1'` 的自动扫描那趟回来的是
  `cached=true`，于是行没被写过、随后的死档探针无从回显——这不是消息级链断了，是这一格限制的形状。
- **会话档 / 客户档上那两颗方向开关不会即时到页面**（读码 `translationSync.ts:63`：`sendLangSetting.enabled` /
  `receiveLangSetting.enabled` 只在挂载时按**全局档**取一次，而 `update-translation-flags` 广播唯一的自动发送方就是它）。
  后果：从 HTTP 或会话弹层改会话档、客户档的开关，页内开关状态不动（实测：用驱动改**全局档**开关之后，
  页面侧那一格超时未确认、因为没有重挂载——驱动里那一处的判据是 60 秒等 `sendEnabled` 翻过来，
  `tmp/p7f-sendflag.mjs:107-120`；本轮没为这次跑落现场日志，所以只记"超时未确认"这条事实）。
  `channel`、语向字段不受影响——后端每次都按生效档现读。
  本轮为了让 `send` 那一支被走到，驱动改的是**全局档**（跑完还原），不是会话档。这不是计划要改的东西，
  也不影响消息级回显，记在这里免得下一轮又去改会话档开关然后奇怪页面没反应。
- **消息级回显只看目标语种，不看 `type` / `channel` / 源语向**，而它短路掉的内容缓存三条都看。两个具体后果：
  ① 归属判据翻转（首屏拿不到方向先按 receive、下一轮翻成 send）时，同一行可能被反方向的请求命中并回显；
  ② 换厂商通道后（cacheKey 天然分家、新消息改走新通道），已存过译文的老气泡仍无限期回显旧通道那一份，只有换目标语种才失效。
  spec §2"一列只存一个方向的译文（`translated_lang` 标方向）"就是按这个口径写的，属按规格实现。
- 定位那条查询是**两次调用**（先 `msg_id` 点查、没命中再发 `msg_key` 尾锚）而不是一条 OR：尾锚那一支用不上
  `idx_msg_msgid`，合成一条会把常见路径也降级成"该会话全扫一遍"（读码 + 推断，环境无 `EXPLAIN` 通路）。
  老行（`msg_id` 为空）每被问到一次都要付一次尾锚扫描，直到它被懒填为止。
- Telegram 侧同构复用未落地：`msg_id` 规范形与写回等 TG 采集器接入时一起做。
  主进程那枚反解函数（`msgIdOfSerializedKey`）认死了 WA 的 `true_` / `false_` 前缀，别的形状一律回 `null`
  ——TG 接进来时它不会被"顺手切一刀"当成 id 用。

---

## 7. V10 回滚代价

`V10__message_translation_persistence.sql` 只做三列可空 `ADD COLUMN` + 一条非唯一 `ADD KEY`，不动 `uk_msg`、
不改任何既有列的宽度或排序，所以它**效果上完全可逆**，撤销是一条：

```sql
ALTER TABLE `chat_message`
    DROP INDEX `idx_msg_msgid`,
    DROP COLUMN `msg_id`,
    DROP COLUMN `translated_body`,
    DROP COLUMN `translated_lang`;
```

丢的东西都可再生：`translated_body`/`translated_lang` 是"再问一次厂商就能重算出来"的派生数据，
`msg_id` 由采集链在下一轮 backfill/live 里重新落。代价只有两点：① 撤销后所有已存译文消失，
老消息首次要看厂商脸色；② Flyway 不会自动回退，这条 SQL 得手动跑（与 V9 同一口径）。
不存在 V9 那种"改窄会静默截断"的单向门。索引字节 8+8+512+512=1040，在 InnoDB DYNAMIC 的 3072 上限内。

---

## 8. 整枝终审与修复轮（G1）

终审（Changes-requested：3 Major / 5 Minor）的评审包与报告写在 `.superpowers/sdd/2026-09-27-message-level-translation-persistence/`，
按仓库约定不入库；结论逐条落到本节。
逐条对盘核过后的处置：

| 编号 | 裁定 | 处置 | 证据词 |
| --- | --- | --- | --- |
| Major 1 发出方向整条消息级链断在两处 | 成立（`msg_key` 尾锚 `%<id>` 对 `…_<id>_out` 必不中；`send_result` 那份手写字面量确实没带 `msgId`） | 定位拆两条并补 `_out` 那一支；主进程从 `_serialized` 反解裸 id；mapper 注释改写 | 实测（§2b 六条 + 修复前必红） |
| Major 2 后端这段新逻辑零入 commit 的测试 | 成立（`git log ebf89fa..5d7bed1` 里 `src/test` 零项；`TranslationServiceRaceTest` 走的是把 `messageMapper` 置 null 的 9 参缝，按构造碰不到） | 补 `MessageTranslationEchoTest`（7 条，走真实 `translate()`） | 实测（75/75） |
| Major 3 验收文档未提交 | 成立（当时是 `??` 未跟踪） | 本文档随修复轮入 commit | 实测 |
| Minor 1 注释把 ">128 的 msgId" 也说成"照常翻译" | 成立（`TranslateDTO` 的 `@Size(max = 128)` 会打成整请求 40000） | `platformMsgId` javadoc 改写成两种后果，并标出只有直接打 HTTP 的调用方会看见 40000 | 读码 |
| Minor 2 缓存命中不回写，spec §7 没记 | 成立 | 记进 §6；行为不改（加那一句写回只是把同一份文本再写一次，不改变语义而多一次写） | 读码 |
| Minor 3 定位查询用不上新索引 | 成立（推断，无 `EXPLAIN` 通路） | 按最小修法拆两条查询，第一趟是点查 | 读码 + 推断 |
| Minor 4 回显不看 `type`/`channel`/源语向 | 成立，属按规格实现 | 记进 §6 | 读码 |
| Minor 5 V10 没写回滚段 | 成立 | 补 §7 | 读码 |

任务级评审里剩下的三条在那一轮就判过不拦（重复的成功收尾分支、`channel`/`toLang` 记了没人读、`domScan.ts` 涨到 238 行），
本修复轮不重开；"按钮在自己的请求在飞时会重挂"那一条的可达性否定，理由记在 ledger。

### 8b. 修复轮的回评（G2，一次 scoped re-review）

回评席只看 `5d7bed1..8a4eb3c` 这一段子与上面八条：**八条全部 ADDRESSED，无新增 Critical/Important**，
另挑出三处它自己范围内的 Minor，本轮一并收掉（收法与证据都在 §2b 与下面的实测段里）：

1. `insertIgnoreBatch` 的 javadoc 还指向被改名的 `findForTranslation`（死链）→ 改指 `findForTranslationByMsgId`
   与 `findForTranslationByMsgKeyTail`。仓库无 javadoc 插件 / `-Xdoclint`，所以它是注释层的错，不影响构建（读码）。
2. 第二趟尾锚里的 `_` 是 LIKE 的单字符通配，而注释写的是字面 `<…>_<id>_out` → SQL 改 `\_`，两边对齐；
   这一处**不只改注释**，由 O7 的改前必红 / 改后全绿守住（§2b 对照 2）。
3. `msgIds.ts` 头注释还说"后端**那条** SQL"（拆两条之后单数已不成立），且 `msgIdOfSerializedKey` 的
   "含 `_` 就过不了形状闸"在反解方向上是循环论证（含 `_` 的 id 会被**截短**而不是判 `null`）→ 两条都改写，
   并把"前提破了由谁兜"落到服务层那次 `body` 逐字比对上。纯注释，无行为改动。

回评同时记下的、**不在本轮范围内**的四条（进 ledger，不在这里扩大射程）：

- 页内 `data-id` 的实形**已在真实登录页面上复核完**（本轮 §4b 结掉这一格，实测）：D3 读到的就是裸平台 id
  `3EB03204C004075BE49D7F`（22 位十六进制，形状闸过），R5 拿同一枚从 HTTP 问后端 →
  `findForTranslationByMsgId` 应答 `Total: 1`（后端日志实测）。所以页内那颗键与库里 `msg_id` 列同形、
  消息级链**不是惰性的**——上一段担心的"序列化形（`false_…`）被形状闸整批丢掉"没有发生。
  仍然没证的只剩跨主进程那一格（§4c）。
- `send_result` 补写的那行 `body` 是实发文本；发出方向的回显要求页内请求文本与它逐字相等才走得到。
- Major 2 的"第二个洞"仍未收：注入层的降级状态机没有入 commit 的单测（`test:unit` 的 glob 不含 `src/inject`）。
- 条数对账：终审报告读到的契约驱动是 28 条，本轮同一驱动是 35 条（驱动按仓库约定不入库，无法逐条比）。
  差的是那几组判别断言，不是"同一批断言跑红过"——记为口径差，不当缺陷。

---

## 9. 本轮收尾

- [x] `./mvnw test` 75/75 + BUILD SUCCESS（实测，含修复轮新增的 `MessageTranslationEchoTest` 7 条）
- [x] `test:unit` 197/197（实测）
- [x] `tmp/p7f-translate-contract.mjs` 35 条 PASS / 0 FAIL / exit 0（实测）
- [x] `tmp/p7f-outmsg-echo.mjs` 7 条 PASS / exit 0，且**两处改前对照各自必红**（O2 对 Major 1、O7 对尾锚字面化，实测见 §2b）
- [x] `typecheck` 四路通过；`lint`：修复轮改动的 3 个桌面端文件 `eslint --quiet` exit 0（全仓 `pnpm run lint` 的崩法与既有 138 条 error 另记，见 §3）
- [x] `tmp/p7f-domscan-cdp.mjs all` 在真实登录视图上跑过一轮：**23/24**，D/K/R/S 全绿，E1 红且根因是旧主进程（§4b、§4c）。第 4 档除 E1 外升为"实测"，第 5 档按 §5 那张表分条升。
- [x] 提交前自查纠偏（对着 `tmp/p7f-server.log` 的 SQL DEBUG 与三次现场日志逐格复核，实测）：三处本档初稿写过头的地方收回来——
  R5 的绿改成"只证后端按 `msgId` 回显"（那一行的写入者是 `tmp/p7f-echoprobe.mjs` 自己的 HTTP，页内那一下的回写本轮**没有证据**，
  见 §4b）；D8 那一格的旧读数按实测写成 `translating 节点=1`（不是"12 颗气泡各算一个"）；sendflag 页面侧那一格去掉
  "90 秒"这个没落盘的秒数，只记"超时未确认"并指到驱动里的判据行号。
- [x] `tmp/p7f-echoprobe.mjs`：真实会话 3 颗气泡上「`noCache` 实算 + 死档带 msgId 回显 + 不带 msgId 必降级」**3/3 成立**（实测，`tmp/p7f-echoprobe-run.log`）
- [ ] 真人重启 dev app（`pnpm --dir apps/desktop run dev`）+ 再点一次会话 → 复跑 `tmp/p7f-sendflag.mjs on` + `tmp/p7f-domscan-cdp.mjs all`，把 E1（连带 E2–E4）结掉；重启前那一步 `pre` 档会自己以退出码 3 拦下（实测）
- [ ] 可选：`tmp/p7f-domscan-cdp.mjs fresh`（整页重载那一格；跑完要真人再点一次会话）
