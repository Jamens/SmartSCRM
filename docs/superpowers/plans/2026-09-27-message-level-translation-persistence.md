# 消息级译文回显 + 降级可见重试 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让内嵌聊天页的气泡译文不再每次重开都赌在线线路——已成功译过的消息按消息存一份译文并从库里回显、不问厂商；只有真正的新消息走在线翻译；在线线路降级时不再把回显当"不用译"静默删掉，而是显式提示失败并给一个点击重试入口。

**Architecture:** V10 给 `chat_message` 补三列（`msg_id` / `translated_body` / `translated_lang`）。桥在采集时把页内可对齐的裸平台 id 写进 `msg_id`；后端 `/api/translation/translate` 在"内容缓存 → 厂商"之前插一层"消息级译文"：带主进程盖章的 `accountId`+`chatKey` 与页给的 `msgId` 定位候选行、校验 `body` 与本次文本归一化一致、语种匹配即直接回显；只有真·新消息才发厂商，成功后把译文按行回写（降级永不回写）。注入层 `domScan` 发请求带上 `msgId`，拿到 `degraded` 结果时挂"翻译失败 · 点此重试"（`noCache` 强制再走厂商），不再走 `isNoopTranslation` 那支把降级回显悄悄删掉。

**Tech Stack:** Java 17 + Spring Boot 3.5 + MyBatis-Plus + 本地 MySQL（`smartscrm_react`）；React 19 + TS + Electron；注入层/桥为纯 TS，`node --test` 单测，渲染/注入层用 CDP 验收。

**Spec:** `docs/superpowers/specs/2026-09-27-message-level-translation-persistence-design.md` —— 本计划从该 spec 论证，执行者两份都读。

## Global Constraints

以下为全计划每个任务隐含遵守的项目级红线（逐字取自 spec §0 与项目既有约定）：

- 数据层唯一：本地 MySQL（root / `1234560` / `smartscrm_react`）+ Java 后端；**绝不碰 42 张表的 `smartscrm` 老库**。迁移只加不改已发布迁移：V10 只做 `ALTER`。
- 页内脚本永远说不出"我属于哪个账号的哪个会话"：`accountId` / `chatKey` 只由主进程按 `event.sender` 反查盖章（`ipc.ts`）；本计划**不削弱**这条边界。页内新增的 `msgId` 只是**内容标识**、不是作用域。
- 只有**成功**的译文入 `translated_body`；厂商失败、未配密钥的降级回显**永不回写**（与现有"降级不入 `translation_cache`"同一口径）。
- 后端用 JDK17：`cd apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && ./mvnw ...`，`set -o pipefail`，surefire 输出重要时绝不加 `-q`，`package` 前先杀 `:8180`。
- 前端只用 pnpm（禁 npm / npx）。
- 验证分档，缺档不写"已验证"；证据词只用 实测 / 读码 / 推断 / 待验证（C11）。后端契约走 `tmp/` HTTP 驱动（无 mysql CLI、无 Docker），断言必须区分"生效"与"什么都没做"，退出码分失败档（exit 1 vs 2）。
- 渲染层/注入层验收只走 CDP：`pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223` + `tmp/cdp.mjs`；点击前 `powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1` 并断言 `document.visibilityState === 'visible'`（C9）。驱动以 `process.exit()` 收尾，且 fetch 后先 `process.exitCode = N; await sleep(1500); process.exit(N)`（退出码保真）。
- 真实登录档（外网、代理、扫码、开关会话）是用户的手；**绝不真发 WhatsApp 消息**（绝不按 Enter / 点发送）。
- 每做完一个功能、测试通过后单独 commit（`feat:` / `fix:` / `update:`，subject 后空一行），**助手不 push**；`tmp/` 与 `docs/notes/…legacy-feature-gap.md` 永不入 commit。
- 文档/注释只描述本项目规则，不与其他实现比较。

---

## 文件结构（本计划触碰的边界）

| 文件 | 职责 | 本计划改它做什么 |
|---|---|---|
| `apps/server/.../db/migration/V10__message_translation_persistence.sql` | 建表后的列级演进 | 新建：`chat_message` 增 `msg_id` / `translated_body` / `translated_lang` + `idx_msg_msgid` |
| `apps/server/.../entity/ChatMessage.java` | `chat_message` 行模型 | 加 `msgId` / `translatedBody` / `translatedLang` 三字段 |
| `apps/server/.../mapper/ChatMessageMapper.java` | 采集写入口 + 状态推进 + 统计 | 加"定位候选行"与"回写译文/懒填 msg_id"两条语句 |
| `apps/desktop/src/shared/chatTypes.ts` | 归一化消息模型 | `NormalizedMessage` 加 `msgId?: string` |
| `apps/desktop/src/bridge/whatsapp/normalize.ts` | wa-js 原始行 → 归一化 | `normalizeWa` 用 `raw.id?.id` 填 `msgId` |
| `apps/desktop/src/bridge/whatsapp/normalize.test.ts` | 归一化单测 | 加一条：`msgId == id.id`、与 `msgKey` 解耦 |
| `apps/server/.../web/dto/MessageItemDTO.java` | 采集入库 DTO | 加 `msgId`（≤128） |
| `apps/server/.../service/MessageService.java` | 批量入库 | `row.setMsgId(item.msgId())` |
| `apps/desktop/src/main/services/msgBridge/*`（透传处） | 桥 → 后端 DTO | 把 `msgId` 从 `NormalizedMessage` 带到 `MessageItemDTO` |
| `apps/server/.../web/dto/TranslateDTO.java` | 翻译请求 DTO | 加 `msgId`（≤128，可空） |
| `apps/server/.../service/TranslationService.java` | 翻译编排 | `translate()` 插消息级回显 + 成功回写 + 懒填 |
| `apps/desktop/src/shared/translateKey.ts` | 页内 inflight 去重键 | 键纳入 `msgId` |
| `apps/desktop/src/shared/translateKey.test.ts` | 去重键单测 | 新建：`msgId` 计入、缺省回退同旧键 |
| `apps/desktop/src/inject/core/translation/translationQueue.ts` | 页内请求 + inflight | `TranslateRequest` 加 `msgId` |
| `apps/desktop/src/main/services/translationBridge.ts` | 主进程 → 后端那一跳 | `TranslateRequest` 加 `msgId`、透传进 body |
| `apps/desktop/src/main/webContentsView/ipc.ts` | 白名单重建 body | `msgId` 进重建字面量（校验长度/字符集） |
| `apps/desktop/src/inject/core/translation/domScan.ts` | 气泡扫描 + 渲染 | 发请求带 `msgId`；`degraded` → 手动按钮；`isNoopTranslation` 收口到非降级 |
| `docs/notes/2026-09-27-message-translation-persistence-verification.md` | 验收记录 | 新建：四档结果 + 证据词（**不入 commit 的 gap 表除外，此文档可提交**） |

**执行顺序（依赖）：** Task 1（库/实体/mapper）→ Task 2（采集带 msgId）→ Task 3（后端回显/回写，依赖 1 的 mapper 与 2 写入的 msg_id）→ Task 4（前端去重键/请求带 msgId）→ Task 5（ipc 白名单透传）→ Task 6（domScan 行为）→ Task 7（全量回归 + 验收文档 + commit）。Task 2/4 各自带纯函数/单测；Task 3 以后端 HTTP 契约为准；Task 6 以 CDP 为准；Task 7 汇总四档。

---

## Task 1: V10 迁移 + ChatMessage 实体 + ChatMessageMapper 读写原语

**Files:**
- Create: `apps/server/src/main/resources/db/migration/V10__message_translation_persistence.sql`
- Modify: `apps/server/src/main/java/com/smartscrm/server/entity/ChatMessage.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/ChatMessageMapper.java`

**Interfaces:**
- Produces: `ChatMessage.getMsgId()/getTranslatedBody()/getTranslatedLang()`（Lombok `@Data`，字段 `msgId`/`translatedBody`/`translatedLang`，MyBatis 下划线映射 `msg_id`/`translated_body`/`translated_lang`）。
- Produces: `ChatMessageMapper.findForTranslation(Long tenantId, Long accountId, String chatKey, String msgId): ChatMessage`（只回 `id/body/msgId/translatedBody/translatedLang`）。
- Produces: `ChatMessageMapper.saveTranslation(Long id, String msgId, String translatedBody, String translatedLang): int`。

- [ ] **Step 1: 写 V10 迁移（照 spec §2 逐字）**

`V10__message_translation_persistence.sql`：

```sql
-- P7 翻译稳定性（message-level-translation-persistence spec §2）：给 chat_message 补
-- 三列，让"这条消息已成功译出的文本"能按消息存一份、下次从库里回显。
-- 只 ALTER、不新建表、不动 uk_msg：msg_key 仍是采集幂等键，msg_id 只是"给页内气泡能对上"的第二把钥匙。
-- msg_id 与 msg_key 同为平台 id，沿用 V8 的 utf8mb4_bin 二进制排序（大小写敏感）；显示/文本列保持 human 排序。
ALTER TABLE `chat_message`
    ADD COLUMN `msg_id`          VARCHAR(128) COLLATE utf8mb4_bin NULL COMMENT '裸平台消息 id（= 页内 data-id = wa-js id.id），与 msg_key 的序列化形状解耦' AFTER `msg_key`,
    ADD COLUMN `translated_body` TEXT NULL COMMENT '这条消息成功译出的文本；仅在线/模拟成功才写，降级回显不写' AFTER `body`,
    ADD COLUMN `translated_lang` VARCHAR(16) NULL COMMENT 'translated_body 当时的目标语种，换语向靠它判失效' AFTER `translated_body`,
    ADD KEY `idx_msg_msgid` (`tenant_id`, `account_id`, `chat_key`, `msg_id`);
```

- [ ] **Step 2: 给实体加三字段**

`ChatMessage.java` 在 `private String msgKey;` 后加 `private String msgId;`；在 `private String body;` 后加 `private String translatedBody;` 与 `private String translatedLang;`。（Lombok `@Data` 自动出 getter/setter；下划线列名由 MyBatis-Plus 的 map-underscore 默认映射。）

- [ ] **Step 3: 给 mapper 加读写原语**

`ChatMessageMapper.java` 末尾（`statsPerDay` 之后、接口闭合前）加：

```java
    /**
     * 消息级译文回显的候选行：作用域用主进程盖的 tenant/account/chat_key，再用页给的 msgId 缩小。
     * msg_id 命中规范行（本计划采集链已写入）；msg_id 为空的老行靠 msg_key 尾部含 msgId 认出
     * （msg_key 序列化为 `<fromMe>_<chatKey>_<id.id>[_out]`，id.id 在尾部），命中后由 saveTranslation 懒填。
     * 这里只回判定要用的列，不回正文大字段。body 是否等于本次文本由调用方（服务层）归一化后比对，
     * 挡住错位/伪造的 msgId 命中到别人的行。
     */
    @Select("SELECT id, body, msg_id, translated_body, translated_lang FROM chat_message"
        + " WHERE tenant_id = #{tenantId} AND account_id = #{accountId} AND chat_key = #{chatKey}"
        + " AND (msg_id = #{msgId} OR msg_key LIKE CONCAT('%', #{msgId}))"
        + " LIMIT 1")
    ChatMessage findForTranslation(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
                                   @Param("chatKey") String chatKey, @Param("msgId") String msgId);

    /**
     * 成功译文回写定位到的那一行；只动 translated_* 与（仅当原来为空时）msg_id。
     * 降级/厂商失败不调用这里（服务层把关）。COALESCE 保证懒填只补空、不覆盖既有规范 id。
     */
    @Update("UPDATE chat_message SET translated_body = #{translatedBody}, translated_lang = #{translatedLang},"
        + " msg_id = COALESCE(msg_id, #{msgId}) WHERE id = #{id}")
    int saveTranslation(@Param("id") Long id, @Param("msgId") String msgId,
                        @Param("translatedBody") String translatedBody, @Param("translatedLang") String translatedLang);
```

- [ ] **Step 4: 编译**

Run: `cd apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw -DskipTests test-compile`
Expected: BUILD SUCCESS（无未映射列/语法错误）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/main/resources/db/migration/V10__message_translation_persistence.sql \
        apps/server/src/main/java/com/smartscrm/server/entity/ChatMessage.java \
        apps/server/src/main/java/com/smartscrm/server/mapper/ChatMessageMapper.java
git commit -m "feat(P7/翻译): V10 给 chat_message 补 msg_id/translated_body/translated_lang + mapper 读写原语"
```

（本 task 的迁移真正生效——启动时 Flyway 建列——在 Task 3 起后端契约时验证；此处只保证编译。）

---

## Task 2: 采集链把裸 msgId 写进 msg_id（含 normalizeWa 单测）

**Files:**
- Modify: `apps/desktop/src/shared/chatTypes.ts`
- Modify: `apps/desktop/src/bridge/whatsapp/normalize.ts`
- Modify: `apps/desktop/src/bridge/whatsapp/normalize.test.ts`
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/dto/MessageItemDTO.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/MessageService.java`
- Modify: 桥 → `MessageItemDTO` 透传处（`apps/desktop/src/main/services/msgBridge/` 内把 `NormalizedMessage` 映射成入库 DTO 的那一段——执行前先 Grep `msgKey:` 定位）

**Interfaces:**
- Consumes: `ChatMessage.setMsgId(...)`（Task 1 加的字段）。
- Produces: `NormalizedMessage.msgId?: string`；`MessageItemDTO.msgId()`。采集入库的每一行带上裸平台 id。

- [ ] **Step 1: 先写失败的归一化单测**

`normalize.test.ts` 末尾加：

```ts
test('msgId = 裸 id.id，与序列化的 msgKey 解耦（in 行无 _out 尾）', () => {
  const row = normalizeWa(
    { id: { _serialized: 'false_861380001001@c.us_HXD123', id: 'HXD123' },
      from: '861380001001@c.us', to: '8610000000000@c.us', body: 'hola', t: 1_700_000_000, isFromMe: false, ack: 3 },
    ctx
  )
  assert.equal(row?.msgKey, 'false_861380001001@c.us_HXD123')
  assert.equal(row?.msgId, 'HXD123')
})

test('out 行：msgKey 带 _out 尾，msgId 仍是中段裸 id', () => {
  const row = normalizeWa(
    { id: { _serialized: 'true_861380001001@c.us_ABC9_out', id: 'ABC9' },
      from: '8610000000000@c.us', to: '861380001001@c.us', body: 'ok', t: 1_700_000_000, isFromMe: true, ack: 2 },
    ctx
  )
  assert.equal(row?.direction, 'out')
  assert.equal(row?.msgKey, 'true_861380001001@c.us_ABC9_out')
  assert.equal(row?.msgId, 'ABC9')
})
```

- [ ] **Step 2: 跑单测确认失败**

Run: `pnpm --dir apps/desktop exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/bridge/whatsapp/normalize.test.ts`
Expected: 新加两条 FAIL —— `msgId` 断言得到 `undefined`（`Cannot read properties of undefined` 或 `AssertionError`），旧用例仍绿。

- [ ] **Step 3: `NormalizedMessage` 加字段**

`chatTypes.ts` 的 `interface NormalizedMessage` 里，`msgKey: string` 之后加：

```ts
  /** 裸平台消息 id（WA: wa-js `id.id`；= 页内 `data-id`），与序列化的 `msgKey` 解耦，供译文按消息回显对齐。 */
  msgId?: string
```

- [ ] **Step 4: `normalizeWa` 填 msgId**

`normalize.ts`：`WaMsgModel` 的 `id` 已有 `_serialized`，取同级 `id.id`。在 `normalizeWa` 返回对象里 `msgKey,` 之后加一行：

```ts
    msgId: raw.id?.id,
```

（`WaMsgModel['id']` 若无 `id?: string`，在本文件消费处或 `bridge/types.ts` 的 `id` 形状上补 `id?: string`；执行时先 Read `bridge/types.ts` 确认 `id` 是否已声明 `id` 字段，缺则加，不猜。）

- [ ] **Step 5: 跑单测确认通过**

Run: `pnpm --dir apps/desktop exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/bridge/whatsapp/normalize.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: 后端 DTO + 入库带 msgId**

`MessageItemDTO.java` 里 `@NotBlank @Size(max = 128) String msgKey,` 之后加：

```java
    @Size(max = 128) String msgId,
```

`MessageService.java` 入库循环 `row.setMsgKey(item.msgKey());` 之后加：

```java
            row.setMsgId(item.msgId());
```

- [ ] **Step 7: 桥透传 msgId**

Grep 桥里把 `NormalizedMessage`（含 `msgKey`）映射成后端 `MessageItemDTO` 字段的位置（`apps/desktop/src/main/services/msgBridge/`），在写 `msgKey` 的同一对象上补 `msgId: message.msgId`（保持可空；无则为 undefined，JSON 里落 null，后端 `@Size` 允许 null）。改后跑：

Run: `pnpm --dir apps/desktop exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "src/main/services/msgBridge/**/*.test.ts"`
Expected: 既有 msgBridge 单测仍全绿（若某断言逐字段比对入库 DTO，需把 `msgId` 补进期望对象；只在与本改动直接相关处改，勿放宽）。

- [ ] **Step 8: 后端编译**

Run: `cd apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw -DskipTests test-compile`
Expected: BUILD SUCCESS。

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/shared/chatTypes.ts apps/desktop/src/bridge/whatsapp/normalize.ts \
        apps/desktop/src/bridge/whatsapp/normalize.test.ts apps/desktop/src/bridge/types.ts \
        apps/desktop/src/main/services/msgBridge \
        apps/server/src/main/java/com/smartscrm/server/web/dto/MessageItemDTO.java \
        apps/server/src/main/java/com/smartscrm/server/service/MessageService.java
git commit -m "feat(P7/翻译): 采集链把裸平台 msgId 写进 chat_message.msg_id（normalizeWa + 单测 + DTO 透传）"
```

---

## Task 3: 后端消息级回显 + 成功回写 + 懒填（HTTP 契约驱动验收）

**Files:**
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/dto/TranslateDTO.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java`
- Create: `tmp/p7f-translate-contract.mjs`（**不 commit**）
- Test: `apps/server/src/test/java/com/smartscrm/server/service/MessageTranslationEchoTest.java`（若项目已有可直接跑的服务级测试基座；否则以 Step 8 的 HTTP 契约为准，见下）

**Interfaces:**
- Consumes: `ChatMessageMapper.findForTranslation(...)` / `saveTranslation(...)`（Task 1）、`chat_message.msg_id`（Task 2 写入）。
- Produces: `TranslateDTO.msgId()`；`translate()` 在命中且语种一致时返回 `cached=true` 且不发厂商，成功（非降级）时回写并懒填。

- [ ] **Step 1: `TranslateDTO` 加 msgId**

`TranslateDTO.java` 里 `Long accountId` 之后（record 末尾闭合前）加：

```java
    /**
     * 可空：页内 `data-id`（= 裸平台消息 id），内容标识、不是作用域。带上时后端在
     * `accountId`+`chatKey` 的作用域内按消息级译文回显（spec §3）；缺省即按现有"内容缓存 → 厂商"走。
     * 128 与 `chat_message.msg_id` 同宽；实际形如 32 位十六进制，可见 ASCII。
     */
    @Size(max = 128, message = "msgId 最长 128 字符") String msgId
```

（注意逗号：`accountId` 后补 `,`。）

- [ ] **Step 2: 注入 mapper + 读回显（在缓存查询之前）**

`TranslationService.java`：构造注入 `ChatMessageMapper messageMapper`（沿用类内既有 `@RequiredArgsConstructor` / final 字段风格——执行时先 Read 类头确认注入方式）。在 `translate()` 里 `String cacheKey = buildCacheKey(...)` 之后、`if (!Boolean.TRUE.equals(dto.noCache())) {`（内容缓存查询，约 `:503`）之前，插入消息级回显块：

```java
        // —— 消息级译文回显（spec §3）：命中即从库里回显、根本不问厂商，也不碰内容缓存。
        // 只有主进程盖了 accountId+chatKey、且页给了 msgId 时才启用；作用域永远是主进程盖的，
        // msgId 只在这把作用域内再缩小。body 与本次文本归一化一致是"别命中到别人的行"的闸。
        ChatMessage msgRow = null;
        if (dto.accountId() != null && dto.chatKey() != null
                && dto.msgId() != null && !dto.msgId().isBlank()
                && !Boolean.TRUE.equals(dto.noCache())) {
            msgRow = messageMapper.findForTranslation(tenantId, dto.accountId(), dto.chatKey(), dto.msgId());
            if (msgRow != null) {
                String rowBody = SimulatedTranslationEngine.normalize(msgRow.getBody() == null ? "" : msgRow.getBody());
                if (!rowBody.equals(normalized) || msgRow.getTranslatedBody() == null) {
                    // body 对不上（错位/伪造）当作没有可回显的行；无已存译文走正常路径。
                    if (!rowBody.equals(normalized)) {
                        msgRow = null;
                    }
                } else if (toLang != null && toLang.equals(msgRow.getTranslatedLang())) {
                    return new TranslateVO(msgRow.getTranslatedBody(), true, false,
                        containsChinese(msgRow.getTranslatedBody()), dto.type(), channel,
                        fromLang, toLang, cacheKey, false, null, scope);
                }
                // 语种不符 → 保留 msgRow 但不回显，走厂商，成功后覆盖（§3.5）。
            }
        }
```

- [ ] **Step 3: 成功回写 + 懒填（四处非降级 return 前）**

`translate()` 里有四处**非降级**成功出口：① `keepInCache` 内容缓存命中（那本就是缓存，不回写）；② R7 同语向（`:518`）；③ 厂商成功（`:533`）；④ 模拟引擎成功（非降级，`:554`）。**只有真正产生新译文并入内容缓存的那两支**（厂商成功 `:533`、模拟成功 `:554`）需要回写。在这两处 `return new TranslateVO(...)` 之前，各插入（用局部变量承接译文以免重复求值）：

```java
                    // 厂商成功（非降级）：按消息回写译文，语种随存。仅当带 msgId 作用域且定位到行（或懒填可定位）。
                    if (msgRow != null) {
                        messageMapper.saveTranslation(msgRow.getId(), dto.msgId(), online.translation(), toLang);
                    } else if (dto.accountId() != null && dto.chatKey() != null
                            && dto.msgId() != null && !dto.msgId().isBlank()) {
                        // 老行/刚入库行：可能 findForTranslation 因 msg_id 未写且 msg_key 尚未成形而没命中；
                        // 此处不新增行（入库归采集链），只在已定位到 msgRow 时回写。定位不到就只走内容缓存（不回退到写脏）。
                    }
```

模拟引擎成功分支同样在 `return` 前用 `result.translation()` 调 `saveTranslation`。**降级/厂商失败的两处 `return`（`:536-543`、`:546-551`）绝不回写**，保持不动。R7 同语向（`:518`）也回写 `translated_body = normalized`、`translated_lang = toLang`（它就是这条消息"译文=原文"的规范结论，下次直接回显，省一次重算）。

> 说明：上面 `else if` 块是空体占位注释，表达"定位不到就不写"的策略；执行者落地时把厂商成功处的回写收敛成一个私有 helper `echoIfLocated(msgRow, msgId, translation, toLang)`，避免四段复制——见 Step 4。

- [ ] **Step 4: 抽 helper（DRY）**

在 `TranslationService` 加私有方法，`translate()` 三处（R7 / 厂商成功 / 模拟非降级成功）调用它，降级与内容缓存命中不调：

```java
    /** 成功译文按消息回显：只有定位到行（body 已校验）才写，写译文 + 语种，并懒填 msg_id。 */
    private void echoTranslation(ChatMessage msgRow, String msgId, String translation, String toLang) {
        if (msgRow != null && msgId != null && !msgId.isBlank()) {
            messageMapper.saveTranslation(msgRow.getId(), msgId, translation, toLang);
        }
    }
```

Step 2 已保证 `msgRow` 只在 body 匹配时非空（错位时置 null），Step 3/4 直接用它即可。

- [ ] **Step 5: 写后端 HTTP 契约驱动（失败优先，能区分"生效/没做"）**

`tmp/p7f-translate-contract.mjs`（**不 commit**）。前置：杀 `:8180` 旧进程、`./mvnw -q -DskipTests package` 起新 jar 或用 dev 档、Flyway 建好 V10。脚本按 spec §8.1 逐条断言，退出码分失败档。骨架（用 `authedFetch` 同价的登录取 token → POST）：

```js
// tmp/p7f-translate-contract.mjs —— 消息级回显后端契约。不入库的旧行用采集端点造。
const BASE = 'http://127.0.0.1:8180'
let failures = 0
const ok = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' — ' + detail}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// login → token；POST /api/translation/translate（带 accountId+chatKey+msgId）；
// 用采集入库端点先塞一行 (chatKey,msgKey,msgId,body) 造候选行；再：
// A. 先译一次使 translated_body 落库（channel=5 真厂商或词典命中的模拟成功，非降级）→ 查该行非空。
// B. 第二次同 msgId、语向不变 → 期望 cached=true 且不产生厂商调用（用计数或对拍响应 cacheKey 一致 + 计时）。
// C. 语向改到另一种（PUT 会话档换 toLang）→ 期望 cached=false、重译、translated_lang 更新。
// D. 伪造 msgId（body 与实际行不符）→ 期望不命中（不返回那行的译文）、且不改写那行。
// E. 未配密钥的降级（channel 指向无凭据）→ 期望 translated_body 不被写空/不被覆盖。
// 收尾：断言后区分失败档：
process.exitCode = failures > 0 ? 1 : 0
await sleep(1500); process.exit(process.exitCode)
```

（驱动细节执行时按项目既有 `tmp/` 契约脚本的登录与调用姿势写，不新造鉴权方式；断言"生效/没做"两向必须都能失败——例如 A 不能因为厂商恰好回显原词而假绿，用一条词典/厂商能确定译出的文本。）

- [ ] **Step 6: 起后端跑契约，先看红**

Run（用户在场/代理已开时）：确认 `:8180` 起来、V10 已建列，`node tmp/p7f-translate-contract.mjs`。
Expected: 首跑在未插回显前应 FAIL（B 不发厂商无法成立、A 无回写字段）；实现后 Step 7 转绿。

- [ ] **Step 7: 实现后跑契约转绿**

Run: `node tmp/p7f-translate-contract.mjs`
Expected: 全 PASS，exit 0。降级(E)与伪造(D)两档尤其验证"不写脏"。

- [ ] **Step 8: 后端全量单测不回归**

Run: `cd apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test`
Expected: BUILD SUCCESS，无既有用例转红。

- [ ] **Step 9: Commit（仅源码，tmp 驱动不入库）**

```bash
git add apps/server/src/main/java/com/smartscrm/server/web/dto/TranslateDTO.java \
        apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java
git commit -m "feat(P7/翻译): /translate 插消息级译文回显 + 成功回写 + 懒填 msg_id（降级永不回写）"
```

---

## Task 4: 前端去重键与请求模型纳入 msgId（含 translateKey 单测）

**Files:**
- Modify: `apps/desktop/src/shared/translateKey.ts`
- Create: `apps/desktop/src/shared/translateKey.test.ts`
- Modify: `apps/desktop/src/inject/core/translation/translationQueue.ts`

**Interfaces:**
- Produces: `translateKey(req)` 把 `msgId` 计入去重键；`TranslateRequest.msgId?: string`。Task 5/6 消费。

- [ ] **Step 1: 写失败的 translateKey 单测**

`translateKey.test.ts`：

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateKey, type TranslateKeyInput } from './translateKey'

const base: TranslateKeyInput = { type: 'receive', text: 'hi', chatHint: 'C' }

test('msgId 计入去重键：同文本不同 msgId 不并进同一次 inflight', () => {
  const a = translateKey({ ...base, msgId: 'A1' })
  const b = translateKey({ ...base, msgId: 'B2' })
  assert.notEqual(a, b)
})

test('msgId 缺省时回退到旧形（不给现有调用方制造新键）', () => {
  assert.equal(translateKey(base), `${base.type}|f|${encodeURIComponent('C')}|hi`)
})
```

- [ ] **Step 2: 跑单测确认失败**

Run: `pnpm --dir apps/desktop exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/shared/translateKey.test.ts`
Expected: 第一条 FAIL（当前键不含 msgId，两键相等）。

- [ ] **Step 3: 扩展 `TranslateKeyInput` 与键**

`translateKey.ts`：接口加 `msgId?: string`；`translateKey` 改为把 `msgId` 作为可选段拼在末尾（缺省时不追加，保持旧串）：

```ts
export function translateKey(req: TranslateKeyInput): string {
  const head = `${req.type}|${req.input === true ? 'i' : 'f'}|${encodeURIComponent(req.chatHint ?? '')}|${req.text}`
  return req.msgId ? `${head}#${encodeURIComponent(req.msgId)}` : head
}
```

（更新函数上方注释：一句说明 `msgId` 让"同一会话里两条同文本消息"不再共用一次 inflight；仍只是页内提示级去重，真正的定位在后端由主进程盖章作用域完成。`text` 非末段后 msgId 段用 `#` 分隔并 `encodeURIComponent` 消跨字段撞车。）

- [ ] **Step 4: 跑单测确认通过**

Run: `pnpm --dir apps/desktop exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/shared/translateKey.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: `TranslateRequest` 加 msgId**

`translationQueue.ts` 的 `interface TranslateRequest` 里 `chatHint?` 之后加：

```ts
  /** 页内 data-id（裸平台消息 id）。进 inflight 去重键，并由主进程透传给后端做消息级回显定位。 */
  msgId?: string
```

`requestTranslate` 内 `translateKey(req)` 自动含 msgId（`TranslateRequest` 结构兼容 `TranslateKeyInput`；执行时确认 `type`/`input`/`chatHint`/`text` 对齐，缺 `msgId` 传递则补进 `TranslateKeyInput` 的映射）。

- [ ] **Step 6: typecheck**

Run: `pnpm --dir apps/desktop exec tsc -p tsconfig.json --noEmit`（注入层所属工程配置；执行时以能覆盖 `src/inject` 与 `src/shared` 的那份 tsconfig 为准）
Expected: 无类型错误。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/translateKey.ts apps/desktop/src/shared/translateKey.test.ts \
        apps/desktop/src/inject/core/translation/translationQueue.ts
git commit -m "feat(P7/翻译): translateKey/TranslateRequest 纳入 msgId（同会话同文本不再并进一次 inflight）"
```

---

## Task 5: ipc 白名单 + translationBridge 透传 msgId

**Files:**
- Modify: `apps/desktop/src/main/webContentsView/ipc.ts`
- Modify: `apps/desktop/src/main/services/translationBridge.ts`

**Interfaces:**
- Consumes: 页内经 `ele.invoke('translate-api', {…, msgId})` 发来的 `msgId`。
- Produces: 后端收到的 body 里带上被校验过的 `msgId`。

- [ ] **Step 1: bridge 请求类型加 msgId**

`translationBridge.ts` 的 `interface TranslateRequest` 里 `noCache?` 之后加：

```ts
  /** 页内 data-id（裸平台消息 id）。不是作用域；后端在主进程盖章的作用域内用它定位消息级译文。 */
  msgId?: string
```

`requestTranslation` 已 `{ ...req, ...ctx }` 透传，`msgId` 随 body 进后端（无需再改）。（可选：`TranslateResponse` 保持不含新字段——`cached`/`degraded` 已在。）

- [ ] **Step 2: ipc 重建字面量挑入 msgId（带校验）**

`ipc.ts`：`view:invoke` 里 `req` 的 `as Partial<{…}>` 类型标注补 `msgId: string`；在重建 body 字面量处（`{ text, type, …input, …noCache }`）加一段，与既有 `text.length>5000` 同等把关，只放"≤128 且可见 ASCII"的 msgId：

```ts
      const msgIdRaw = typeof req?.msgId === 'string' ? req.msgId : ''
      // 只接受平台 msgId 实形（32 位十六进制一类）：长度 ≤128、可见 ASCII。页多报的别的字段仍被挡。
      const msgId = msgIdRaw.length > 0 && msgIdRaw.length <= 128 && /^[\x21-\x7e]+$/.test(msgIdRaw)
        ? msgIdRaw
        : undefined
```

并在 `requestTranslation({ text, type, …, msgId ? { msgId } : {} }, { accountId, chatKey }, apiBase)` 的对象里带上 `msgId`。更新那段"页面字段挡在门外"的注释：`msgId` 现在是显式白名单字段之一（内容标识，非作用域；作用域两字段仍只由主进程盖）。

- [ ] **Step 3: typecheck + 注入层构建**

Run: `pnpm --dir apps/desktop exec tsc -p tsconfig.node.json --noEmit`（覆盖 main；执行时以实际配置为准）与 `pnpm --dir apps/desktop run build`（或既有注入层构建档，Task P2b 的管线）
Expected: 无错误；bundle 产出成功。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/webContentsView/ipc.ts apps/desktop/src/main/services/translationBridge.ts
git commit -m "feat(P7/翻译): ipc 白名单显式放行 msgId（校验 ≤128 可见 ASCII）+ bridge 透传后端"
```

---

## Task 6: domScan 发请求带 msgId + degraded 显式失败重试（CDP 验收）

**Files:**
- Modify: `apps/desktop/src/inject/core/translation/domScan.ts`
- Create: `tmp/p7f-domscan-cdp.mjs`（**不 commit**）

**Interfaces:**
- Consumes: `TranslateRequest.msgId`（Task 4）、后端 `degraded`/回显（Task 3）、`renderManualButton`（既有）。
- Produces: 降级结果 → "翻译失败 · 点此重试"（`noCache` 重试）；`isNoopTranslation` 仅在非降级剥离同语向回显。

- [ ] **Step 1: `translateOne` 发请求带 msgId**

`domScan.ts` 的 `requestTranslate(injector, { text, type, chatHint: adapter.chatHint() })`（约 `:94`）补 `msgId`（`adapter.getMessageId(row)` 已在上下文里持有该值）：

```ts
    msgId
```

- [ ] **Step 2: degraded 走手动按钮，不再静默删**

在成功分支里，把现有 `if (isNoopTranslation(text, result.translation)) removeTranslation(msgId) else renderTranslation(...)`（`:109-110`）改为先判 `result.degraded`：

```ts
      if (result.degraded) {
        // 在线线路掉了/未配密钥：译文是本地回显，不能当"不用译"删掉——显式失败并给可点的重试。
        renderManualButton(msgId, anchor, () => {
          void requestTranslate(injector, { text, type, chatHint: adapter.chatHint(), msgId, noCache: true })
            .then((r) => {
              if (!r || r.degraded || isNoopTranslation(text, r.translation)) return
              renderTranslation(msgId, anchor, r.translation)
              state.markTranslated(msgId); saveMessageState(msgId, { /* 与既有成功态同形 */ })
            })
        })
        return
      }
      if (isNoopTranslation(text, result.translation)) removeTranslation(msgId)
      else renderTranslation(msgId, anchor, result.translation)
```

（`renderManualButton` 已从 `./manualButton` 引入；重试按钮文案沿用其内部 `手动翻译`——如需"翻译失败 · 点此重试"，给 `renderManualButton` 增一个可选 `label` 参数，默认 `'手动翻译'`，domScan 传 `'翻译失败 · 点此重试'`。执行时按 domScan 成功分支既有 `markTranslated`/`saveMessageState` 签名补全占位注释处，勿臆造字段。）

- [ ] **Step 3: typecheck**

Run: `pnpm --dir apps/desktop exec tsc -p tsconfig.web.json --noEmit`（覆盖 inject；执行时以能编译 `src/inject` 的配置为准）
Expected: 无错误。

- [ ] **Step 4: 起 dev + CDP 验收（先置可见）**

Run: `pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223`（主进程重启是用户的手；dev 起后 CDP 侧脚本由助手跑）
先 `powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1` 并在页内断言 `document.visibilityState === 'visible'`。

`tmp/p7f-domscan-cdp.mjs`（**不 commit**）：注入桩让 `translate-api` 对某条消息回 `degraded:true`（可临时把会话档 channel 指到无凭据渠道，或用 CDP 直接调 `translateOne`）→ 断言气泡上出现 `CSS_CLASSES.TRANSLATE_ERROR` 的按钮节点（`translation-<msgId>`），非静默消失；点按钮 → 断言发出一次 `noCache:true` 请求；把 channel 换回可用 → 点重试后断言渲染出译文且 `markTranslated`。真实登录会话须用户在场（外网/代理/开关会话）。

Run: `node tmp/p7f-domscan-cdp.mjs`
Expected: 三断言全绿（降级显式失败 / 重试发 noCache / 命中回显不再问厂商）。窗口不可见导致点击落空时，先确认 `visibilityState==='visible'` 再判定，别把遮挡当失败、也别用合成 `element.click()` 代替真实点击（见既有 CDP 记忆）。

- [ ] **Step 5: 前端单测回归**

Run: `pnpm --dir apps/desktop run test:unit`
Expected: 全绿（含 Task 2/4 新增用例）。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/inject/core/translation/domScan.ts apps/desktop/src/inject/core/translation/manualButton.ts
git commit -m "feat(P7/翻译): domScan 带 msgId 发请求；degraded 显式挂可点重试(noCache)，isNoop 收口到非降级"
```

---

## Task 7: 全量回归 + 真实登录档 + 验收文档

**Files:**
- Create: `docs/notes/2026-09-27-message-translation-persistence-verification.md`

- [ ] **Step 1: 机械全量回归**

Run: `cd apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test`
Run: `pnpm --dir apps/desktop run test:unit`
Run: `node tmp/p7f-translate-contract.mjs`
Expected: 三者全绿。

- [ ] **Step 2: 真实登录档（需用户在场）**

按 spec §8.4：一条已译消息滚出再滚回 → 从库里回显、不再问厂商；把厂商打挂（用户关代理）后新消息 → 显"翻译失败"+可点重试；恢复后点一下入库、下次直接回显。**不真发消息**。跑完才把对应格标"实测"，未跑完标"待验证"。

- [ ] **Step 3: 写验收文档（四档 + 证据词）**

`docs/notes/2026-09-27-message-translation-persistence-verification.md`：按 C11 四级证据词逐条记 后端契约 / node:test / 注入层 CDP / 真实登录 四档结论；已知限制沿用 spec §7（会话档改动仍不即时重译存量气泡、一列一个方向、TG 未接）。

- [ ] **Step 4: Commit（仅文档）**

```bash
git add docs/notes/2026-09-27-message-translation-persistence-verification.md
git commit -m "update(P7/翻译): 消息级译文回显 + 降级可见重试 验收文档"
```

（绝不 push；绝不 commit `tmp/` 驱动与 `…legacy-feature-gap.md`。）

---

## 自审（写完计划后本人复核，执行前）

- **Spec 覆盖**：§2 数据模型 → Task 1；§3 读回显 → Task 3；§4 写入/懒填 → Task 1（mapper）+ Task 3（helper）；§5 注入层降级可见 → Task 6；§6 msgId 白名单/作用域不削弱 → Task 5；§8 验证四档 → Task 3/4/2/6/7。TG 落地（§7 外）、会话档即时重译（§7 明确不做）不在本计划。
- **占位扫描**：Step 内所有"见既有形/占位注释处"均指向具体文件与函数签名，要求执行者先 Read 再补、不臆造字段——非 TBD。
- **类型一致**：`msgId`（前端）↔ `msg_id`（列）↔ `getMsgId()`（实体）；`TranslateDTO.msgId()` 与 `ipc` 白名单、`TranslateRequest.msgId` 同名；`saveTranslation(id,msgId,translatedBody,translatedLang)` 与 Task 1 声明一致；回显 `TranslateVO(...,cached=true,...)` 与既有 12 参构造顺序对齐（执行者 Read `TranslateVO` 确认参数序）。
