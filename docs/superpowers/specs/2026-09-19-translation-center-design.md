# P5 翻译中心设计（DOM-only 注入渲染闭环）

日期：2026-09-19
阶段：P5（feature-checklist `B2 翻译中心：4 渠道 + 节点测速 + 模拟翻译 + 译文缓存`）
前置：P2b 注入骨架、P4b 快捷回复 / 素材库

---

## 0. 目标与约束

把翻译做成一条可验证的闭环：**设置在库里 → 后端按设置解析语向并出译文 → 注入层把译文渲染到 WhatsApp 页面气泡下 → 输入框出发送前预览**。

硬约束：

- **不产生任何线上请求**。4 渠道与 7 节点是本项目内的可配置数据 + 选择规则，译文由本地 Java 模拟引擎生成。
- 数据落在本地 MySQL `smartscrm_react`；Java 后端是唯一数据层。
- 注入层运行在真实 WhatsApp Web 页面内，保留内嵌真页面的能力。
- 前端只用 pnpm 构建；后端用 JDK17 + `./mvnw`。

核心语义规则（实现与验收都以此为准，不得自行放宽）：

| # | 规则 |
|---|---|
| R1 | **所有气泡译文（收到的与自己发出的）都用 `receive` 语向**；`send` 语向只服务输入框发送前预览 |
| R2 | 语向、渠道、生效节点一律由**后端按 JWT 定位设置行**解析；页面与注入层都不下发语言参数 |
| R3 | 缓存单层、按租户隔离，key **不含会话维度** |
| R4 | 渠道 2（DeepL）的源语言与目标语言是两张不同的候选清单 |
| R5 | 节点 `hk` 仅在"已启用的 receive / send 渠道都为 1"时可选（只支持 Google 线路） |
| R6 | 自动选优：候选 = 延迟有限 且 兼容；取最小；**当前节点已是最小时保持不变**（滞回，避免来回跳） |
| R7 | `from == to` 时直接返回原文，且不写缓存 |
| R8 | 任何情况下不返回空白译文；无法处理时返回原文并标 `partial` |
| R9 | 测速不拖慢接口：接口绝不 `sleep` 去模拟网络延迟 |

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

## 2. 数据模型 `V5__translation.sql`

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
  `channel`                      VARCHAR(4)  NOT NULL DEFAULT '1'      COMMENT '1=Google 2=DeepL 3=ChatGPT 4=Gemini',
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
| PUT | `/api/translation/settings` | 全量覆盖；校验 `channel ∈ 1..4`、`server ∈ translation_node.name`、`toLang` 非空 |
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
   **自动检测**（`from` 为空）：对 8 个源语种各跑一遍最长匹配，取命中字符总数最大的语种作为实际源语言；
   全为 0 时按步骤 3 降级。
5. **渠道风格**（提供可观测差异，不假装有质量差异）：
   - `1 Google`：原样输出
   - `2 DeepL`：压缩多余空白、保留原文大小写
   - `3 ChatGPT` / `4 Gemini`：目标 `en` 时句首大写并补 `.`；目标 `zh-CN` 时句末补 `。`

   切渠道必然换 key，因此每次都会重译，UI 上能看到差异。
6. **不做人为延迟**（R9）。

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
inject/core/translation/messageState.ts        Map<msgId, {text, toLang, channel, translation?, retryCount}>
inject/core/translation/domScan.ts             #main 内消息扫描（MutationObserver + 兜底 interval）
inject/core/translation/renderTranslation.ts   插入 / 更新 / 移除译文节点
inject/core/translation/manualButton.ts        重试耗尽 → 「手动翻译」按钮
inject/core/translation/inputPreview.ts        发送前预览 + 回车即译即发 + 中文拦截提示
inject/platforms/whatsapp/index.ts             hookInput / setupPlatformListeners 接线
```

- **节流与扫描**：请求节流 `TRANSLATE_THROTTLE_TIME=300`；扫描 = MutationObserver + `MESSAGE_SCAN_INTERVAL=500`
  兜底 interval。**只有这两个定时器**，不引入第三个轮询。
- **消息标识与方向**：行 `[data-id]` 作 msgId；`data-id` 以 `true_` 开头或行含 `.message-out` → 自己发的。
  两种气泡都按 `type='receive'` 请求（R1）。
- **DOM 契约**：译文节点 `id="translation-{msgId}"`，内层 `<span class="translated-text">`；
  样式类复用 `constants/config.ts:15-22` 的 `CSS_CLASSES`（`scrm-inject-translated` 等）。
- **样式**：注入 bundle 目前没有 CSS 管线 → 首次渲染创建 `<style id="scrm-inject-style">` 一次性写入；
  字号/颜色跟随 WhatsApp 主题变量，不覆盖气泡本身。
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

WhatsApp 把长消息折叠成"阅读更多"时，DOM 里只有截断文本。P5 的处理：**行内出现展开控件就跳过不译**，
`MutationObserver` 在用户展开后自动补译。**宁可不译，也不译半句。**

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

### 6.3 桌面端手工清单（需真实登录 WhatsApp Web）

- [ ] 打开会话 → 对方气泡下出现译文节点，`.translated-text` 有文字
- [ ] 自己发出的气泡也被译，且语向与收到的一致（R1）
- [ ] 关闭"接收翻译"→ 推送后新消息不再插译文（验证 §5.4 的推送链）
- [ ] 切会话不残留旧 `translation-*`；滚出再滚回 → 译文由内存表立即重绘（Network 里无新请求）
- [ ] 长文本折叠：未展开不译；点"阅读更多"后自动补译
- [ ] 输入框打字 → 300ms 后浮层出译文；「用译文替换输入框」生效；关预览开关后浮层消失
- [ ] 后端停服 → 3 次重试后出现「手动翻译」按钮而非无限重试；恢复后点一次出译文
- [ ] 中文拦截 + 阻止发送 → 拦截一次发送并给提示

---

## 7. 已知限制与风险

- **DOM 类名随 WhatsApp 版本漂移**：`copyable-text` / `_ak1q` / `_ak1r` 这类类名会变。
  所有选择器集中在 `inject/platforms/whatsapp/selectors.ts`，坏了只改一处。
  若 `true_` 前缀判方向失效，退化表现是"自己的消息也按 receive 语向译"——正是 R1 要求的行为，不会崩。
- **模拟词典只 41 条**：真实对话会大面积 `partial: true`。这是刻意的（不假装离线能做真翻译）。
  要更好看有两条独立路径：扩词典，或在 wa-js 落地后接真实通道。
- **`view:invoke` 是新增攻击面**：白名单 + 长度 + 速率三重限制，响应不含凭据。
- **渲染只能在桌面端真机验证**：typecheck / build 覆盖不到 WhatsApp DOM，§6.3 未跑完前不得声明功能完成。
- **译文与会话解耦**：缓存不含会话维度，因此"同一句话在 A 会话已译、B 会话直接命中"，
  这在按客户定制语向（P6）之后需要重新审视 key 形状。

---

## 8. 实施切分

| 切片 | 内容 | 完成判据 |
|---|---|---|
| P5a | V5 迁移 + 4 实体 / mapper + `TranslationService` + 模拟引擎 + Controller | `./mvnw` 编译通过，§6.1 全绿 |
| P5b | `sendToView` / `wcv-send-to-view` / `view:invoke` 转发 / `translationBridge` / `BaseInjector` 通道名统一 / 注入层 7 个文件 | `typecheck:inject` + `build:inject` 绿；§6.3 前 5 项 |
| P5c | `langData` + `api/translation` + `switch.tsx` + `TranslationPage` + nav / 路由 + `translationSync` | `pnpm typecheck` + `pnpm build` 绿；§6.3 剩余项 |

每片独立可回滚；测试通过后各提交一次（`feat:` / `fix:` / `update:` 前缀），推送手动执行。
