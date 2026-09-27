# 消息级译文回显 + 降级可见重试 · 验收记录

**日期**：2026-09-27
**规格**：`docs/superpowers/specs/2026-09-27-message-level-translation-persistence-design.md`
**计划**：`docs/superpowers/plans/2026-09-27-message-level-translation-persistence.md`
**提交区间**：起点 `ebf89fa`（spec/计划落档），到本提交为止；逐提交枚举 `git log --oneline ebf89fa..HEAD`
（其中 G1 修复轮 = `cb6aa6a` + `8a4eb3c`，G2 回评轮 = `b92fc4f` 及本提交）
**证据词口径**：实测 = 本轮真跑过并读到输出；读码 = 只从源码得出；推断 = 由环境事实推出；待验证 = 没跑过，不当结论用。

---

## 1. 四档总览

| 档 | 覆盖什么 | 结论 | 证据词 |
| --- | --- | --- | --- |
| 后端契约 | `/translate` 的消息级回显、成功回写、懒填 `msg_id`、降级永不回写 | 35/35 全绿（exit 0） | 实测 |
| 后端契约·发出方向 | `msg_key` 尾带 `_out` 的发出行按消息定位、回写、再回显（含收侧不回归、尾锚是字面下划线） | 7/7 全绿（exit 0）；修复前同一驱动 O2 必红、加锚前后 O7 必红（见 §2b） | 实测 |
| 单测（Java + node:test） | 迁移后服务行为、消息级三条不变量、纯函数（`normalizeWa` 产 msgId、`translateKey` 计入 msgId、`msgIds` 形状闸与 `_serialized` 反解） | Java 75/75 + BUILD SUCCESS；前端 197/197 | 实测 |
| 注入层 CDP | 降级气泡显可点重试、点击发一次 `noCache`、恢复后入库、下次直接回显、滚出滚回不重问厂商 | **待验证**（驱动已就绪，等真人点开会话） | 待验证 |
| 真实登录档 | 上面那一条链跑在真实登录的 WhatsApp 会话上、零发消息 | **待验证** | 待验证 |

机械档（前两档 + 单测）已闭合；行为档（后两档）同一次 CDP 跑覆盖，缺它就不写"已验证"。

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

## 4. 注入层 CDP（待验证）

驱动：`tmp/p7f-domscan-cdp.mjs`（不入库）。设计上全程零出网：降级档 = 会话档 channel 指到无凭据厂商通道；恢复档 = channel `'1'`（模拟引擎，不问厂商）。断言分组：

| 组 | 断言 |
| --- | --- |
| D1–D8 | 降级档下气泡显出 `.scrm-inject-translate-error`（不是静默消失）、文案逐字 = 「翻译失败 · 点此重试」、节点 id 就是 `translation-<页内 data-id>`、挂在同 `data-id` 的锚点里、自动扫描那趟带 `msgId` 且**不带** `noCache`、应答 `degraded=true && cached=false`、没有停在「翻译中…」占位上 |
| K1–K7 | 一次真实 `Input.dispatchMouseEvent` 点击恰好发出一条 `noCache:true` 且带的就是被点那条的 `msgId`；降级未恢复时不自己长成重试环；按钮原样挂回、可重复点 |
| R1–R6 | 恢复档（channel `'1'`）拿到非降级结果、失败按钮不再在场；随后切回 DEAD 档做跨边界判别：带该 `msgId` 命中回显、不带不命中、换 `chatKey` 不回显（作用域仍是主进程盖的那把） |
| E1–E4 | 页面内存清光后重扫，死档也从库里直接回显真译文（`cached=true`、逐字一致、画的是译文不是失败按钮） |
| S1–S2 | 译文滚出可视区再滚回：节点重挂，且本轮该 `msgId` 请求数为 0（内存态那一支，不再问厂商） |
| F1–F3 | 真·整页重载后（生效档重取 + DOM 重建 + 注入层重挂）死档仍回显 —— 单独 `fresh` 档，代价是会话被重载弹走、要真人再点一次 |

**当前状态：待验证。** 阻塞点只有一个——内嵌 WhatsApp 视图此刻没有打开的会话（`#main` 不存在、消息行数 0），而本驱动按约定不代点会话列表。

### 本轮排查记录（两条驱动侧缺陷，都不是功能缺陷）

1. **`Page.reload` 自毁布景**（已修）。第一版 degrade/recover/echo 三档重载内嵌页以"取新档位"，实测重载把 WhatsApp 弹回「未选择会话」：只读取证给出 `{"rows":0,"translated":0,"translating":0,"error":0,"hasMain":false,"vis":"hidden"}`，于是 90 秒等不到任何节点，D1 被读成功能失败。修法是三档改成页内 `translationRevision++` 逼一轮全量重扫——`domScan.ts:40-46` 那一支就是 `clearMessageStates` + `removeAllTranslations` + `translatedMsgIds.clear()`，与"整页重载后首扫"在内存维度同形；而 channel 由后端按生效档现读，页面本来不需要重取。真·整页重载保留为独立 `fresh` 档，观测不到就如实 SKIP，不拿等价口径冒充。
2. **`die()` 跳过 `finally` 把用户档位留在降级档上**（已修）。前提失败走的是 `process.exit`，罩不住主流程的 `try/finally`，那次超时退出后用户的会话 `channel` 留在 `7` 上——真人侧表现就是"翻译不出来了"。现在 `die` 先还原再退，且用 `dirty` 挡住"什么都没改也 PUT 一遍"。还原已用 HTTP 读回确认：会话档回到 `channel=5`，其余字段逐字未动。
3. 顺带补齐：布景那格消息行改为条件等待（一次性读会把"还在拉历史"误报成前提失败）、`activeChatKey` 补 `"-"` 占位判别、点击档开始时重问一次可见性（隐藏视图里 `Input.dispatchMouseEvent` 会被静默吞，那时 K1 的"点中了"是假的）。

---

## 5. 真实登录档（待验证）

按 spec §8.4，三条都要在真实登录的 WhatsApp 会话上看：已译消息滚出再滚回从库里回显不再问厂商；厂商不可用时新消息显「翻译失败」并可点重试；恢复后点一下入库、下次直接回显。**全程不真发消息**（不碰输入框、不点发送）。

第 4 档那次 CDP 跑就是在真实登录视图上做的，跑绿即同时结掉本档；跑不到的部分照实留"待验证"。

---

## 6. 已知限制（沿用 spec §7，本计划不改）

- 会话档改动仍不让存量气泡即时重译：`translatedMsgIds` 只随全局 revision 清。消息级回显解决的是"重开/滚回旧消息别再赌厂商"，不是"改会话档立刻刷全屏"。
- `chatHint`（`document.title`）在窗口后台时可能是 `"WhatsApp"`，只影响页内 inflight 去重键，与后端消息定位无关。
- 一列一个方向译文：同一条消息在两个目标语间来回切会各重译一次并覆盖。
- 老行 `msg_id` 靠"被成功译一次"懒填；从没被译过的历史老行首次仍需走厂商。
- **内容缓存命中的那一支不回写 `translated_body`**（读码 `TranslationService.translate`：缓存命中在两个写点之前就 `return`）。
  后果是：某句文本只要在别处成功译过一次，这条消息的行就拿不到已存译文，要等一次 `noCache` 手动重试才补得上。
  计划 Task 3 把这一格明确排除了（不是漏），所以它只是限制、不是缺陷；用户侧不可见（缓存命中本来就没问厂商）。
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

- 页内 `data-id` 的实形仍未复核：若它是序列化形（`false_…`）而不是裸 id，形状闸会把每颗键丢掉，
  整条消息级链在生产里就是惰性的。这一格只有 CDP 那五组（尤其 R5）能定，见 §4。
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
- [ ] `tmp/p7f-domscan-cdp.mjs all` 全绿 → 第 4、5 档升为"实测"
- [ ] 可选：`tmp/p7f-domscan-cdp.mjs fresh`（整页重载那一格；跑完要真人再点一次会话）
