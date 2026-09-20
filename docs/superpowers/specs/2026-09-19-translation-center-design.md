# P5 翻译中心设计（DOM-only 注入渲染闭环）

日期：2026-09-19
阶段：P5（feature-checklist `B2 翻译中心：4 渠道 + 节点测速 + 模拟翻译 + 译文缓存`）
前置：P2b 注入骨架、P4b 快捷回复 / 素材库

---

## 0. 目标与约束

把翻译做成一条可验证的闭环：**设置在库里 → 后端按设置解析语向并出译文 → 注入层把译文渲染到 WhatsApp 页面气泡下 → 输入框出发送前预览**。

硬约束：

- **译文默认由本地 Java 模拟引擎生成**。渠道与节点是本项目内的可配置数据 + 选择规则，测速不产生任何网络请求。唯一的线上出口是 §9 的百度/腾讯线上翻译适配器：仅在用户在「密钥配置」里填入密钥后启用，未配置或调用失败一律回退模拟引擎并显式标降级。
- 数据落在本地 MySQL `smartscrm_react`；Java 后端是唯一数据层。
- 注入层运行在真实 WhatsApp Web 页面内，保留内嵌真页面的能力。
- 前端只用 pnpm 构建；后端用 JDK17 + `./mvnw`。

核心语义规则（实现与验收都以此为准，不得自行放宽）：

| # | 规则 |
|---|---|
| R1 | **气泡译文按归属选语向**：本端发出的气泡走 `send` 语向，对方发来的气泡走 `receive` 语向；输入框发送前预览同样走 `send` |
| R2 | 语向、渠道、生效节点一律由**后端按 JWT 定位设置行**解析；页面与注入层都不下发语言参数 |
| R3 | 缓存单层、按租户隔离，key **不含会话维度** |
| R4 | 渠道 2（DeepL）的源语言与目标语言是两张不同的候选清单 |
| R5 | 节点 `hk` 仅在"已启用的 receive / send 渠道都为 1"时可选（只支持 Google 线路） |
| R6 | 自动选优：候选 = 延迟有限 且 兼容；取最小；**当前节点已是最小时保持不变**（滞回，避免来回跳） |
| R7 | `from == to` 时直接返回原文，且不写缓存 |
| R8 | 任何情况下不返回空白译文；无法处理时返回原文并标 `partial` |
| R9 | 测速不拖慢接口：接口绝不 `sleep` 去模拟网络延迟 |
| R10 | 译文与原文一致时**不挂译文行**（`from == to` 的那类气泡只留原文一行） |

---

## 1. 范围

### 1.1 做

| # | 内容 |
|---|---|
| 1 | Flyway `V5__translation.sql`：设置表 / 节点表 / 译文缓存表 / 模拟词典表 + 节点与词典种子 |
| 2 | 后端 API：设置读写、节点元数据、模拟测速、`POST /api/translation/translate`、缓存统计 |
| 3 | 注入渲染层：`view:invoke` 空桩换成真实转发；可见消息扫描 → 气泡下插译文节点 → 重试上限出"手动翻译"；输入框发送前译文预览 |
| 4 | 渲染层"翻译中心"页：设置 + 节点测速 + 缓存统计 + 翻译试用 |
| 5 | 主 → 页面通道补齐（前置修复，见 §4.1） |

### 1.2 不做（明确推迟）

- **wa-js / WPP 依赖**：按既有决定推迟到 P6 之前。因此 P5 没有消息体 API 级读取、图片/媒体翻译、语音转写、跨设备已发送原文回溯、聊天历史入库。
- **按会话 / 客户的语言覆盖**：`translation_setting` 预留 `scope` / `scope_key` 两列，P5 只读写 `scope='global'`；每客户覆盖的 UI 与解析随 P6 聊天记录一起落。
- **流式（SSE）输入预览**：本地引擎即时返回，改为单次请求 + 300ms 防抖。
- **语音翻译本体**：`voice_enabled` 开关落库、UI 可见并标注"暂未生效"，P5 无实际效果。
- **Telegram 渲染**：翻译引擎按平台无关方式放在 `inject/core/translation/`，P5 只接 WhatsApp 选择器；TG 只差一组 `selectors.ts` 常量，排在 P5 之后。
- **防撤回**：属 P7 看门狗域。
- `translate-voice-api` / `translate-media-api` / `translate-media-cancel` 三个 IPC 通道 P5 **不注册** handler，不留半成品。

### 1.3 验收

- `pnpm typecheck`（node / web / inject 三个 tsconfig 全绿）+ `pnpm build`（含 `build:inject`）。
- `./mvnw` 编译通过 + V5 迁移落库 + §6.1 curl 契约用例逐条通过。
- §6.3 桌面端手工清单需要用户真实扫码登录 WhatsApp Web 才能勾掉；**没跑完之前不得声称渲染已验证**。

---

## 2. 数据模型 `V5__translation.sql`（`V6` 只改线路注释）

沿用 V4 风格：反引号、`DATETIME(3)` 默认 `CURRENT_TIMESTAMP(3)` + `ON UPDATE`、`uk_` / `idx_` / `fk_` 前缀、
`InnoDB` + `utf8mb4_unicode_ci`、英文注释。

### 2.1 `translation_setting`（每租户一行全局设置）

```sql
CREATE TABLE `translation_setting` (
  `id`                           BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`                    BIGINT      NOT NULL,
  `scope`                        VARCHAR(16) NOT NULL DEFAULT 'global' COMMENT 'global | customer (customer reserved for P6)',
  `scope_key`                    VARCHAR(64) NULL                      COMMENT 'customer id when scope=customer',
  `server`                       VARCHAR(16) NOT NULL DEFAULT 'sg'     COMMENT 'translation node name',
  `server_mode`                  VARCHAR(8)  NOT NULL DEFAULT 'auto'   COMMENT 'auto | manual',
  `channel`                      VARCHAR(4)  NOT NULL DEFAULT '1'      COMMENT '1=Google 2=DeepL 3=ChatGPT 4=Gemini 5=百度 6=有道 7=腾讯',
  `receive_enabled`              TINYINT(1)  NOT NULL DEFAULT 1,
  `receive_from_lang`            VARCHAR(16) NOT NULL DEFAULT ''       COMMENT 'empty = auto detect',
  `receive_to_lang`              VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
  `send_enabled`                 TINYINT(1)  NOT NULL DEFAULT 1,
  `send_from_lang`               VARCHAR(16) NOT NULL DEFAULT '',
  `send_to_lang`                 VARCHAR(16) NOT NULL DEFAULT 'en',
  `voice_enabled`                TINYINT(1)  NOT NULL DEFAULT 1,
  `preview_enabled`              TINYINT(1)  NOT NULL DEFAULT 1        COMMENT 'input live preview',
  `enter_to_send`                TINYINT(1)  NOT NULL DEFAULT 0        COMMENT 'Enter = translate then send',
  `disable_chinese`              TINYINT(1)  NOT NULL DEFAULT 1,
  `disable_chinese_prevent_send` TINYINT(1)  NOT NULL DEFAULT 0,
  `created_at`                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tset_tenant_scope` (`tenant_id`, `scope`, `scope_key`),
  CONSTRAINT `fk_tset_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT 'translation settings per tenant';
```

默认值：`sg` / `auto` / 渠道 `1` / receive→`zh-CN` / send→`en` / voice 开 / 预览开 / 回车发送关 / 中文拦截开
（`preventSend` 关）。

**不入库**：渠道清单（固定枚举 1–4）、语言清单（前端静态数据，§5.2）。

### 2.2 `translation_node`（7 节点，`url` 仅展示、永不请求）

```sql
CREATE TABLE `translation_node` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(16)  NOT NULL COMMENT 'sg | my | my2 | id | hk | uk | us',
  `label`         VARCHAR(32)  NOT NULL,
  `url`           VARCHAR(255) NOT NULL COMMENT 'display only; never requested in this project',
  `base_delay_ms` INT          NOT NULL DEFAULT 0,
  `reachable`     TINYINT(1)   NOT NULL DEFAULT 1,
  `sort`          INT          NOT NULL DEFAULT 0,
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tnode_name` (`name`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT 'translation nodes (metadata only)';
```

- 种子：7 行 `sg / my / my2 / id / hk / uk / us`，`base_delay_ms` 取 20–180 区间的固定值。
- **`my2` 置 `reachable = 0`**，用于让"测速返回 `null` → 自动选优跳过"这条分支可被验证（迁移注释里写明是模拟设定）。
- `hk` 的兼容规则（R5）不落表，保留在前端逻辑里。
- 节点**不参与引擎计算**：只影响测速展示与自动选优结果，将来接入真实通道时才成为路由参数。

### 2.3 `translation_cache`

```sql
CREATE TABLE `translation_cache` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT       NOT NULL,
  `cache_key`   VARCHAR(96)  NOT NULL,
  `type`        VARCHAR(8)   NOT NULL COMMENT 'receive | send',
  `channel`     VARCHAR(4)   NOT NULL,
  `from_lang`   VARCHAR(16)  NOT NULL DEFAULT '' COMMENT 'empty = auto detect',
  `to_lang`     VARCHAR(16)  NOT NULL,
  `source_text` TEXT         NOT NULL,
  `target_text` TEXT         NOT NULL,
  `partial`     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = 词典未全覆盖，含原文片段',
  `hit_count`   INT          NOT NULL DEFAULT 0,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tcache_tenant_key` (`tenant_id`, `cache_key`),
  KEY `idx_tcache_tenant_hit` (`tenant_id`, `hit_count`),
  CONSTRAINT `fk_tcache_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT 'translated text cache, tenant scoped';
```

- `cache_key = {type}-{channel}-{fromLang}-{toLang}-{xxhash64Hex(normalizedText)}`，`fromLang` 为空时写 `auto`。
- **必须按 `tenant_id` 分片**：`source_text` 是客户消息内容，跨租户共享缓存等于串数据。
- 会话维度不进 key（R3）：同一句话在不同会话各存一份会让命中率统计失真，而缓存内容与会话无关。

### 2.4 `translation_phrase`（模拟词典）

```sql
CREATE TABLE `translation_phrase` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `phrase_key` VARCHAR(64)  NOT NULL COMMENT 'stable slug for a phrase',
  `lang_code`  VARCHAR(16)  NOT NULL,
  `text`       VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tphrase_lang` (`phrase_key`, `lang_code`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT 'seed dictionary for the simulated engine';
```

种子：41 条高频 SCRM 话术（问候 / 询价 / 催付 / 售后 / 节日祝福 / 引导下单）× 8 语种 = 328 行，人工撰写。

### 2.5 实体约定

四个实体（`TranslationSetting` / `TranslationNode` / `TranslationCache` / `TranslationPhrase`）必须带

```java
@TableField(update = "CURRENT_TIMESTAMP(3)")
private LocalDateTime updatedAt;
```

否则 `updateById` 会把加载出来的旧时间写回去、抑制 `ON UPDATE`；可空字段清空一律走
`LambdaUpdateWrapper.set(...)`，因为 `updateById` 跳过 null。

---

## 3. 后端 API 与模拟引擎

### 3.1 新增文件

```
entity/  TranslationSetting.java · TranslationNode.java · TranslationCache.java · TranslationPhrase.java
mapper/  ×4
service/ TranslationService.java              设置 get-or-create、缓存读写、测速、统计
         SimulatedTranslationEngine.java      归一化 → 最长匹配 → 渠道风格
web/     TranslationController.java
web/dto/ TranslateDTO.java · TranslationSettingInput.java
web/vo/  TranslateVO.java · TranslationSettingVO.java · TranslationNodeVO.java
         ServerDelayVO.java · TranslationCacheStatsVO.java
resources/db/migration/V5__translation.sql
pom.xml  + net.openhft:zero-allocation-hashing   （xxhash64）
```

沿用现有约定：`ApiResponse<T>`、`@AuthenticationPrincipal AuthPrincipal`、错误码
`40000`（参数）/ `40100`（未鉴权）/ `40404` / `40901` / `50000`。

### 3.2 接口

| 方法 | 路径 | 语义 |
|---|---|---|
| GET | `/api/translation/settings` | 读全局设置；缺行则插入默认行后返回 |
| PUT | `/api/translation/settings` | **局部提交**：字段不传即保留库里现值，只校验传进来的那些（`channel ∈ 1..7`、`server ∈ translation_node.name`、`toLang` 传了就不能是空白）。DTO 上不设 `@NotBlank` —— 参数校验挡在方法之前，会把只带改动字段的请求整个否掉，页面被迫整表回写；整表回写拿的是打开页面时的那份快照，会盖掉之后别的写入 |
| GET | `/api/translation/nodes` | 节点元数据（`name / label / url / baseDelayMs / reachable`） |
| GET | `/api/translation/nodes/delays` | `[{name, delay}]`；`delay = base_delay_ms + jitter(0..30)`，`reachable = 0` → `delay = null` |
| POST | `/api/translation/translate` | 见 §3.3 |
| GET | `/api/translation/cache/stats` | `{totalKeys, totalHits, top:[{cacheKey, sourceText, targetText, hitCount, partial}]}`（Top 10） |

渠道清单与语言清单不提供接口（前端静态数据）。

### 3.3 `POST /api/translation/translate`

请求：`{ text: string, type: 'receive' | 'send', input?: boolean, noCache?: boolean }`
响应：`{ translation, cached, partial, containsChinese, type, channel, fromLangCode, toLangCode, cacheKey }`

处理顺序：

1. 由 JWT 取 `tenantId`，读 `translation_setting` 的 `scope='global'` 行；
   `type='receive'` → 用 receive 三项，`type='send'` → 用 send 三项（R2）。
2. 归一化文本（§3.4 步骤 1）。空文本 → `40000`；长度 > 5000 → `40000`。
3. 拼 `cache_key`（§2.3）。
4. `noCache !== true` 时读缓存：命中 → `hit_count` 自增（`setSql`）→ 返回 `{cached: true}`。
5. `fromLang == toLang` → 直接返回原文，不写缓存（R7）。
6. 未命中 → 模拟引擎生成 → **仅当 `input !== true` 时**写缓存 → 返回 `{cached: false}`。
   输入预览文本是用户半成品，逐键写库会塞进大量碎片键、污染命中统计。

### 3.4 `SimulatedTranslationEngine`

1. **归一化**：`trim` + 连续空格折叠为单个空格，保留换行（多行消息常见）。归一化结果同时用于 hash 与匹配。
2. **支持语向** = 8 语种：`zh-CN en vi id lo hi my ms`（与 P14 i18n 的语种集一致）。
3. **降级**：8 语种以外的语向一律返回原文并置 `partial = true`（R8，绝不返回空白）。
4. **匹配**：按"源 → 目标"取 `translation_phrase` 候选，对文本做**最长匹配**替换；未命中片段原样保留
   （机翻 code-switching 观感），只要有未命中片段就 `partial = true`。
   短语按**字面量**匹配且**忽略大小写**（词典存 `Hello`，客户手打的是 `hello` / `HELLO`）；
   无大小写概念的语种不受该标志影响。替换一律取词典的目标写法，不还原原文大小写。
   **自动检测**（`from` 为空）：对 8 个源语种各跑一遍最长匹配，取命中字符总数最大的语种作为实际源语言；
   全为 0 时按步骤 3 降级。
5. **渠道风格**（提供可观测差异，不假装有质量差异）：
   - `1 Google`：原样输出
   - `2 DeepL`：压缩多余空白
   - `3 ChatGPT` / `4 Gemini`：目标 `en` 时句首大写并补 `.`；目标 `zh-CN` 时句末补 `。`
   - `5 百度`：原样输出（与 `1` 同风格，差异只体现在缓存键上；配置密钥后该线路走 §9 线上适配器，此风格仅在未配置/降级时生效）
   - `6 有道`：先压缩空白，再按目标语言收句（同 `3`/`4` 的句号规则）
   - `7 腾讯`：给整条译文套上目标语言的引号——`en` 用 `"…"`，`zh-CN` 用 `「…」`（配置密钥后走 §9 线上适配器，此风格仅在未配置/降级时生效）

   未列入的语向一律不加任何加工：风格只认 `en` 与 `zh-CN`，其余原样输出。
   切渠道必然换 key，因此每次都会重译，UI 上能看到差异。
6. **不做人为延迟**（R9）。
7. **改匹配规则等于改译文**：`translation_cache` 存的是最终答案（连 `partial` 一起存），
   引擎语义或词典变更后必须清掉受影响的缓存行，否则页面上仍是旧答案。缓存键含渠道与语向，
   不含引擎版本，所以这类变更属于运维动作，不入库、不写进功能开关。

### 3.5 中文拦截

`containsChinese` = 对 `translation` 跑正则 `[\u4e00-\u9fa5]`。
注入层据此：`disable_chinese` → 显示提示；`disable_chinese_prevent_send` → 拦截发送按钮点击并提示。

---

## 4. 注入渲染层（DOM-only）

### 4.1 主进程改动（含两处前置修复）

```
main/webContentsView/manager.ts     + sendToView(viewId, channel, payload)   // 走 view:host:<channel>
main/webContentsView/ipc.ts         + wcv-send-to-view handler
                                    + view:invoke 由空桩改为按 channel 分派
main/services/translationBridge.ts  新增：translate-api → Java 的 fetch，注入 Authorization: Bearer
```

**前置修复 1：主 → 页面通道是断的。** `preload/view.ts:19` 已在监听 `view:host:${channel}`，
但主进程**没有任何发送方**，设置变更推不到注入层。`sendToView()` 补上这个缺口。

**前置修复 2：通道名对不上。** `BaseInjector.ts:79-85` 监听 `lang-setting-change` / `voice-setting-change`，
而 `constants/events.ts:44-45` 定义的是 `update-lang-setting` / `update-voice-setting` —— 当前是死代码。
P5 改为引用常量，并补 `update-preview-setting` 常量与接收端。

主进程**不缓存也不解析翻译设置**：`translate-api` 只做校验 + 转发 + 带 token。
语言/渠道/节点全部由后端按设置行解析（R2），因此主进程侧不存在"设置缓存要失效"的问题；
§5.4 的推送只更新注入层里的**开关**（是否翻译 / 是否预览 / 是否拦截），与译文内容无关。

### 4.2 通道契约与安全

注入脚本运行在第三方页面里，页面上任何脚本都能调 `window.ele.invoke`，因此：

- `view:invoke` 通道白名单：P5 只有 `translate-api`。
- 页面可传字段：`text` / `type` / `input` / `noCache`。**不含**语言、渠道、节点、token。
- `text` ≤ 5000 字符；每个 `viewId` 令牌桶 20 req/s；超限返回 `null`（前端按"无译文"降级）。
- 响应只含译文与元信息（语向、渠道、缓存键、布尔标记），不含凭据与后端地址。
- JWT 只存在于主进程 `getSession()`（`main/state/session.ts`），不进 preload、不进页面。

### 4.3 注入层新增文件

```
inject/core/translation/translationQueue.ts    请求节流 + 在途去重
inject/core/translation/bubbleDirection.ts     气泡归属算术（左右留空判边）+ 同语言不挂行判定
inject/core/translation/messageState.ts        Map<msgId, {text, type, toLang, channel, translation?, retryCount}>
inject/core/translation/domScan.ts             #main 内消息扫描（MutationObserver + 兜底 interval）
inject/core/translation/renderTranslation.ts   插入 / 更新 / 移除译文节点
inject/core/translation/manualButton.ts        重试耗尽 → 「手动翻译」按钮
inject/core/translation/inputPreview.ts        发送前预览 + 回车即译即发 + 中文拦截提示
inject/platforms/whatsapp/index.ts             hookInput / setupPlatformListeners 接线
```

- **节流与扫描**：请求节流 `TRANSLATE_THROTTLE_TIME=300`；扫描 = MutationObserver + `MESSAGE_SCAN_INTERVAL=500`
  兜底 interval。**只有这两个定时器**，不引入第三个轮询。
- **消息标识与归属语向**：msgId 取行容器的 `data-id`。归属由平台适配器 `isOutgoingMessage(row): boolean | null`
  给出（基类返回 `null`，未实现检测的平台一律按收到的处理），WhatsApp 按两级判据：
  ① 行内 `[data-icon="tail-out"] / [data-icon="tail-in"]`（语义确定，但只有分组末条才有）；
  ② 气泡在 `[role="row"]` 里的左右留空比对，贴右缘是发出、贴左缘是收到，差值不足 `MIN_SIDE_GAP_DIFF=24` 判不出。
  实测（2026-09-20 桌面端核对）：当前 WhatsApp Web 的 `data-id` 已不带 `true_/false_` 前缀，祖先链上也没有
  `message-in / message-out` class，所以这两级判据之外没有更可靠的信号。
  语向随译文一起存进 `messageState`，下一轮扫描发现判据变了就重译——首屏布局未定时判据可能先给不出答案，
  这一条让页面在无人改设置的情况下自己翻回正确语向（`tmp/p6-r1-selfheal.mjs`）。
  译文与原文一致时撤掉占位、不挂译文行（R10）。
- **真实 DOM 契约**（2026-09-19 桌面端核对所得，选择器一律集中在
  `inject/platforms/whatsapp/selectors.ts`）：
  | 语义 | 选择器 | 为什么是它 |
  |---|---|---|
  | 观察容器 | `div#main` | 切会话时整个面板重建，挂在行上会一换会话就失去 MutationObserver |
  | 一条消息的行 | `#main .copyable-area [data-id]` | `data-id` 挂在外层 div；这一层铺满面板宽度，**不是**气泡 |
  | 消息正文 | 行内 `span.copyable-text` | 外层 `div.copyable-text` 的 `textContent` 把发送时间和状态图标的字体连字（`早上8:04wds-ic-read`）一起包进来；取不到内层 span（纯表情、系统提示）就当没有文本，宁可不译 |
  | 译文锚点 | 行内 `div.copyable-text` | 行容器满宽，译文挂在行上会跑到面板左缘、与右侧气泡脱节；锚点才是与消息同宽同侧的那一层。`PlatformAdapter.getTranslationAnchor()` 默认返回行本身，平台按需覆写 |
  | 展开控件 | `[data-testid="caption-read-more-button"]` | 见 §4.4 |
- **译文节点契约**：译文宿主 `id="translation-{msgId}"`，内层 `<span class="translated-text">`；
  「手动翻译」入口复用 `CSS_CLASSES.MASK`。读取译文时只认 `.translated-text`——失败态的同一个宿主节点里
  装的是按钮文字，按整个节点取文本会把按钮当成译文。
  样式类复用 `constants/config.ts:15-22` 的 `CSS_CLASSES`（`scrm-inject-translated` 等）。
- **样式**：注入 bundle 目前没有 CSS 管线 → 首次渲染创建 `<style id="scrm-inject-style">` 一次性写入；
  字号/颜色跟随 WhatsApp 主题变量，不覆盖气泡本身。
- **写回输入框的契约**（`inject/core/editorText.ts`，WhatsApp 的输入框是 ProseMirror）：
  | 动作 | 唯一有效的写法 | 为什么 |
  |---|---|---|
  | 整段替换草稿 | 全选 → **让出一个宏任务（≈60ms）再二次全选** → dispatch 合成 `ClipboardEvent('paste')`（`DataTransfer` 带 `text/plain`），**轮询复核**实际内容 | 编辑器把未信任的整段 `execCommand('insertText')` 静默吞掉——含空格的文本只收前一两个字符再异步回滚，命令却返回 `true`；paste 走它自己的输入事务，整段写成且持久。ProseMirror 对 DOM 选区的吸收是节流轮询的：全选和 paste 落在同一个任务里时，真实鼠标点击后的粘贴事务仍按旧的折叠光标算（译文被**追加**而非替换），所以全选后要等、等完再选一次。文档更新是异步的，所以写完必须复核 `textContent`（`\u00a0` 归一化后再比对），不认合成 paste 的平台再兜底走 `insertText`（整段 → 逐字符，每步复核） |
  | 浮层动作按钮 | `pointerdown` / `mousedown` 上 `preventDefault()` | mousedown 的默认动作是把焦点从输入框抢给按钮；焦点一移位，编辑器异步恢复自己记的光标，写回事务就输掉竞态。按钮 `tabIndex` 保留给键盘可达 |
  | 清空草稿 | `selectAll` + **可信**退格按键 | `delete` / `forwardDelete` / `insertText('')` 三条命令都返回 `true` 却什么都不删 |
  | 空草稿判定 | `innerText.trim()` 为空 | ProseMirror 的空文档 `innerText` 是 `"\n"` |

  所以 `replaceEditorText()` 是异步的，返回值语义是"是否确认写成"，传空串时是"是否确认删空"；
  平台适配层的 `innerText` 兜底只用于有内容的情况，避免把 DOM 与编辑器文档写成两套状态。
  **验证口径**：写回输入框的回归必须用 CDP `Input.dispatchMouseEvent` 发真实鼠标事件——
  合成 `element.click()` 不经过 mousedown 的默认焦点行为，会把上面两行竞态全部掩盖成"通过"。
- **重译、复用与重试**：状态全在 `messageState.ts`（内存，页面刷新即重置）。
  文本变（消息被编辑）或语言 / 渠道变 → 移除旧节点重译；否则跳过。
  消息滚出可视区后 WhatsApp 会卸载行节点，重新进入时按 `translation-{msgId}` 从表里直接重绘，不再发请求。
  `retryCount` 达到 3 → 渲染"手动翻译"按钮，点击重试一次。
  `StateManager.translatedMsgIds` 只做同页去重。
- **生命周期**：`StateManager._translationTimer`（目前只被 `clear`、从未赋值）正式作为扫描定时器；
  `destroy()` 中清 timer、`observer.disconnect()`、移除浮层与 style 节点。
- **StateManager 字段对齐**：`LangSetting` 改为 `{ enabled, fromLangCode, toLangCode }`，
  `DEFAULT_LANG_SETTING` 拆成 `DEFAULT_RECEIVE_LANG_SETTING = { enabled: true, fromLangCode: '', toLangCode: 'zh-CN' }`
  与 `DEFAULT_SEND_LANG_SETTING = { enabled: true, fromLangCode: '', toLangCode: 'en' }`
  （当前 `config.ts:10` 的 `{ fromLang: 'auto', toLang: 'zh' }` 字段名与值都不成立）。
  注入层**只消费 `enabled` 做门控**，语向一律以服务端解析为准。

### 4.4 折叠长文本

WhatsApp 把长消息折叠时（页面控件文案为「查看更多」，`[data-testid="caption-read-more-button"]`），
DOM 里只有截断文本。P5 的处理：**行内出现展开控件就跳过不译**，
`MutationObserver` 在用户展开后自动补译。**宁可不译，也不译半句。**
展开后译文只补在这一条上，其余已译消息不受影响（核对样本：1311 字符长消息折叠 → 展开 → 补译出译文）。

---

## 5. 前端翻译中心页

### 5.1 新增 / 改动

```
renderer/src/lib/langData.ts             四组语言清单 + 渠道映射 + 名称解析（静态数据）
renderer/src/api/translation.ts          类型 + Query hooks
renderer/src/lib/translationSync.ts      设置开关 → 推送全部视图
renderer/src/components/ui/switch.tsx    新增（现有 ui/ 无开关；radix-ui 已在依赖里）
renderer/src/pages/TranslationPage.tsx   页面
renderer/src/layouts/AppLayout.tsx       挂 useTranslationSync()
renderer/src/lib/nav.ts + App.tsx        /translation 路由 + 「翻译中心」nav（icon Languages）
```

### 5.2 渠道 ↔ 语言清单（R4）

| 渠道 | 源语言候选 | 目标语言候选 |
|---|---|---|
| 1 Google | `allLanguages` | `allLanguages` |
| 2 DeepL | `deeplSourceLanguages` | `deeplTargetLanguages`（**两张不同清单**） |
| 3 ChatGPT | `chatGptLanguages` | `chatGptLanguages` |
| 4 Gemini | `allLanguages` | `allLanguages` |
| 5 百度 | `allLanguages` | `allLanguages` |
| 6 有道 | `allLanguages` | `allLanguages` |
| 7 腾讯 | `allLanguages` | `allLanguages` |

`5` / `6` / `7` 三条是后加的，候选清单一律回落 `allLanguages`（引擎能真正出译文的仍是 §3.4 的 8 语种）；
渠道与节点的兼容规则不因它们改变：`hk` 仍然只服务 `1 Google`。

四组清单都是 `lib/langData.ts` 的导出常量，纯静态内容（约 100 语言 × 多个语种名列），不入库。
显示名当前取中文列，缺失回退英文列；其余语种名列一并带上，P14 接 i18n 时按 locale 取列，无需二次整理。

### 5.3 布局（宝蓝 + 金色，两栏）

- 左栏「翻译设置」四张 Card：
  1. **节点与线路** — 节点选择（`auto` + 7 节点，选项内嵌延迟徽标）/ 线路（4 渠道）
  2. **接收翻译** — 开关 + 源语言（空＝自动检测）+ 目标语言 + 语音翻译开关（标"暂未生效"）
  3. **发送翻译** — 开关 + 源语言 + 目标语言 + 实时预览开关 + 回车即译即发开关（默认关）
  4. **风控** — 中文拦截开关 + 阻止发送开关（文案："开启后若消息含中文将拦截发送并提示"）
- 右栏上：**节点测速** — 7 行，延迟徽标 绿 `<60` / 黄 `<120` / 红 `≥120` / 灰 `不可达`；
  当前生效节点高亮；auto 模式显式标出被跳过的原因（`hk` "仅支持 Google 线路"、`my2` "不可达"）；「重新测速」按钮。
- 右栏中：**译文缓存统计** — 键数、总命中数、Top 5 命中条目。
- 右栏下：**翻译试用** — 输入文本 → `POST /translate`，显示译文 / `cached` / `partial` / `cacheKey`。
  这是**不登录 WhatsApp 也能验证引擎与缓存的唯一入口**，属必做项。

### 5.4 交互规则

- 保存：字段变更 debounce 500ms → `PUT` → invalidate + 推送开关到所有已打开视图。
- 测速时机：进入页面一次、「重新测速」一次、保存设置后一次。**不做定时轮询**（R6 滞回 + 不抖）。
- 自动选优在前端完成（R5 / R6），结果 `PUT` 回 `settings.server`，`serverMode` 保持 `auto`。
- `useTranslationSync()` 挂在 `AppLayout`：订阅 settings query 变更 → 对 `wcv-get-open-ids` 返回的每个
  viewId `sendToView('update-lang-setting', flags)`；同时监听 `view:state` 的 `created` 事件，给新建视图补推一次。
  这条链断了就表现为"设置改了不生效"，所以 §6.3 给它单独一个验收动作。

---

## 6. 测试与验收

### 6.1 后端 curl 契约（`http://localhost:8180`，本地库）

| 用例 | 期望 |
|---|---|
| 新用户 GET settings | 默认行 sg / auto / 渠道 1 / receive→zh-CN / send→en |
| PUT `channel: "9"` | `40000` |
| PUT `server: "xx"` | `40000` |
| GET nodes/delays | 7 项；`my2.delay === null`；两次调用 delay 有抖动 |
| POST translate 首次 | `cached: false` |
| 同文本二次 POST | `cached: true`，`hit_count` 变 1 |
| 渠道 1 → 2 同文本 | `cached: false`（key 含渠道） |
| `from == to` | 返回原文，第二次仍 `cached: false`（R7） |
| `noCache: true` | 跳过读缓存 |
| `input: true` | 命中不写（第二次同文本 `cached: false`，且不产碎片键） |
| 语向 `sw → is`（词典外） | 译文 == 原文 + `partial: true`，不报错（R8） |
| `text` 5001 字符 | `40000` |
| 渠道 3 + `en` 目标 | 句首大写 + `.`；渠道 1 同文本保持原样 |
| cacheKey 形状 | `{type}-{channel}-{from}-{to}-{16 位 hex}` |
| 跨租户 | A 写入后 B 同文本 → `cached: false`（R3） |
| 无 token POST translate | `40100` |

curl 注意（见项目记忆 `verify-over-http-api.md`）：中文 payload 必须 `--data-binary @file`，
Git Bash 内联中文会静默失败；没有 mysql CLI，查库走 HTTP；自测产生的缓存键验收后清理，DEMO 种子保持原样。

### 6.2 前端构建

`pnpm typecheck`（node / web / inject）+ `pnpm build` 全绿；
`#/translation` 各控件键盘可达（radix 默认行为）；nav 第 7 项在 1280 宽下不挤压 `ModuleRail`。

### 6.3 桌面端手工清单（需真实登录 WhatsApp Web）—— 2026-09-19 已核对

核对方式：CDP 驱动 `tmp/p5-manual.mjs`，阶段 `setup | bubbles | fold | push | preview | chinese | offline`，
在真实 WhatsApp Web 内嵌视图上按用户动作点，断言页面 DOM 与后端可见事实；截图在 `tmp/shots/6-3-*.png`。
首跑暴露 3 个缺陷（译文挂到整行左缘、开关推送在重新注入后丢失、清空草稿后浮层不收），修复后 **23/23 通过**。
其中输入框相关的两项后经返工：见本节末「两处返工」。
R1 更正后于 2026-09-20 复跑 `bubbles` 阶段：**8/8 通过**（新增两条：归属判据的独立几何对照、R10 的"要么挂行要么原文已是目标语言"）。
该阶段的会话点开改成 `ensureChatOpen()` 轮询 —— 只点一次 + 固定 sleep 时，页面刚重载会读到 0 行气泡，整套断言一起红。

- [x] 气泡下出现译文节点，`.translated-text` 有文字 —— 会话内的文本气泡要么渲染出译文、要么原文已是该语向的目标语言
  （R10，2026-09-20 复跑读数：15 条有正文不折叠的气泡，7 条挂行、8 条原文已是英文故不挂）；译文落在气泡本体里；
  纯表情行与系统提示行按 §4.3 契约不产生译文。
  **未覆盖：对方发来的气泡。** 当前账号的会话列表里只有「自己」这一个会话，`tail-in` 形态无法观测。
- [x] 气泡按归属选语向（R1，2026-09-20 更正后重核）—— 自己发出的气泡请求 `type='send'`，中文气泡渲染出英文行
  （你好 → Hello、你在干嘛 → What are you doing?、你今年几岁 → How old are you this year?），
  已是目标语言的气泡不再挂重复行（R10）；判据与请求 type 逐条对照见 `tmp/p6-r1-verify.mjs`、`tmp/p6-r1-snapshot.mjs`。
  **更正记录**：本项首版按旧 R1 核对的是「气泡一律 `type='receive'`」，那条规则会让中文气泡译成中文自己，已作废。
- [x] 归属判据失效后自愈（首屏布局未定的等价场景）—— 页内把 `isOutgoingMessage` 打桩成判不出，重译一轮：
  中文气泡 5 条全部不挂行、外文气泡 10 条挂中文译文；只撤打桩、不改任何设置，中文气泡重新长出英文行。
  `tmp/p6-r1-selfheal.mjs` 记 PASS。
- [x] 语向开关各管一侧 —— 页内关「发送翻译」后自己发出的气泡译文全部撤下，恢复后重新出译文（`tmp/p6-r1-toggle.mjs`）。
  本会话全是发出侧，故「关接收翻译只影响对方气泡」这半句仍无从观测。
- [x] 关闭"接收翻译"→ 推送后新消息不再插译文（§5.4 推送链）—— 走翻译中心保存 →
  `toHost:translation-flags-applied` 回执 → 视图 `state` 与库一致。开关在翻译中心页改动时视图已被 uninject，
  所以断言点放在「回工作台重新注入之后」。
- [ ] 切会话不残留旧 `translation-*` —— **未核对**：只有一个会话可用，无从切换。
- [x] 滚出再滚回 → 译文由内存表立即重绘、不发新请求 —— 移除 `translation-{msgId}` 节点后由重绘分支补回，
  请求计数增量为 0。**替代说明**：会话只有 5~7 条消息，未触发虚拟列表卸载，故用同一代码分支的节点移除代替滚动。
  **R1 之后这条要等语向落定再测**：归属判据从判不出翻成判得出时，按自愈规则会合法地重发一次；
  首扫跑完（请求日志里 type 全一致、无「翻译中…」占位）之后再抹节点，测出的才是纯重绘。
  2026-09-20 复跑：`tmp/p5-manual.mjs bubbles` 8/8，该项读数 译文节点 7→7、新增请求 0 条。
- [x] 长文本折叠：未展开不译；点「查看更多」后自动补译 —— 样本为 1311 字符长消息，展开后只补这一条。
  **2026-09-20 未复跑**：那条长消息已不在自聊天里（当前会话 17 行，滚到顶也没有带「查看更多」的行），
  本项沿用首跑结论。R1 之后该阶段的请求筛选从 `type='receive'` 改为「非输入框预览的气泡请求」，
  否则自聊天全为发出侧时会筛出空集 —— 改后的口径未在真页上验证过。
- [x] 输入框打字 → 300ms 后浮层出译文；「用译文替换输入框」生效；关预览开关后浮层消失 ——
  浮层在草稿清空后必须收起：WhatsApp 的退格 / 全选删除**不产生 `input` 事件**，
  所以 `inputPreview` 额外挂 `keyup` 监听与输入框 `MutationObserver`（见 §7）。
  **本项首跑是假绿**：当时的样本是 `hello`，其译文与原文相同，"草稿变成译文"无法与"什么都没发生"区分，
  实际按钮点了不写回（§4.3 写回契约）。改用 `你好` → `Hello` 这种译文 ≠ 原文的样本重跑后才成立：
  浮层出 `Hello` → 点「用译文替换输入框」→ 草稿变为 `Hello` → 收尾清空草稿，`tmp/p6-settext-check.mjs` 8/8。
- [x] 后端停服 → 3 次重试后出现「手动翻译」按钮而非无限重试；恢复后点一次出译文 ——
  一次点击只救它自己那一条，其余失败消息仍各自保留按钮。
- [x] 中文拦截 + 阻止发送 → 拦截一次发送并给提示 —— 回车后气泡数不变，浮层文案「消息含中文，已拦截发送」。

**核对期间的副作用（已复位）**：向自聊天发过 3 条测试消息，核对完成后经
右键 →「删除」→ 底栏删除 → 「从我这端删除」全部删除，会话恢复为原有 4 行；草稿框已清空；
`translation_setting` 回到 V5 种子默认（`server=sg`、`serverMode=auto`、`voiceEnabled=true`、
`previewEnabled=true`、`enterToSend=false`、`disableChinese=true`、`disableChinesePreventSend=false`）。
`translation_cache` 只增不减（无清理接口），本轮新增若干行，DEMO 种子未动。

**§6.3 之后的两处返工（2026-09-19）**：上表"「用译文替换输入框」生效"一项为假绿，另有小写 `hello`
不译的问题，两处已各自修复并重新核对（写回契约见 §4.3，匹配语义见 §3.4）。为让新匹配规则在页面上可见，
清空过 `translation_cache`（派生表，可再生）；修复后的气泡核对为 `hello` → `你好` 共 2 条。
本轮核对全程不按回车，未新增会话消息，草稿已确认为空。

---

## 7. 已知限制与风险

- **DOM 类名随 WhatsApp 版本漂移**：`copyable-text`、`caption-read-more-button` 这类名字会变。
  所有选择器集中在 `inject/platforms/whatsapp/selectors.ts`，坏了只改一处。
  退化表现是可预期的：取不到正文 `span.copyable-text` 的行按"没有文本"跳过，最多是不译，不会把
  时间戳和图标连字当消息送出去。
- **模拟词典只 41 条**：真实对话会大面积 `partial: true`。这是刻意的（不假装离线能做真翻译）。
  要更好看有两条独立路径：扩词典，或在 wa-js 落地后接真实通道。
- **`view:invoke` 是新增攻击面**：白名单 + 长度 + 速率三重限制，响应不含凭据。
- **渲染只能在桌面端真机验证**：typecheck / build 覆盖不到 WhatsApp DOM，§6.3 未跑完前不得声明功能完成。
- **译文与会话解耦**：缓存不含会话维度，因此"同一句话在 A 会话已译、B 会话直接命中"，
  这在按客户定制语向（P6）之后需要重新审视 key 形状。
- **WhatsApp 删除草稿不产生 `input` 事件**：退格与全选删除由页面自己消化按键、直接改写 DOM，
  只挂 `input` 监听的浮层会一直挂着旧译文。`inputPreview` 因此额外挂捕获阶段的 `keyup`，
  并对输入框本体开 `MutationObserver`（覆盖"页面代改"：发送后清空、右键删除）。
- **切路由会卸载视图**：工作台之外（含翻译中心）当前活动视图被 uninject，回到工作台才重新注入。
  两个后果：① 设置推送不能只靠广播——广播可能发生在注入之前，那时没有接收方，
  所以渲染层在收到页面的 `toHost:injector-ready` 报到后按 `viewId` 补发一次最新设置；
  ② 任何"改完开关后视图里生效"的核对都必须先回工作台重新注入，否则"没有译文"只是因为注入层整个不在。
- **「手动翻译」按钮按条独立**：一次点击只重试它自己那条消息，不会连带救回其他失败消息。
- **翻译链路失败时没有任何用户可见的反馈**：`requestTranslation()` 把"无 token / 非 2xx / `code != 0` /
  5s 超时"一律收敛成 `null`（凭据不下沉到页面，这是刻意的），代价是页面上只会表现为"没有译文"。
  其中 token 一条有确定成因：主进程磁盘 session 里的 access token 有效期 2h，只有渲染层发出鉴权请求
  拿到 401 才会走刷新并回写；桌面端挂着不动超过 2h 后，内嵌页面的翻译会整片失效，
  而渲染层仍显示已登录。后续要么给注入层一条"翻译不可用"的原因通道，要么让主进程自己续期。
- **注入层不改变普通回车的语义**：`enterToSend` 关闭时，注入层不拦截 Enter，草稿会照常发出去。
  自动化核对脚本因此在按 Enter 前必须确认拦截条件已成立，跑完还要清草稿并核对会话行数。
- **P5 核对的覆盖面**：当前 WhatsApp 账号只有「自己」一个会话，因此对方气泡形态与"切会话不残留"
  两项未核对（见 §6.3）；消息数不足，虚拟化滚动卸载用节点移除分支代替。

---

## 8. 实施切分

| 切片 | 内容 | 完成判据 |
|---|---|---|
| P5a | V5 迁移 + 4 实体 / mapper + `TranslationService` + 模拟引擎 + Controller | `./mvnw` 编译通过，§6.1 全绿 |
| P5b | `sendToView` / `wcv-send-to-view` / `view:invoke` 转发 / `translationBridge` / `BaseInjector` 通道名统一 / 注入层 7 个文件 | `typecheck:inject` + `build:inject` 绿；§6.3 前 5 项 |
| P5c | `langData` + `api/translation` + `switch.tsx` + `TranslationPage` + nav / 路由 + `translationSync` | `pnpm typecheck` + `pnpm build` 绿；§6.3 剩余项 |

每片独立可回滚；测试通过后各提交一次（`feat:` / `fix:` / `update:` 前缀），推送手动执行。

---

## 9. P5d 线上翻译适配器（百度 / 腾讯）

线路 5（百度）与线路 7（腾讯）在配置密钥后改走真实线上 API；其余线路（1–4、6）维持本地模拟引擎不变。

### 9.1 数据与凭据

- `V7__translation_credential.sql`：表 `translation_credential`（`tenant_id + provider` 唯一，`provider ∈ {baidu, tencent}`，字段 `app_id / secret_key / region`），无种子行。
- 密钥 **write-only over HTTP**：GET 只回 `provider/appId/hasSecret/region/updatedAt`，永不回读 `secret_key`；PUT 时 `secretKey` 留空表示保留原值，首次保存必须给密钥。
- 密钥只存在于后端与本地库；不进渲染层 store、不下沉 preload / 注入层。
- `POST /api/translation/credentials/test`：用固定样例「你好，很高兴认识你」（zh-CN → en）真打一次网关，返回 `ok / latencyMs / message`。

### 9.2 适配器

| | 百度 | 腾讯 TMT |
|---|---|---|
| 端点 | `GET fanyi-api.baidu.com/api/trans/vip/translate` | `POST tmt.tencentcloudapi.com` |
| 鉴权 | `sign = MD5(appid + q + salt + 密钥)` | TC3-HMAC-SHA256（`Tc3Signer`，service `tmt`，`X-TC-Action: TextTranslate`，version `2018-03-21`） |
| 长度 | `q` ≤ 5000 字符 | `SourceText` ≤ 5000 **UTF-8 字节**，超限按行切块拼接 |
| 语种码 | `zh/en/vie/…`（自有码表） | `zh-CN/en/vi/…`（`auto` 支持源语言） |

两者都实现 `TranslationProvider`（`providerId / supports / translate(Credentials, …)`），返回 `ProviderResult(translation, detectedFrom)`；失败抛 `ProviderException`（消息带服务商名与错误码，直接面向用户展示）。

### 9.3 路由与降级

- `TranslationService`：`CHANNEL_TO_PROVIDER = {5→baidu, 7→tencent}`。命中该线路且已配置密钥 → 走线上；成功结果照常写 `translation_cache`。
- **未配置密钥或线上调用失败 → 回退模拟引擎**，`TranslateVO` 置 `degraded=true` + `degradeReason`（人可读原因）；**降级结果一律不写缓存**，避免把兜底译文固化。
- `degraded / degradeReason` 随 TranslateVO JSON 透传到注入层与主进程桥（类型已补齐）。

### 9.4 前端（翻译中心）

- 新增「密钥配置」卡片：百度（App ID + 密钥）与腾讯（SecretId + SecretKey + 可选地域）两个表单；保存后密钥输入框清空且永不回读；「测试」按钮就地显示 `可用 · Xms` 或 `不可用：<原因>`。
- 线路徽章：未配置密钥的 5/7 灰显不可点并标「未配置」，配置后标「线上」；页头角标按当前线路显示 `模拟通道 / 线上 · X / 线上未就绪 · 模拟兜底`。
- 试用结果在降级时显示「降级·模拟」并给出原因行。

### 9.5 验证口径

- 签名/切块/语种映射由单测钉死（含 TC3 外部向量）；线上链路以真实网关的**错误转移**为证：假密钥下百度回 `52003 UNAUTHORIZED USER`、腾讯回 `AuthFailure.SecretIdNotFound`，说明端点、签名结构与网络出口均正确。
- **百度已完成真实密钥联调**（2026-09-19，用户在密钥配置卡片填入自有 key）：测试按钮 `可用 · 262ms`；线路 5 下 zh→en 试用返回线上译文 `Hello, the order has been shipped`，`degraded=false`，第二次调用命中缓存。腾讯尚未填入真实密钥，其「线上」结论仍到"网关可达、鉴权被正确拒绝"为止。
- **腾讯真实密钥联调已暂缓**（2026-09-20 决定）：代码与入口就绪，只差配 key 跑通；恢复步骤见 `docs/notes/2026-09-20-tencent-online-translation-deferred.md`。暂缓期间线路 7 保持「线上链路未实跑」口径。
- 免费额度参考（2026-09 核实）：腾讯 TMT 约 500 万字符/月；百度通用翻译约 200 万字符/月。
