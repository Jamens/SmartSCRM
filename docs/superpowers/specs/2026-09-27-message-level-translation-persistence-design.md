# P7 翻译稳定性：消息级译文回显 + 降级可见重试（message-level-translation-persistence）

**日期** 2026-09-27 · **来源** 用户报「WhatsApp 内嵌页翻译不稳定：改完设置立刻可用，过一会儿就不出译文」
**目标**：让内嵌聊天页的气泡译文**不再每次重开都赌在线线路**——已成功译过的消息按消息存一份译文，命中直接从库里回显、根本不问厂商；只有真正的新消息走在线翻译；在线线路不可用时**不再把降级回显当"不用译"静默删掉**，而是显式提示"翻译失败"并给一个点击重试的入口。
**范围**：只做"译文按消息持久化 + 降级可见重试"这一件。会话级设置（B16）已交付；批量群发（B7）、素材归属分层（B17）各有自己的 spec，不并进来。Telegram 侧同形改造另议，本 spec 先把 WhatsApp 这条链立起来，数据模型与读路径平台无关，TG 接入是后续。

## 0. 约束与红线

- 本地 MySQL（`smartscrm_react`）+ Java 后端是唯一数据层；迁移只加不改已发布迁移（V10 只做 `ALTER`，给 `chat_message` 增列）。
- 页内脚本永远说不出"我属于哪个账号的哪个会话"：`accountId` / `chatKey` 由主进程按 `event.sender` 反查盖章（`ipc.ts`），本设计**不削弱**这条边界。页内新增的 `msgId` 只是**内容标识**、不是作用域；后端定位行时用的是"主进程盖的 `accountId`+`chatKey`"+"页给的 `msgId`"，且再校验该行 `body` 与本次请求文本一致，伪造/错位的 `msgId` 命中不了别人的行、也就写脏不了别人的译文。
- 只有**成功**的译文入 `translated_body`；厂商失败、未配密钥的降级回显**永不回写**（与现有"降级不入 `translation_cache`"同一条口径）。
- 验证分档：后端 HTTP 契约 / `node:test` 纯函数 / 注入层与渲染层 CDP / 真实登录档。后一档没跑完就不写"已验证"；证据词只用 实测 / 读码 / 推断 / 待验证（C11）。
- 本文只描述本项目的规则，不与其他实现比较。

## 1. 现在有什么（设计前提）

| 事实 | 位置 | 证据 |
|---|---|---|
| 页内扫描逐条 `await`，`isNoopTranslation(译文==原文)` 为真就 `removeTranslation` 删掉、不显示；且**完全没读 `result.degraded`** | `inject/core/translation/domScan.ts:59-125`（`:89` 去重、`:94` 请求、`:109` 删） | 读码 |
| `chat_message` 已按 `msg_key` 幂等入库；`msg_key` 存的就是 wa-js `id._serialized`；`body` 是原文 | `V8__chat_history.sql:41,55`、`bridge/whatsapp/normalize.ts:94` | 读码 |
| 后端 `translate()`：channel 5/7 走真厂商，抛 `ProviderException` 时**塌回本地模拟引擎且 `degraded=true`**；模拟引擎对词典外词组 / 不支持目标语**原样回显**；降级分支**不写 `translation_cache`** | `TranslationService.java:523-551`（`:536-543` 降级、`:529` 成功才 writeCache）、`SimulatedTranslationEngine.java:56-59,90-110` | 读码 |
| 现有 `translation_cache` 按 `type-channel-from-to-原文hash` 命中，命中直接返回、不问厂商；**不含消息身份**，也不为"这条消息"负责 | `TranslationService.java:500-515,587-590` | 读码 |
| `translate-api` 的 body 是主进程**逐字段重建**的字面量（只挑 `text/type/input/noCache`），页多报的字段进不了后端；作用域两字段主进程自填 | `ipc.ts:94-133`（`:119-131`）、`translationBridge.ts:requestTranslation` | 读码 |
| **实测（真实 @lid 会话，全发出消息）**：DOM `data-id` = 裸 msgId（`ACBEDD27…C2D`）；wa-js `id._serialized` = `true_261963795943523@lid_ACBEDD27…C2D_out`，即 `msg_key` = `<fromMe>_<chatKey>_<msgId>` 且**发出侧多一段 `_out`**；二者共享的唯一稳定令牌是中间那段 `msgId`（= `id.id`） | 探针 `tmp/p7f-idcheck2.mjs` 本轮实测 | 实测 |

结论：`data-id` 与 `msg_key` **不逐字相等**（只共享 msgId 令牌，`msg_key` 另有前缀与 `_out` 后缀），所以按消息精确回显**不能用等值匹配 `msg_key`**，要有一个两端都稳定、都等于裸 msgId 的规范形——这就是 V10 要补的 `msg_id`。

## 2. 数据模型（V10）

`V10__message_translation_persistence.sql`：

```sql
ALTER TABLE `chat_message`
    ADD COLUMN `msg_id`          VARCHAR(128) COLLATE utf8mb4_bin NULL COMMENT '裸平台消息 id（= 页内 data-id = wa-js id.id），与 msg_key 的序列化形状解耦' AFTER `msg_key`,
    ADD COLUMN `translated_body` TEXT NULL COMMENT '这条消息成功译出的文本；仅在线/模拟成功才写，降级回显不写' AFTER `body`,
    ADD COLUMN `translated_lang` VARCHAR(16) NULL COMMENT 'translated_body 当时的目标语种，换语向靠它判失效' AFTER `translated_body`,
    ADD KEY `idx_msg_msgid` (`tenant_id`, `account_id`, `chat_key`, `msg_id`);
```

- `msg_id` 可空：老行先留空，靠第 4 段懒填充补。`chat_key` 沿用 V8 的 `utf8mb4_bin` 口径，`msg_id` 同为平台 id、同样二进制排序。
- 不动 `uk_msg`：`msg_key` 仍是采集幂等键，`msg_id` 只是"给页内气泡能对上"的第二把钥匙。
- 一列只存**一个方向**的译文（`translated_lang` 标方向）：换目标语向后旧译文按"语种不符 → 未译"重译并覆盖，不累积多语言。

`ChatMessage` 实体加 `msgId` / `translatedBody` / `translatedLang` 三字段（`entity/ChatMessage.java`）。`NormalizedMessage`（`shared/chatTypes.ts`）加 `msgId?: string`，`normalizeWa` 用现成的 `raw.id?.id` 填（`normalize.ts:94` 同级），桥写入路径带上它。

## 3. 生效读路径（命中即回显，不发厂商）

`/api/translation/translate` 在现有"内容缓存 → 厂商"之前，插一层"消息级译文"：

1. 请求体新增可选 `msgId`（页内 data-id，内容标识）。
2. 当带齐 `accountId`+`chatKey`（主进程盖）且 `msgId` 非空时，按 `(tenant_id, account_id, chat_key, msg_id)` 取候选行；**再校验该行 `body` 与本次 `text` 归一化后一致**，不一致按未命中（挡住伪造/错位 `msgId` 命中别人行）。
3. 命中且 `translated_lang` 等于"本次 type 的生效目标语"且 `translated_body` 非空 → 直接返回，`cached=true`、**不调厂商**。
4. 未命中 → 走既有内容缓存 → 厂商/模拟。成功后（非降级）把 `translated_body`/`translated_lang`（以及老行的 `msg_id`）回写那一行。
5. 换语向（`translated_lang` 不符）视为未命中，重译后覆盖。

## 4. 写入与懒填充

- 回写目标行用第 3 段定位到的那一行；`updateById` 只更新 `translated_*`（与 `msg_id`）。
- **懒填充**：新行由桥在采集时直接写 `msg_id`；`msg_id` 为空的老行，本轮先按第 3 段命中失败 → 走厂商 → 成功后顺带把 `msg_id` 写回（该行的 `msg_id` 可由主进程盖的 `chatKey` + 页给的 `msgId` 得出，无需解析 `msg_key`）。老行由此在"被成功译一次"后转入规范匹配，不做一次性大回填 UPDATE。
- 降级/厂商失败：不回写 `translated_*`，也不清旧值（旧的成功译文若语种仍对就继续用）。

## 5. 注入层：降级不再静默删（直接治"过一会儿没译文"）

`domScan.translateOne`（`domScan.ts:61-167`）改三处：

- 发请求时带上 `msgId`（`adapter.getMessageId(row)` 已是它）。
- 拿到结果：**`result.degraded` 为真**时，不再进 `isNoopTranslation` 那支删气泡，而是按"这一格重试得了吗"落两种形状之一（§5b）。
- `isNoopTranslation` 仅在**非降级**时用来剥"同语言原样返回"（R7/R10 语义不变）。这样"厂商在线→有真译文 / 厂商掉线→可见失败"，不再有"整行悄悄消失"。

作用：即使某条消息首刷时百度就挂着，也不会被伪造成"不用译"删掉——留下一格会说话的形状，点通了才入库、下次直接回显。

### 5b. 两种降级形状：`degradeRetryable` 是分岔的唯一证人

降级不是一种状态，是两类，而它们的"下一步"根本不同，所以页面上也不该长同一个样子：

| 形状 | 什么时候 | 页面那一格 | 为什么是这个形状 |
| --- | --- | --- | --- |
| `retry` | 瞬时故障：厂商 HTTP 非 2xx、厂商回错的 `error_code`、断网、请求被中断 | 「翻译失败 · 点此重试」——`renderManualButton` 那颗点得动的按钮（`.scrm-inject-mask`，`cursor:pointer` + 虚线下划线），点击发一次 `noCache:true` 的强制重译 | 多点一次有可能就好起来 |
| `dead` | 配置性死路：这条线路没配密钥，或这对语种不在这条线路的表上 | 「翻译失败（重试无效）· `<degradeReason>`」——`renderManualNote` 的一句话（`.scrm-inject-degrade-note`）：没有 `role="button"`、没有点击监听、没有 `tabIndex`、不 pointer、不画下划线 | 重试走的还是同一条线路、同一份缺着的凭据；那颗点不亮的按钮等于对用户说"再试一次就有救" |

- **判据只有一个字段**：后端 `TranslateVO.degradeRetryable`。分岔发生在抛出点——`ProviderException.retryable()` 由 `BaiduProvider` / `TencentProvider` 的两个死路校验（未配密钥、语种不支持）显式传 `false`，其余构造一律 `true`；`TranslationService` 里"压根没查到凭据"那一格不经 provider 抛出（它连厂商都没问），出口直接写 `false`。
- **页内绝不按 `degradeReason` 的文案猜形状**：那是给人看的一句话，不是判据。判据缺失（旧后端、字段没透传）一律回退成 `retry`——宁可多给一颗其实没用的按钮，也不把一次真能救回来的重译入口悄悄关掉。
- **死路那一格点名是哪一侧死的**：`degradeReason` 由后端产出（`<provider> 未配置密钥，此结果来自本地模拟引擎` / `<provider> 语种不支持: x->y` / 厂商原始错误消息），页面原样念出来，不在前端另造一句、也不把原因藏进 tooltip。
- **形状随消息态一起存**（`MsgState.degradeReason` / `degradeRetryable`）：只存 `degraded` 的话，那条消息滚出可视区再滚回来时会按"未知是否可重试"退化成 `retry`，等于把死路重新伪装成有救。
- **恢复路径不经过死路那一格**：改档位或配密钥时 `translationRevision` 自增，整轮重扫会重新发一次请求；所以那一格不需要自己长出任何入口。
- 两种形状都挂在同一枚锚点、同一个节点 id（`translation-<页内 data-id>`）上，并带证人属性 `data-p7-degrade="retry" | "dead"`，验收驱动按这个属性分形状，不按文案猜。

## 6. 安全与边界

- `msgId` 进 `ipc.ts` 的**重建字面量白名单**：像 `text/type/input/noCache` 一样显式挑进去，长度/字符集上限按平台 msgId 实形设（≤128、可见 ASCII），页多报的别的字段仍被挡。作用域两字段（`accountId`/`chatKey`）保持"只由主进程盖"。
- 后端定位行永远带主进程盖的 `account_id`+`chat_key`+`tenant_id`，`msgId` 只是在这把作用域内再缩小；跨会话/跨租户的 `msgId` 复用因作用域与 body 校验而落空。
- 不新增页可命名的语种/渠道/token（沿用 §4.2 既有口径）。
- `degradeRetryable` 只走**响应方向**（后端 JSON → `translationBridge.requestTranslation` 原样 `return body.data` → 页内 `TranslateResponse`），主进程不改写响应字段，所以它不进 `ipc.ts` 那份请求白名单；页面依然无法左右这个布尔——形状是后端按抛出点判出来的。

## 7. 已知限制与取舍

- **会话档改动仍不让存量气泡即时重译**：`translatedMsgIds` 只随全局 revision 清（`domScan.ts:40-46`、`ipc.ts:114` 明写的取舍）。本 spec 不改这条；消息级回显解决的是"重开/滚回旧消息别再赌厂商"，不是"改会话档立刻刷全屏"。
- `chatHint`（`document.title`）在窗口后台时可能是 `"WhatsApp"`，只影响页内 inflight 去重键，与后端消息定位无关。
- 一列一个方向译文：同一条消息在两个目标语间来回切会各重译一次并覆盖，属可接受。
- 老行 `msg_id` 靠"被成功译一次"懒填；从没被译过的历史老行首次仍需走厂商（这是首次，不算倒退）。
- **内容缓存命中的那一支不回写 `translated_body`**：命中即 `return`，写点只在厂商成功、模拟引擎成功与 R7 同语向三处。
  后果是某句文本只要在别处成功译过一次，这条消息的行就拿不到已存译文，要等一次 `noCache` 手动重试才补得上。
  用户侧不可见（缓存命中本来就没问厂商），所以本 spec 刻意不收这一格。
- **消息级回显只按目标语种判失效**（`translated_lang` 一列），不看 `type` / `channel` / 源语向，而它短路掉的内容缓存三条都看。
  于是：归属判据翻转（先按 receive 后翻成 send）时同一行可能被反方向请求命中并回显；换厂商通道后，已存过译文的老气泡
  仍无限期回显旧通道那一份，只有换目标语种才失效。这是"一列只存一个方向的译文"的口径本身，不是实现偏差。
- **按消息定位是两次查询而不是一条 OR**：`msg_id` 等值那一趟走 `idx_msg_msgid`（常态路径），
  `msg_key` 尾锚那一趟用不上索引、按会话规模扫描，只在第一趟没命中时才发。老行被懒填之后就再也不用它。
- **厂商侧错误码一律算"可重试"，因为这里不维护那张码表**：`BaiduProvider` / `TencentProvider` 只对"未配密钥"和"语种不在表上"两个自己写得出的判断传 `retryable=false`；
  厂商 HTTP 非 2xx 与响应体里的 `error_code` 一律留 `true`。
  后果是明说的：一个被停用/配额耗尽的厂商账号在页面上仍然显示那颗点得动的「点此重试」，用户要多点几次、再看 `degradeReason` 里那句原始错误才反应过来要换线路。
  反过来把码表建进来（按 code 白名单判死路）需要跟着厂商改，本 spec 不收这一格。
- **`degradeReason` 是后端串出来的原文**，厂商给的是英文句子或数字码时页面上就照那样念，不做二次翻译也不裁剪；一句过长的原因可能把气泡那一行撑高，属可接受。
- Telegram 侧：`msg_id` 规范形与写回在 TG 采集器接入时同构复用，本 spec 不落地 TG。

## 8. 验证计划（分档，缺档不写"已验证"）

1. **后端契约**（`tmp/` 驱动）：命中 `msg_id`+语种一致 → `cached=true` 且不发厂商；语种不符 → 重译；伪造/错位 `msgId`（body 对不上）→ 不命中、不写脏；降级 → 不写 `translated_*`；成功 → 回写 + 懒填 `msg_id`。断言分成败两向、退出码区分（exit 1 vs 2）。
   新增两格：死路档（channel 指向未配密钥的厂商，零出网）→ `degraded=true` 且 `degradeRetryable=false` 且 `degradeReason` 念得出"未配置密钥"；同一档只把 channel 换回 `'1'`（模拟引擎）作对照 → `degraded=false` 且 `degradeReason` 为 `null`。
2. **`node:test` 纯函数**：`normalizeWa` 产出 `msgId=raw.id.id`；`translateKey` 把 `msgId` 计入去重键；`degradeCopy` 三种形状（非降级 → `none`；`degradeRetryable` 缺省或 `true` → `retry` + 原句；显式 `false` → `dead` + 点名原因，原因空 → 兜底句）。
3. **注入层 CDP**：造 `degraded` 响应 → 气泡显出失败那一格（非静默消失）；点重试 → `noCache` 请求发出；命中回显路径不发厂商。真实会话先 `document.visibilityState==='visible'` 再操作（C9）。
   死路那一格另跑一条腿：channel 指向未配密钥的厂商（这一档零出网就能造）→ 断言 `data-p7-degrade="dead"`、文案是「翻译失败（重试无效）· …未配置密钥…」且点名哪个厂商、那一格没有 `role="button"`/`tabIndex`/点击监听、`cursor` 不是 pointer，**真实坐标点它不发出任何请求**，滚出可视区再滚回来还是同一句同一形状。
   可重试那一格要真出网才能造出瞬时故障（厂商 HTTP/断网），本轮只由 `degradeCopy` 单测覆盖形状判据，不冒充实机已验。
4. **真实登录档**（需用户在场）：一条已译消息滚出再滚回 → 从库里回显、不再问厂商；把厂商打挂（关代理）后新消息 → 显失败+可点重试；恢复后点一下入库。跑完才在验收文档把对应格标"实测"。

## 9. 落点一览（供 writing-plans 拆任务）

- V10 迁移；`ChatMessage` 实体 + `ChatMessageMapper` 读写三列。
- `shared/chatTypes.ts` 的 `NormalizedMessage` + `normalizeWa` + 采集写库路径带 `msgId`。
- `shared/translateKey.ts`（去重键纳入 `msgId`）、`inject/.../translationQueue.ts` 与 `TranslateRequest`（带 `msgId`）。
- `ipc.ts`（`msgId` 进白名单重建体）+ `translationBridge.ts`（`TranslateRequest`/透传）+ 后端 `TranslateDTO`/`translate()`（消息级读回显 + 成功回写 + 懒填）。
- `domScan.ts`（带 `msgId` 发请求 + `degraded` 显式失败/重试；`isNoopTranslation` 收口到非降级）+ `manualButton.ts`（重试走 `noCache`；死路那一格 `renderManualNote`）。
- `shared/degradeCopy.ts`（形状判据：`degraded` × `degradeRetryable` × `degradeReason` → `none`/`retry`/`dead` + 文案）+ `messageState.ts`（降级两字段随消息态存）+ `renderTranslation.ts`（`.scrm-inject-degrade-note` 样式）+ `constants/config.ts`（`DEGRADE_NOTE` 类名）。
- 后端 `TranslateVO.degradeRetryable` + `ProviderException.retryable()` + 两厂商的死路抛出点 + `TranslationService` 各出口的取值；契约驱动与两侧单测。
- 后端契约驱动 + `node:test` + CDP 注入层探针；验收文档。
