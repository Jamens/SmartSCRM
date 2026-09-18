# P5 翻译中心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一条可验证的翻译闭环——翻译设置存库、后端按设置解析语向并产出译文、注入层把译文渲染到 WhatsApp 气泡下、输入框出发送前预览。

**Architecture:** Java 后端是唯一数据层：Flyway V5 建 4 张表，`TranslationService` 按 JWT 定位租户设置行解析语向 / 渠道 / 节点，`SimulatedTranslationEngine` 用本地词典做最长匹配生成译文，`translation_cache` 按租户做单层缓存。桌面端把译文送进真实内嵌页面：渲染层"翻译中心"页读写设置并推送开关 → 主进程 `sendToView` / `view:invoke` 转发 → 注入层扫描 WhatsApp DOM 插入译文节点。全链路不产生任何线上请求。

**Tech Stack:** Java 17 · Spring Boot 3.5.16 · MyBatis-Plus 3.5.17 · Flyway · MySQL 8（`smartscrm_react`）· JUnit 5 · Electron 39 + React 19 + TS(strict) + Tailwind v4 + radix-ui + TanStack Query v5 · esbuild（注入 bundle）· zero-allocation-hashing（xxhash64）

**Spec:** `docs/superpowers/specs/2026-09-19-translation-center-design.md`（本计划的规则编号 R1–R9、表结构、接口形状、验收清单全部以该文件为准）

## Global Constraints

逐条抄自 spec，每个任务的隐含前提：

- **不产生任何线上请求**：4 渠道 / 7 节点只是本项目内的可配置数据，译文一律由本地 Java 模拟引擎生成；节点 `url` 仅用于展示，代码里永不请求。
- 数据只落本地 MySQL `smartscrm_react`（`localhost:3306`，root / `1234560`）。不碰旧 `smartscrm` 库。
- 后端只用 `./mvnw`（JDK17）；前端只用 `pnpm`（禁止 npm / npx）。
- **R1** 所有气泡译文（收到与自己发出的）都用 `receive` 语向；`send` 语向只服务输入框发送前预览。
- **R2** 语向、渠道、生效节点一律由后端按 JWT 定位设置行解析；页面与注入层都不下发语言参数。
- **R3** 缓存单层、按租户隔离，key 不含会话维度。
- **R4** 渠道 2（DeepL）的源语言与目标语言是两张不同的候选清单。
- **R5** 节点 `hk` 仅在"已启用的 receive / send 渠道都为 1"时可选。
- **R6** 自动选优：候选 = 延迟有限且兼容 → 取最小 → 当前节点已是最小时保持不变（滞回）。
- **R7** `from == to` 时直接返回原文，且不写缓存。
- **R8** 任何情况下不返回空白译文；无法处理时返回原文并标 `partial`。
- **R9** 测速不拖慢接口：接口绝不 `sleep` 模拟网络延迟。
- 文档 / 注释只描述本项目方案，不写与旧版对比的内容，不引用旧版文件与行号。
- 每个切片测试通过后 `git commit` 一次，前缀 `feat:` / `fix:` / `refa:` / `update:`；**push 由用户手动执行，助手不得 push**。
- 后端验证只走 `http://localhost:8180` 的 HTTP API（本机没有 mysql CLI、Docker 守护进程未运行）。中文 payload 必须先用 Write 工具写成 UTF-8 文件再 `curl --data-binary @file`；Git Bash 内联中文会静默变成服务端 `50000`。
- 本项目桌面端**没有 JS 测试运行器**（无 vitest / jest）。P5b / P5c 的自动化闸门只有 `pnpm typecheck`（node / web / inject 三份 tsconfig）与 `pnpm build`；DOM 与 IPC 的行为验证是 spec §6.3 的手工清单，需用户真实登录 WhatsApp Web 才能勾。**不得在没有手工验证的情况下声称渲染已验证**。

## 对 spec 的五处收敛

计划执行时按下面的写法落地；这五点是 spec 文字落到代码时必须做的决定，先在此声明，避免实现阶段各自发挥：

1. **host → 注入层的推送通道合成一个。** spec §4.1 / §5.4 提到 `update-lang-setting` 与 `update-preview-setting` 两条通道。实际只保留一条 `update-translation-flags`，一次携带 `{ receiveEnabled, sendEnabled, previewEnabled, enterToSend, disableChinese, disableChinesePreventSend, revision }`。三条开关分三次推会引入"半套新值"的中间态，且没有消费方需要分别推送。同时删掉 `BaseInjector` 里当前无人发送的死监听与 `StateManager` 里无人读的 voice 状态。
2. **渠道风格要可观测。** spec §3.4 步骤 5 说 Google "原样输出"、DeepL "压缩多余空白"；但归一化已经折叠了空格，两者会完全一致。落地口径：Google 保留换行，DeepL 把换行折叠成单空格并保留原文大小写，ChatGPT / Gemini 在 `en` 目标时句首大写 + 补 `.`、在 `zh-CN` 目标时句末补 `。`。这样 4 渠道的 `cacheKey` 与译文都可分辨。
3. **R5 在后端也校验一次。** `PUT /api/translation/settings` 遇到 `server='hk'` 且 `channel != '1'` 返回 `40000`。前端仍按 R5 过滤候选（§5.4），后端这条只是防止绕过页面直接写库。
4. **缓存清理不做成接口。** 验证过程产生的 `translation_cache` 行保留：它本来就是租户内的模拟数据，且"翻译试用"面板每次点击都会产键。为验收专门加一个清空接口是多余的攻击面。spec §6.1 的"验收后清理"改为"验收后不动"。跨租户隔离用例需要第二个租户，由 `DataSeeder` 幂等补种 `QA0002`（Task 3），这是项目里唯一可执行的造租户路径（没有注册接口、没有 mysql CLI）。
5. **保存不做 debounce。** spec §5.4 写"字段变更 debounce 500ms → PUT"。翻译中心里每个控件都是一次离散动作（下拉选定、开关切换），不存在逐键上送的输入框；给它们套 debounce 只会让"改完立刻关页面"丢掉最后一次写入。落地口径：控件 `onChange` 直接 `PUT`（Task 12 的 `patch()` 全量覆盖），成功后 `invalidate` + 推送开关。

## File Structure

```
apps/server/src/main/java/com/smartscrm/server/
  entity/   TranslationSetting · TranslationNode · TranslationCache · TranslationPhrase   [新增]
  mapper/   ×4 Mapper                                                                     [新增]
  service/  PhraseDict · SimulatedTranslationEngine · TranslationService                   [新增]
  web/      TranslationController                                                          [新增]
  web/dto/  TranslateDTO · TranslationSettingInput                                          [新增]
  web/vo/   TranslateVO · TranslationSettingVO · TranslationNodeVO
            ServerDelayVO · TranslationCacheStatsVO · TranslationCacheEntryVO               [新增]
  config/   DataSeeder                                                                      [改：补 QA0002]
apps/server/src/main/resources/db/migration/V5__translation.sql                             [新增]
apps/server/src/test/java/com/smartscrm/server/service/SimulatedTranslationEngineTest.java  [新增]
apps/server/pom.xml                                                                         [改：+ zero-allocation-hashing]

apps/desktop/src/main/
  webContentsView/manager.ts        + sendToView                                            [改]
  webContentsView/ipc.ts            + wcv-send-to-view；view:invoke 由空桩改为真实分派        [改]
  services/translationBridge.ts     translate-api → 后端 fetch，带 Bearer                    [新增]
apps/desktop/src/preload/index.ts   + view.sendToView                                       [改]
apps/desktop/src/renderer/src/services/viewService.ts  fallback + sendToView                [改]
apps/desktop/src/inject/
  constants/events.ts               + UPDATE_TRANSLATION_FLAGS；删两条死通道常量              [改]
  constants/config.ts               拆 DEFAULT_RECEIVE/SEND_LANG_SETTING；删无用常量          [改]
  types.ts                          + TranslationFlags                                      [改]
  core/StateManager.ts              LangSetting 字段对齐 + 翻译开关字段 + 扫描 timer           [改]
  core/BaseInjector.ts              通道名修复 + 生命周期挂载                                 [改]
  core/PlatformAdapter.ts           删除无人调用的 renderTranslation                          [改]
  core/translation/messageState.ts                                                              [新增]
  core/translation/translationQueue.ts                                                          [新增]
  core/translation/renderTranslation.ts                                                         [新增]
  core/translation/domScan.ts                                                                   [新增]
  core/translation/manualButton.ts                                                              [新增]
  core/translation/inputPreview.ts                                                              [新增]
  platforms/whatsapp/selectors.ts   + EXPAND_MORE                                             [改]
  platforms/whatsapp/index.ts       接线                                                       [改]

apps/desktop/src/renderer/src/
  lib/langData.ts          四组语言清单 + 渠道映射 + 名称解析                                   [新增]
  lib/nodeSelect.ts        R5 兼容判定 + R6 自动选优                                            [新增]
  lib/translationSync.ts   设置开关 → 推送全部视图                                              [新增]
  api/translation.ts       类型 + Query hooks                                                  [新增]
  components/ui/switch.tsx radix Switch 封装                                                    [新增]
  pages/TranslationPage.tsx 页面                                                                [新增]
  lib/nav.ts + App.tsx     /translation 路由与导航                                              [改]
  layouts/AppLayout.tsx    挂 useTranslationSync()                                              [改]
```

---

## P5a — 后端（V5 + 引擎 + API）

### Task 1: V5 迁移、四张表、四个实体与 mapper

**Files:**
- Modify: `apps/server/pom.xml`（`<dependencies>` 内，紧跟 jjwt 三段之后）
- Create: `apps/server/src/main/resources/db/migration/V5__translation.sql`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/TranslationSetting.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/TranslationNode.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/TranslationCache.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/TranslationPhrase.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/TranslationSettingMapper.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/TranslationNodeMapper.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/TranslationCacheMapper.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/TranslationPhraseMapper.java`

**Interfaces:**
- Consumes: 既有 `tenant` 表（`id` / `invite_code`）与 V1–V4 的迁移风格。
- Produces: 表 `translation_setting` / `translation_node` / `translation_cache` / `translation_phrase`；实体 `TranslationSetting`（getter `getChannel()` / `getReceiveFromLang()` / `getReceiveToLang()` / `getSendFromLang()` / `getSendToLang()` / `getServer()` / `getServerMode()` / `getReceiveEnabled()` … 全部 Lombok `@Data` 生成）、`TranslationNode`（`getName()` / `getBaseDelayMs()` / `getReachable()` / `getSort()`）、`TranslationCache`（`getCacheKey()` / `getHitCount()` / `getSourceText()` / `getTargetText()` / `getPartial()`）、`TranslationPhrase`（`getPhraseKey()` / `getLangCode()` / `getText()`）；四个 `BaseMapper<T>` 子接口。

- [ ] **Step 1: 加 xxhash64 依赖**

在 `apps/server/pom.xml` 的 jjwt-jackson 依赖块之后插入：

```xml
		<dependency>
			<groupId>net.openhft</groupId>
			<artifactId>zero-allocation-hashing</artifactId>
			<version>0.16</version>
		</dependency>
```

跑 `./mvnw -q -DskipTests help:evaluate -Dexpression=project.version -DforceStdout`（在 `apps/server` 目录）。预期：输出 `0.1.0` 且无 `Could not resolve` 错误——这一步只是确认新 jar 能从仓库拉到。

若报 `Could not resolve net.openhft:zero-allocation-hashing:0.16`（本机 Maven 镜像没有这个坐标），不要卡在这里：撤掉这条依赖与 `LongHashFunction` 的 import，`buildCacheKey` 改用下面这段等价的本地 hash，§6.1 的"16 位 hex"形状不变。

```java
    /** FNV-1a 64-bit — only used to keep cache keys short and stable. */
    private static String hash64(String text) {
        long hash = 0xcbf29ce484222325L;
        for (int i = 0; i < text.length(); i++) {
            hash ^= text.charAt(i);
            hash *= 0x100000001b3L;
        }
        return String.format("%016x", hash);
    }
```

（Task 3 的 `buildCacheKey` 里把 `LongHashFunction.xx().hashChars(normalized)` 换成 `hash64(normalized)`、并去掉那行 import 即可，其余不动。）

- [ ] **Step 2: 写 `V5__translation.sql`**

完整内容（表结构逐字来自 spec §2；`my2` 的 `reachable = 0` 与延迟值是模拟设定，写在迁移注释里）：

```sql
-- P5: translation center (checklist B2) — settings, node metadata, translated-text
-- cache and the seed dictionary for the simulated engine.
-- Everything is local mock data: node `url` values are display only and are never
-- requested by any code path. Delays are base values plus jitter, not measurements.

CREATE TABLE `translation_setting`
(
    `id`                           BIGINT      NOT NULL AUTO_INCREMENT,
    `tenant_id`                    BIGINT      NOT NULL,
    `scope`                        VARCHAR(16) NOT NULL DEFAULT 'global' COMMENT 'global | customer (customer reserved for the chat-history phase)',
    `scope_key`                    VARCHAR(64) NULL COMMENT 'customer id when scope=customer',
    `server`                       VARCHAR(16) NOT NULL DEFAULT 'sg' COMMENT 'translation node name',
    `server_mode`                  VARCHAR(8)  NOT NULL DEFAULT 'auto' COMMENT 'auto | manual',
    `channel`                      VARCHAR(4)  NOT NULL DEFAULT '1' COMMENT '1=Google 2=DeepL 3=ChatGPT 4=Gemini',
    `receive_enabled`              TINYINT(1)  NOT NULL DEFAULT 1,
    `receive_from_lang`            VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'empty = auto detect',
    `receive_to_lang`              VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    `send_enabled`                 TINYINT(1)  NOT NULL DEFAULT 1,
    `send_from_lang`               VARCHAR(16) NOT NULL DEFAULT '',
    `send_to_lang`                 VARCHAR(16) NOT NULL DEFAULT 'en',
    `voice_enabled`                TINYINT(1)  NOT NULL DEFAULT 1 COMMENT 'stored only; voice translation is not implemented in this phase',
    `preview_enabled`              TINYINT(1)  NOT NULL DEFAULT 1 COMMENT 'input live preview',
    `enter_to_send`                TINYINT(1)  NOT NULL DEFAULT 0 COMMENT 'Enter = translate then send',
    `disable_chinese`              TINYINT(1)  NOT NULL DEFAULT 1,
    `disable_chinese_prevent_send` TINYINT(1)  NOT NULL DEFAULT 0,
    `created_at`                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tset_tenant_scope` (`tenant_id`, `scope`, `scope_key`),
    CONSTRAINT `fk_tset_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='translation settings per tenant';

CREATE TABLE `translation_node`
(
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `name`          VARCHAR(16)  NOT NULL COMMENT 'sg | my | my2 | id | hk | uk | us',
    `label`         VARCHAR(32)  NOT NULL,
    `url`           VARCHAR(255) NOT NULL COMMENT 'display only; never requested',
    `base_delay_ms` INT          NOT NULL DEFAULT 0 COMMENT 'simulated baseline, not a measurement',
    `reachable`     TINYINT(1)   NOT NULL DEFAULT 1,
    `sort`          INT          NOT NULL DEFAULT 0,
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tnode_name` (`name`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='translation nodes (metadata only)';

CREATE TABLE `translation_cache`
(
    `id`          BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`   BIGINT       NOT NULL,
    `cache_key`   VARCHAR(96)  NOT NULL,
    `type`        VARCHAR(8)   NOT NULL COMMENT 'receive | send',
    `channel`     VARCHAR(4)   NOT NULL,
    `from_lang`   VARCHAR(16)  NOT NULL DEFAULT '' COMMENT 'empty = auto detect',
    `to_lang`     VARCHAR(16)  NOT NULL,
    `source_text` TEXT         NOT NULL,
    `target_text` TEXT         NOT NULL,
    `partial`     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = dictionary did not cover everything',
    `hit_count`   INT          NOT NULL DEFAULT 0,
    `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tcache_tenant_key` (`tenant_id`, `cache_key`),
    KEY `idx_tcache_tenant_hit` (`tenant_id`, `hit_count`),
    CONSTRAINT `fk_tcache_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='translated text cache, tenant scoped';

CREATE TABLE `translation_phrase`
(
    `id`         BIGINT       NOT NULL AUTO_INCREMENT,
    `phrase_key` VARCHAR(64)  NOT NULL COMMENT 'stable slug for a phrase',
    `lang_code`  VARCHAR(16)  NOT NULL,
    `text`       VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tphrase_lang` (`phrase_key`, `lang_code`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='seed dictionary for the simulated engine';

-- 7 nodes. `my2` is deliberately unreachable so that "delay = null -> auto pick skips it"
-- is a state the UI and the API can actually be tested against.
INSERT INTO translation_node (name, label, url, base_delay_ms, reachable, sort) VALUES
('sg',  '新加坡', 'https://translate-sg.scrm.local',  20, 1, 0),
('my',  '马来西亚', 'https://translate-my.scrm.local', 45, 1, 1),
('my2', '马来西亚备份', 'https://translate-my2.scrm.local', 60, 0, 2),
('id',  '印尼',   'https://translate-id.scrm.local',  70, 1, 3),
('hk',  '香港',   'https://translate-hk.scrm.local',  90, 1, 4),
('uk',  '英国',   'https://translate-uk.scrm.local', 130, 1, 5),
('us',  '美国',   'https://translate-us.scrm.local', 180, 1, 6);

-- DEMO tenant settings row.
SET @tid = (SELECT id FROM tenant WHERE invite_code = 'DEMO0001' LIMIT 1);
INSERT INTO translation_setting (tenant_id) VALUES (@tid);

-- Simulated dictionary: 41 SCRM phrases x 8 languages. Unknown words stay untranslated
-- on purpose (that is what `partial` reports), so this list only needs the common lines.
-- lang set: zh-CN en vi id lo hi my ms
INSERT INTO translation_phrase (phrase_key, lang_code, text) VALUES
('greet_hello','zh-CN','你好'),('greet_hello','en','Hello'),('greet_hello','vi','Xin chào'),('greet_hello','id','Halo'),('greet_hello','lo','ສະບາຍດີ'),('greet_hello','hi','नमस्ते'),('greet_hello','my','မင်္ဂလာပါ'),('greet_hello','ms','Hai'),
('greet_service','zh-CN','很高兴为你服务'),('greet_service','en','glad to help you'),('greet_service','vi','rất vui được phục vụ bạn'),('greet_service','id','senang melayani Anda'),('greet_service','lo','ດີໃຈທີ່ໄດ້ບໍລິການ'),('greet_service','hi','सेवा करके खुशी हुई'),('greet_service','my','ဝန်ဆောင်မှုပေးရတာ ဝမ်းသာပါတယ်'),('greet_service','ms','gembira membantu anda'),
('ask_help','zh-CN','请问有什么可以帮您'),('ask_help','en','how can I help you'),('ask_help','vi','bạn cần tôi giúp gì'),('ask_help','id','ada yang bisa dibantu'),('ask_help','lo','ຕ້ອງການໃຫ້ຊ່ວຍຫຍັງ'),('ask_help','hi','मैं क्या मदद करूँ'),('ask_help','my','ဘာများ ကူညီပေးရမလဲ'),('ask_help','ms','apa yang boleh saya bantu'),
('thanks','zh-CN','感谢你的支持'),('thanks','en','thank you for your support'),('thanks','vi','cảm ơn bạn đã ủng hộ'),('thanks','id','terima kasih atas dukungannya'),('thanks','lo','ຂອບໃຈທີ່ສະໜັບສະໜູນ'),('thanks','hi','आपके समर्थन के लिए धन्यवाद'),('thanks','my','ကျေးဇူးတင်ပါတယ်'),('thanks','ms','terima kasih atas sokongan anda'),
('ship_done','zh-CN','订单已发货'),('ship_done','en','your order has been shipped'),('ship_done','vi','đơn hàng đã được gửi'),('ship_done','id','pesanan sudah dikirim'),('ship_done','lo','ອໍານາດຖືກສົ່ງແລ້ວ'),('ship_done','hi','आपका आदेश भेज दिया गया है'),('ship_done','my','မှာယူမှု ပို့လိုက်ပါပြီ'),('ship_done','ms','pesanan anda telah dihantar'),
('ship_done_ok','zh-CN','订单已发货成功'),('ship_done_ok','en','your order has been shipped successfully'),('ship_done_ok','vi','đơn hàng đã gửi thành công'),('ship_done_ok','id','pesanan berhasil dikirim'),('ship_done_ok','lo','ອໍານາດສົ່ງສຳເລັດ'),('ship_done_ok','hi','आदेश सफलतापूर्वक भेजा गया'),('ship_done_ok','my','ပို့ရေးအောင်မြင်ပါပြီ'),('ship_done_ok','ms','pesanan berjaya dihantar'),
('track_no','zh-CN','物流单号如下'),('track_no','en','the tracking number is below'),('track_no','vi','mã vận đơn như sau'),('track_no','id','nomor resi berikut'),('track_no','lo','ໝາຍເລກຕິດຕາມ'),('track_no','hi','ट्रैकिंग नंबर नीचे है'),('track_no','my','နံပါတ်ကို အောက်တွင်'),('track_no','ms','nombor penjejakan di bawah'),
('eta_3days','zh-CN','预计三天到货'),('eta_3days','en','estimated arrival in three days'),('eta_3days','vi','dự kiến giao trong ba ngày'),('eta_3days','id','perkiraan tiba tiga hari'),('eta_3days','lo','ປະມານສາມມື້'),('eta_3days','hi','अनुमानित तीन दिन में'),('eta_3days','my','သုံးရက်ခန့်'),('eta_3days','ms','anggaran tiga hari'),
('promo_now','zh-CN','现在下单有优惠'),('promo_now','en','order now for a discount'),('promo_now','vi','đặt hàng ngay để được giảm giá'),('promo_now','id','pesan sekarang ada diskon'),('promo_now','lo','ສັ່ງຊື້ຕອນນີ້ມີສ່ວນຫຼຸດ'),('promo_now','hi','अभी ऑर्डर करें, छूट पाएं'),('promo_now','my','ယခုမှာလျှင် နှုန်းထားကောင်း'),('promo_now','ms','pesan sekarang dapat diskaun'),
('promo_today','zh-CN','限时优惠，今天截止'),('promo_today','en','limited offer, ends today'),('promo_today','vi','ưu đãi có thời hạn, kết thúc hôm nay'),('promo_today','id','promo terbatas, berakhir hari ini'),('promo_today','lo','ໂປຣຈຳກັດ, ໝົດວັນນີ້'),('promo_today','hi','सीमित ऑफ़र, आज समाप्त'),('promo_today','my','ယနေ့နောက်ဆုံးသတ်မှတ်'),('promo_today','ms','tawaran terhad, tamat hari ini'),
('wait_check','zh-CN','请稍等，我帮你查询'),('wait_check','en','please wait, let me check'),('wait_check','vi','vui lòng đợi, tôi kiểm tra'),('wait_check','id','tunggu sebentar, saya cek'),('wait_check','lo','ກະລຸນາລໍຖ້າ'),('wait_check','hi','कृपया रुकें, मैं देखता हूँ'),('wait_check','my','ခဏစောင့်ပါ'),('wait_check','ms','sila tunggu, saya semak'),
('stock_hold','zh-CN','已为你保留库存'),('stock_hold','en','stock reserved for you'),('stock_hold','vi','đã giữ hàng cho bạn'),('stock_hold','id','stok kami reservasikan'),('stock_hold','lo','ກັນສິນຄ້າໃຫ້ແລ້ວ'),('stock_hold','hi','आपके लिए स्टॉक आरक्षित है'),('stock_hold','my','သင့်အတွက် နေရာယူထားပါပြီ'),('stock_hold','ms','stok rizab untuk anda'),
('pay_now','zh-CN','请尽快完成付款'),('pay_now','en','please complete the payment soon'),('pay_now','vi','vui lòng thanh toán sớm'),('pay_now','id','mohon selesaikan pembayaran'),('pay_now','lo','ກະລຸນາຊຳລະເງິນ'),('pay_now','hi','कृपया भुगतान पूरा करें'),('pay_now','my','ငွေပေးချေမှု အမြန်ဆုံး'),('pay_now','ms','sila selesaikan bayaran'),
('pay_pending','zh-CN','还未收到你的付款'),('pay_pending','en','we have not received your payment'),('pay_pending','vi','chưa nhận được thanh toán của bạn'),('pay_pending','id','kami belum menerima pembayaran Anda'),('pay_pending','lo','ຍັງບໍ່ໄດ້ຮັບການຊຳລະ'),('pay_pending','hi','हमें भुगतान नहीं मिला'),('pay_pending','my','ငွေလက်ခံရရှိခြင်း မရှိသေး'),('pay_pending','ms','kami belum menerima bayaran anda'),
('refund_ok','zh-CN','退款已经处理'),('refund_ok','en','the refund has been processed'),('refund_ok','vi','hoàn tiền đã được xử lý'),('refund_ok','id','pengembalian dana diproses'),('refund_ok','lo','ການ refunded ດຳເນີນແລ້ວ'),('refund_ok','hi','रिफंड प्रोसेस हो गया'),('refund_ok','my','ငွေပြန်အမ်းပြီး'),('refund_ok','ms','bayaran balik telah diproses'),
('ask_address','zh-CN','请提供收货地址'),('ask_address','en','please provide your delivery address'),('ask_address','vi','vui lòng cung cấp địa chỉ nhận hàng'),('ask_address','id','mohon berikan alamat pengiriman'),('ask_address','lo','ກະລຸນາໃຫ້ທີ່ຢູ່'),('ask_address','hi','कृपया पता दें'),('ask_address','my','လိပ်စာ ပေးပို့ပါ'),('ask_address','ms','sila berikan alamat penghantaran'),
('confirm_order','zh-CN','请确认订单信息'),('confirm_order','en','please confirm your order details'),('confirm_order','vi','vui lòng xác nhận đơn hàng'),('confirm_order','id','mohon konfirmasi pesanan'),('confirm_order','lo','ກະລຸນາຢືນຢັນ'),('confirm_order','hi','ऑर्डर की पुष्टि करें'),('confirm_order','my','မှာယူမှု အတည်ပြုပါ'),('confirm_order','ms','sila sahbut pesanan'),
('after_sale','zh-CN','售后问题随时找我'),('after_sale','en','reach me anytime for after-sales'),('after_sale','vi','liên hệ tôi bất cứ lúc nào'),('after_sale','id','hubungi saya kapan pun'),('after_sale','lo','ຕິດຕໍ່ມາໄດ້ເລີຍ'),('after_sale','hi','बिक्री के बाद कभी भी लिखें'),('after_sale','my','အရောင်း 후 မေးမြန်းနိုင်'),('after_sale','ms','hubungi saya bila-bila masa'),
('broken_item','zh-CN','商品有损坏吗'),('broken_item','en','is the item damaged'),('broken_item','vi','hàng bị hư hỏng phải không'),('broken_item','id','apakah barang rusak'),('broken_item','lo','ສິນຄ້າເສຍຫາຍບໍ່'),('broken_item','hi','क्या सामान टूटा है'),('broken_item','my','ပစ္စည်း ပျက်စီးနေပါသလဲ'),('broken_item','ms','adakah barang rosak'),
('send_within','zh-CN','我们会在两天内寄出'),('send_within','en','we will send it within two days'),('send_within','vi','chúng tôi sẽ gửi trong hai ngày'),('send_within','id','kami kirim dalam dua hari'),('send_within','lo','ພວກເຮົາຈະສົ່ງໃນສອງມື້'),('send_within','hi','हम दो दिन में भेज देंगे'),('send_within','my','နှစ်ရက်အတွင်း ပို့ပေးပါမည်'),('send_within','ms','kami akan hantar dalam dua hari'),
('price_hint','zh-CN','这个价格已经很优惠了'),('price_hint','en','this price is already very good'),('price_hint','vi','giá này đã rất tốt rồi'),('price_hint','id','harga ini sudah sangat baik'),('price_hint','lo','ຣາຄານີ້ດີຫຼາຍແລ້ວ'),('price_hint','hi','यह कीमत बहुत अच्छी है'),('price_hint','my','ဈေးနှုန်း အလွန်ကောင်း'),('price_hint','ms','harga ini sudah sangat baik'),
('discount_10','zh-CN','可以给你十个百分点的折扣'),('discount_10','en','I can give you a ten percent discount'),('discount_10','vi','tôi có thể giảm cho bạn mười phần trăm'),('discount_10','id','saya bisa memberi diskon sepuluh persen'),('discount_10','lo','ສ່ວນຫຼຸດ ສິບເປີເຊັນ'),('discount_10','hi','मैं दस प्रतिशत छूट दे सकता हूँ'),('discount_10','my','ဆယ်ရာခိုင်နှုန်း လျှော့ပေးနိုင်'),('discount_10','ms','saya boleh beri diskaun sepuluh peratus'),
('min_order','zh-CN','最低起订量是一百件'),('min_order','en','the minimum order is one hundred pieces'),('min_order','vi','đơn tối thiểu là một trăm cái'),('min_order','id','pesanan minimum seratus buah'),('min_order','lo','ຄ່ານ້ອຍສຸດ ໜຶ່ງຮ້ອຍຊິ້ນ'),('min_order','hi','न्यूनतम ऑर्डर सौ है'),('min_order','my','အနိမ့်ဆုံး မှာယူမှု နောက်ခေါင်း'),('min_order','ms','pesanan minimum seratus unit'),
('welcome_back','zh-CN','欢迎再次光临'),('welcome_back','en','welcome back'),('welcome_back','vi','chào mừng trở lại'),('welcome_back','id','selamat datang kembali'),('welcome_back','lo','ຍິນດີຕ້ອນຮັບກັບມາ'),('welcome_back','hi','फिर से स्वागत है'),('welcome_back','my','ပြန်လည်ကြိုဆိုပါတယ်'),('welcome_back','ms','selamat kembali'),
('bye','zh-CN','祝你生活愉快'),('bye','en','wish you a good day'),('bye','vi','chúc bạn một ngày tốt lành'),('bye','id','semoga harimu menyenangkan'),('bye','lo','ຂໍໃຫ້ມື້ດີ'),('bye','hi','आपका दिन शुभ हो'),('bye','my','နေကောင်းပါစေ'),('bye','ms','semoga hari anda baik'),
('festival_ok','zh-CN','节日快乐'),('festival_ok','en','happy festival'),('festival_ok','vi','chúc mừng lễ'),('festival_ok','id','selamat merayakan hari raya'),('festival_ok','lo','ສຸກຂ່າວຖັນມື້'),('festival_ok','hi','त्योहार की शुभकामनाएँ'),('festival_ok','my','ပွဲတော်အချိန် နှုတ်ခွား'),('festival_ok','ms','selamat merayakan'),
('new_year','zh-CN','新年快乐'),('new_year','en','happy new year'),('new_year','vi','chúc mừng năm mới'),('new_year','id','selamat tahun baru'),('new_year','lo','ສຸກຂ່າວປີໃໝ່'),('new_year','hi','नया वर्ष की शुभकामनाएँ'),('new_year','my','နွစ်ဖြစ်သစ်နှစ်'),('new_year','ms','selamat tahun baru'),
('order_confirm_q','zh-CN','要现在下单吗'),('order_confirm_q','en','shall we place the order now'),('order_confirm_q','vi','đặt hàng luôn nhé'),('order_confirm_q','id','pesan sekarang'),('order_confirm_q','lo','ຈະສັ່ງຊື້ຕອນນີ້ບໍ່'),('order_confirm_q','hi','क्या अभी ऑर्डर करें'),('order_confirm_q','my','ယခုမှာမလား'),('order_confirm_q','ms','mahu pesan sekarang'),
('need_time','zh-CN','我需要再考虑一下'),('need_time','en','I need more time to think'),('need_time','vi','tôi cần suy nghĩ thêm'),('need_time','id','saya perlu waktu untuk berpikir'),('need_time','lo','ຂໍເວລາຄິດກ່ອນ'),('need_time','hi','मुझे सोचने का समय चाहिए'),('need_time','my','အနည်းငယ် စဉ်းစားရန်'),('need_time','ms','saya perlu masa berfikir'),
('in_stock','zh-CN','这个有现货'),('in_stock','en','this one is in stock'),('in_stock','vi','cái này còn hàng'),('in_stock','id','barang ini tersedia'),('in_stock','lo','ອັນນີ້ມີສິນຄ້າ'),('in_stock','hi','यह स्टॉक में है'),('in_stock','my','ဒီပစ္စည်း ရှိနေပါတယ်'),('in_stock','ms','yang ini ada stok'),
('out_stock','zh-CN','暂时缺货了'),('out_stock','en','it is out of stock for now'),('out_stock','vi','tạm hết hàng'),('out_stock','id','sedang habis stok'),('out_stock','lo','ຊົ່ວຄາວ ຫມົດສິນຄ້າ'),('out_stock','hi','अभी स्टॉक नहीं है'),('out_stock','my','ယာယီ ကုန်သွားပါပြီ'),('out_stock','ms','kehabisan stok buat masa ini'),
('size_chart','zh-CN','尺寸表发给你了'),('size_chart','en','I have sent you the size chart'),('size_chart','vi','đã gửi bảng size cho bạn'),('size_chart','id','tabel ukuran sudah saya kirim'),('size_chart','lo','ສົ່ງຕາຕະລາງຂະໜາດແລ້ວ'),('size_chart','hi','साइज़ चार्ट भेज दिया'),('size_chart','my','အရွယ်အစား ဇယား ပို့ပြီး'),('size_chart','ms','carta saiz telah dihantar'),
('color_q','zh-CN','你要什么颜色'),('color_q','en','which colour do you want'),('color_q','vi','bạn muốn màu nào'),('color_q','id','Anda mau warna apa'),('color_q','lo','ຕ້ອງການສີໃດ'),('color_q','hi','आपको कौन सा रंग चाहिए'),('color_q','my','ဘယ်အရောင် လိုချင်လဲ'),('color_q','ms','anda mahu warna apa'),
('reply_later','zh-CN','稍后回复你'),('reply_later','en','I will reply later'),('reply_later','vi','tôi sẽ trả lời sau'),('reply_later','id','nanti saya balas'),('reply_later','lo','ຈະຕອບກັບພາຍຫຼັງ'),('reply_later','hi','मैं बाद में जवाब दूँगा'),('reply_later','my','နောက်မှ ပြန်ဖြေပါမယ်'),('reply_later','ms','saya akan balas kelak'),
('urgent','zh-CN','这个比较急'),('urgent','en','this one is quite urgent'),('urgent','vi','cái này khá gấp'),('urgent','id','ini cukup mendesak'),('urgent','lo','ອັນນີ້ດ່ວນ'),('urgent','hi','यह थोड़ा ज़रूरी है'),('urgent','my','ဒါ အနည်းငယ် အရေးတကြီး'),('urgent','ms','yang ini agak segera'),
('ok_k','zh-CN','好的'),('ok_k','en','ok'),('ok_k','vi','vâng'),('ok_k','id','baik'),('ok_k','lo','ດີ'),('ok_k','hi','ठीक है'),('ok_k','my','ဟုတ်ကဲ့'),('ok_k','ms','baik'),
('sorry','zh-CN','非常抱歉'),('sorry','en','we are very sorry'),('sorry','vi','rất xin lỗi bạn'),('sorry','id','mohon maaf'),('sorry','lo','ຂໍໂທດຢ່າງຍິ່ງ'),('sorry','hi','काफी माफ़ी'),('sorry','my','တကယ်ပဲ ပြစ်မှား'),('sorry','ms','kami mohon maaf'),
('payment_link','zh-CN','付款链接在这里'),('payment_link','en','the payment link is here'),('payment_link','vi','link thanh toán ở đây'),('payment_link','id','tautan pembayaran di sini'),('payment_link','lo','ລິ້ງຊຳລະເງິນ'),('payment_link','hi','भुगतान लिंक यहाँ है'),('payment_link','my','ငွေပေးချေမှု link ဤနေရာ'),('payment_link','ms','pautan bayaran di sini'),
('track_hint','zh-CN','你可以凭单号查询物流'),('track_hint','en','you can track the parcel with the number'),('track_hint','vi','bạn có thể tra cứu vận đơn'),('track_hint','id','Anda bisa lacak dengan nomor resi'),('track_hint','lo','ສາມາດຕິດຕາມໄດ້'),('track_hint','hi','आप नंबर से ट्रैक कर सकते हैं'),('track_hint','my','နံပါတ်ဖြင့် စစ်ဆေးနိုင်'),('track_hint','ms','anda boleh jejak dengan nombor'),
('catalog','zh-CN','目录已经发给你了'),('catalog','en','the catalogue has been sent to you'),('catalog','vi','catalogue đã gửi cho bạn'),('catalog','id','katalog sudah dikirim'),('catalog','lo','ໄດ້ສົ່ງລາຍການແລ້ວ'),('catalog','hi','कैटलॉग भेज दिया गया'),('catalog','my','စာရင်း ပို့ပြီးပါပြီ'),('catalog','ms','katalog telah dihantar'),
('rate_us','zh-CN','麻烦给个五星好评'),('rate_us','en','please give us a five star review'),('rate_us','vi','hãy cho tôi đánh giá năm sao'),('rate_us','id','mohon beri ulasan bintang lima'),('rate_us','lo','ກະລຸນາໃຫ້ ດາມ'),('rate_us','hi','कृपया पाँच स्टार रेटिंग दें'),('rate_us','my','ကြယ်ငါးပွင့် ဖြင့်'),('rate_us','ms','sila beri ulasan lima bintang');
```

- [ ] **Step 3: 写四个实体与四个 mapper**

`entity/TranslationSetting.java`：

```java
package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("translation_setting")
public class TranslationSetting {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String scope;
    private String scopeKey;
    private String server;
    private String serverMode;
    private String channel;
    private Boolean receiveEnabled;
    private String receiveFromLang;
    private String receiveToLang;
    private Boolean sendEnabled;
    private String sendFromLang;
    private String sendToLang;
    private Boolean voiceEnabled;
    private Boolean previewEnabled;
    private Boolean enterToSend;
    private Boolean disableChinese;
    private Boolean disableChinesePreventSend;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
```

`entity/TranslationNode.java`：

```java
package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("translation_node")
public class TranslationNode {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String name;
    private String label;
    private String url;
    private Integer baseDelayMs;
    private Boolean reachable;
    private Integer sort;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
```

`entity/TranslationCache.java`：

```java
package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("translation_cache")
public class TranslationCache {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String cacheKey;
    private String type;
    private String channel;
    private String fromLang;
    private String toLang;
    private String sourceText;
    private String targetText;
    private Boolean partial;
    private Integer hitCount;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
```

`entity/TranslationPhrase.java`：

```java
package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("translation_phrase")
public class TranslationPhrase {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String phraseKey;
    private String langCode;
    private String text;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;
}
```

四个 mapper，逐个同构（把 `Xxx` 换成对应实体名）：

```java
package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.TranslationSetting;

public interface TranslationSettingMapper extends BaseMapper<TranslationSetting> {
}
```

```java
package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.TranslationNode;

public interface TranslationNodeMapper extends BaseMapper<TranslationNode> {
}
```

```java
package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.TranslationPhrase;

public interface TranslationPhraseMapper extends BaseMapper<TranslationPhrase> {
}
```

`TranslationCacheMapper` 额外带两个聚合查询（`cache/stats` 用，避免把整张缓存表读进内存）：

```java
package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.TranslationCache;
import org.apache.ibatis.annotations.Select;

public interface TranslationCacheMapper extends BaseMapper<TranslationCache> {

    @Select("SELECT COUNT(*) FROM translation_cache WHERE tenant_id = #{tenantId}")
    long countKeys(Long tenantId);

    @Select("SELECT COALESCE(SUM(hit_count), 0) FROM translation_cache WHERE tenant_id = #{tenantId}")
    long sumHits(Long tenantId);
}
```

- [ ] **Step 4: 编译 + 迁移落库**

```bash
cd apps/server && ./mvnw -q -DskipTests compile
```

预期：`BUILD SUCCESS` 无报错。然后重启后端让 Flyway 跑 V5（本机 8180 上可能还挂着旧进程）：

```bash
netstat -ano | grep ':8180' | head -3
taskkill //PID <上面查到的PID> //F
cd apps/server && ./mvnw -q spring-boot:run        # 后台运行
```

等 `curl -s localhost:8180/api/health` 返回 `code: 0`，并在启动日志里确认这一行：

```
Migrating schema `smartscrm_react` to version "5 - translation"
```

预期：日志出现上面这行且**没有** `Migration V5 ... failed`。若日志是 `Successfully validated 5 migrations` 而无 `Migrating`，说明 V5 之前已被应用过（重复启动），可直接进 Step 5。种子段若报 `42000` 语法错，基本都是多语种文本里混进了括号/引号错配，按报错行号回到 VALUES 清单里改标点。

种子条数不单独验证：本任务没有可查库的 CLI，也不为此新建测试类。节点种子由 Task 3 之后的 `GET /api/translation/nodes` 返回 7 条证明，词典种子由 Task 4 契约用例「`你好 → Hello` 命中」证明——两条都在后续步骤里有明确判据。

- [ ] **Step 5: 提交**

```bash
git add apps/server/pom.xml apps/server/src/main/resources/db/migration/V5__translation.sql \
        apps/server/src/main/java/com/smartscrm/server/entity \
        apps/server/src/main/java/com/smartscrm/server/mapper
git commit -m "feat(P5a): 翻译中心数据模型与 V5 迁移"
```

---

### Task 2: 词典索引与模拟翻译引擎（TDD）

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/service/PhraseDict.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/SimulatedTranslationEngine.java`
- Create: `apps/server/src/test/java/com/smartscrm/server/service/SimulatedTranslationEngineTest.java`

**Interfaces:**
- Consumes: Task 1 的 `TranslationPhraseMapper`、`TranslationPhrase`。
- Produces:
  - `PhraseDict.byLang(String lang): Map<String, String>`（`phraseKey -> text`，未知语言返回空 Map）
  - `PhraseDict.supports(String lang): boolean`
  - `PhraseDict.of(Map<String, Map<String, String>> index): PhraseDict`（静态测试接缝，不连库）
  - `SimulatedTranslationEngine.normalize(String text): String`
  - `SimulatedTranslationEngine.translate(String text, String fromLang, String toLang, String channel): SimulatedTranslationEngine.EngineResult`
  - `record SimulatedTranslationEngine.EngineResult(String translation, boolean partial, String fromLang)`

- [ ] **Step 1: 先写 `PhraseDict`（它没有逻辑，是引擎的输入接缝）**

```java
package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.entity.TranslationPhrase;
import com.smartscrm.server.mapper.TranslationPhraseMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * In-memory view of `translation_phrase`: lang code -> (phrase key -> text).
 * Loaded once per process; the dictionary is seed data, so it never changes at runtime.
 */
@Component
public class PhraseDict {

    /** The eight languages the simulated engine can actually produce. */
    public static final List<String> SUPPORTED = List.of("zh-CN", "en", "vi", "id", "lo", "hi", "my", "ms");

    private final TranslationPhraseMapper phraseMapper;
    private volatile Map<String, Map<String, String>> index;

    /** Explicit because the test-seam constructor below leaves Spring without a default choice. */
    @Autowired
    public PhraseDict(TranslationPhraseMapper phraseMapper) {
        this.phraseMapper = phraseMapper;
    }

    private PhraseDict(Map<String, Map<String, String>> index) {
        this.phraseMapper = null;
        this.index = index;
    }

    public static PhraseDict of(Map<String, Map<String, String>> index) {
        return new PhraseDict(index);
    }

    public Map<String, String> byLang(String lang) {
        if (lang == null) {
            return Map.of();
        }
        return load().getOrDefault(lang, Map.of());
    }

    public boolean supports(String lang) {
        return lang != null && !byLang(lang).isEmpty();
    }

    private Map<String, Map<String, String>> load() {
        Map<String, Map<String, String>> current = index;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            if (index != null) {
                return index;
            }
            Map<String, Map<String, String>> built = new LinkedHashMap<>();
            List<TranslationPhrase> rows = phraseMapper.selectList(new LambdaQueryWrapper<TranslationPhrase>()
                .orderByAsc(TranslationPhrase::getLangCode)
                .orderByAsc(TranslationPhrase::getId));
            for (TranslationPhrase row : rows) {
                built.computeIfAbsent(row.getLangCode(), k -> new LinkedHashMap<>())
                    .put(row.getPhraseKey(), row.getText());
            }
            index = built;
            return built;
        }
    }
}
```

- [ ] **Step 2: 写失败测试**

`apps/server/src/test/java/com/smartscrm/server/service/SimulatedTranslationEngineTest.java`：

```java
package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

class SimulatedTranslationEngineTest {

    private static final Map<String, Map<String, String>> DICT = Map.of(
        "zh-CN", Map.of(
            "greet_hello", "你好",
            "ship_done", "订单已发货",
            "ship_done_ok", "订单已发货成功"),
        "en", Map.of(
            "greet_hello", "Hello",
            "ship_done", "your order has been shipped",
            "ship_done_ok", "your order has been shipped successfully"),
        "vi", Map.of(
            "greet_hello", "Xin chào",
            "ship_done", "đơn hàng đã được gửi"));

    private final SimulatedTranslationEngine engine =
        new SimulatedTranslationEngine(PhraseDict.of(DICT));

    @Test
    void prefersTheLongestMatchingPhrase() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("订单已发货成功", "zh-CN", "en", "1");
        assertEquals("your order has been shipped successfully", r.translation());
        assertFalse(r.partial());
    }

    @Test
    void keepsUnmatchedFragmentsAndMarksPartial() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("你好 abc123", "zh-CN", "en", "1");
        assertEquals("Hello abc123", r.translation());
        assertTrue(r.partial());
    }

    @Test
    void detectsSourceLanguageByBestCoverage() {
        assertEquals("vi", engine.translate("Xin chào", "", "en", "1").fromLang());
        assertEquals("zh-CN", engine.translate("订单已发货", "", "en", "1").fromLang());
    }

    @Test
    void unsupportedPairReturnsSourceTextAndPartial() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("habari gani", "sw", "is", "1");
        assertEquals("habari gani", r.translation());
        assertTrue(r.partial());
    }

    @Test
    void sameLanguageReturnsInputWithoutTouchingDictionary() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("你好", "zh-CN", "zh-CN", "3");
        assertEquals("你好", r.translation());
        assertFalse(r.partial());
    }

    @Test
    void googleKeepsLineBreaksAndDeeplCollapsesThem() {
        String twoLines = "你好\n订单已发货";
        assertEquals("Hello\nyour order has been shipped",
            engine.translate(twoLines, "zh-CN", "en", "1").translation());
        assertEquals("Hello your order has been shipped",
            engine.translate(twoLines, "zh-CN", "en", "2").translation());
    }

    @Test
    void chatGptStyleCapitalisesEnglishTarget() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("你好", "zh-CN", "en", "3");
        assertEquals("Hello.", r.translation());
    }

    @Test
    void geminiStyleAppendsChineseFullStopForChineseTarget() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("你好", "en", "zh-CN", "4");
        assertEquals("你好。", r.translation());
    }

    @Test
    void normalizeCollapsesSpacesButKeepsNewlines() {
        assertEquals("a b\nc d", SimulatedTranslationEngine.normalize("  a   b \n c  d  "));
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd apps/server && ./mvnw -q test -Dtest=SimulatedTranslationEngineTest
```

预期：编译失败，报 `cannot find symbol: class SimulatedTranslationEngine`（引擎还没写）。这是预期的失败。

- [ ] **Step 4: 实现引擎**

```java
package com.smartscrm.server.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Deterministic stand-in for a translation channel. Matches seeded phrases (longest
 * first) over the source text and leaves everything else verbatim, which is exactly
 * what the `partial` flag reports. It never sleeps and never hits the network.
 */
@Component
public class SimulatedTranslationEngine {

    public record EngineResult(String translation, boolean partial, String fromLang) {
    }

    private record Pattern(String source, String target) {
    }

    private final PhraseDict dict;

    public SimulatedTranslationEngine(PhraseDict dict) {
        this.dict = dict;
    }

    public static String normalize(String text) {
        if (text == null) {
            return "";
        }
        String[] lines = text.trim().replace('\t', ' ').split("\n", -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) {
                sb.append('\n');
            }
            sb.append(lines[i].replaceAll(" {2,}", " ").trim());
        }
        return sb.toString();
    }

    public EngineResult translate(String rawText, String fromLang, String toLang, String channel) {
        String text = normalize(rawText);
        boolean toKnown = dict.supports(toLang);
        String source = (fromLang == null || fromLang.isBlank() || "auto".equals(fromLang))
            ? detect(text)
            : fromLang;

        if (source == null || !toKnown || !dict.supports(source)) {
            // R8: never blank, never an error — hand the caller its own text and say so.
            return new EngineResult(text, true, source == null ? "" : source);
        }
        if (source.equals(toLang)) {
            return new EngineResult(text, false, source);
        }

        MatchResult matched = match(text, source, toLang);
        return new EngineResult(style(channel, toLang, matched.text()), matched.partial() || !toKnown, source);
    }

    // ============ internals ============

    private record MatchResult(String text, boolean partial, int coveredChars) {
    }

    private String detect(String text) {
        String best = null;
        int bestCovered = 0;
        for (String lang : PhraseDict.SUPPORTED) {
            if (!dict.supports(lang)) {
                continue;
            }
            int covered = match(text, lang, lang).coveredChars();
            // Strict '>' plus SUPPORTED's order makes the first language win a tie.
            if (covered > bestCovered) {
                bestCovered = covered;
                best = lang;
            }
        }
        return best;
    }

    private MatchResult match(String text, String sourceLang, String targetLang) {
        List<Pattern> patterns = patterns(sourceLang, targetLang);
        String out = text;
        int covered = 0;
        for (Pattern p : patterns) {
            if (!p.source().isEmpty() && out.contains(p.source())) {
                covered += visibleChars(p.source()) * countOccurrences(out, p.source());
                out = out.replace(p.source(), p.target());
            }
        }
        boolean partial = covered < visibleChars(text);
        return new MatchResult(out, partial, covered);
    }

    private List<Pattern> patterns(String sourceLang, String targetLang) {
        Map<String, String> source = dict.byLang(sourceLang);
        Map<String, String> target = dict.byLang(targetLang);
        List<Pattern> list = new ArrayList<>();
        for (Map.Entry<String, String> entry : source.entrySet()) {
            String replacement = target.get(entry.getKey());
            if (replacement != null && !entry.getValue().isBlank()) {
                list.add(new Pattern(entry.getValue(), replacement));
            }
        }
        list.sort(Comparator.comparingInt((Pattern p) -> p.source().length()).reversed());
        return list;
    }

    private String style(String channel, String toLang, String text) {
        if ("2".equals(channel)) {
            return text.replaceAll("\\s+", " ").trim();
        }
        if ("3".equals(channel) || "4".equals(channel)) {
            if (text.isEmpty()) {
                return text;
            }
            if ("en".equals(toLang)) {
                String capped = Character.toUpperCase(text.charAt(0)) + text.substring(1);
                return capped.endsWith(".") ? capped : capped + ".";
            }
            if ("zh-CN".equals(toLang)) {
                return text.endsWith("。") ? text : text + "。";
            }
        }
        return text;
    }

    private int countOccurrences(String haystack, String needle) {
        int count = 0;
        int idx = haystack.indexOf(needle);
        while (idx >= 0) {
            count++;
            idx = haystack.indexOf(needle, idx + needle.length());
        }
        return count;
    }

    private int visibleChars(String text) {
        return (int) text.chars().filter(c -> !Character.isWhitespace(c)).count();
    }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd apps/server && ./mvnw -q test -Dtest=SimulatedTranslationEngineTest
```

预期：`Tests run: 9, Failures: 0, Errors: 0`。若 `detectsSourceLanguageByBestCoverage` 失败，检查 `match` 在 `sourceLang == targetLang` 时 `patterns` 是否为空——检测阶段以"源语言自身"作为目标语言，因此 `patterns(lang, lang)` 必须返回该语言的自有短语（当前实现满足，因为同语言下 `target.get(key)` 必然命中）。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/main/java/com/smartscrm/server/service \
        apps/server/src/test/java/com/smartscrm/server/service
git commit -m "feat(P5a): 模拟翻译引擎与单元测试"
```

---

### Task 3: `TranslationService` + `TranslationController`

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/web/dto/TranslateDTO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/dto/TranslationSettingInput.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/TranslateVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/TranslationSettingVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/TranslationNodeVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/ServerDelayVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/TranslationCacheEntryVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/TranslationCacheStatsVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/TranslationController.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/config/DataSeeder.java`

**Interfaces:**
- Consumes: Task 1 实体 / mapper；Task 2 的 `SimulatedTranslationEngine.translate(...)`、`normalize(...)`、`EngineResult`；`AuthPrincipal.tenantId()`；`BizException` / `ApiResponse` 既有约定。
- Produces（HTTP 契约，P5b/P5c 全部按此对齐）：
  - `GET /api/translation/settings` → `ApiResponse<TranslationSettingVO>`
  - `PUT /api/translation/settings` → `ApiResponse<TranslationSettingVO>`，body `TranslationSettingInput`
  - `GET /api/translation/nodes` → `ApiResponse<List<TranslationNodeVO>>`
  - `GET /api/translation/nodes/delays` → `ApiResponse<List<ServerDelayVO>>`
  - `POST /api/translation/translate` → `ApiResponse<TranslateVO>`，body `TranslateDTO`
  - `GET /api/translation/cache/stats` → `ApiResponse<TranslationCacheStatsVO>`
  - Java 侧：`TranslationService.buildCacheKey(String type, String channel, String fromLang, String toLang, String normalized): String`

- [ ] **Step 1: DTO 与 VO**

```java
package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record TranslateDTO(
    @NotBlank(message = "text 不能为空") @Size(max = 5000, message = "text 最长 5000 字符") String text,
    @NotBlank(message = "type 不能为空") String type,
    Boolean input,
    Boolean noCache
) {
}
```

```java
package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record TranslationSettingInput(
    String server,
    String serverMode,
    String channel,
    Boolean receiveEnabled,
    String receiveFromLang,
    @NotBlank(message = "receiveToLang 不能为空") String receiveToLang,
    Boolean sendEnabled,
    String sendFromLang,
    @NotBlank(message = "sendToLang 不能为空") String sendToLang,
    Boolean voiceEnabled,
    Boolean previewEnabled,
    Boolean enterToSend,
    Boolean disableChinese,
    Boolean disableChinesePreventSend
) {
}
```

```java
package com.smartscrm.server.web.vo;

public record TranslateVO(
    String translation,
    boolean cached,
    boolean partial,
    boolean containsChinese,
    String type,
    String channel,
    String fromLangCode,
    String toLangCode,
    String cacheKey
) {
}
```

```java
package com.smartscrm.server.web.vo;

public record TranslationSettingVO(
    Long id,
    String server,
    String serverMode,
    String channel,
    Boolean receiveEnabled,
    String receiveFromLang,
    String receiveToLang,
    Boolean sendEnabled,
    String sendFromLang,
    String sendToLang,
    Boolean voiceEnabled,
    Boolean previewEnabled,
    Boolean enterToSend,
    Boolean disableChinese,
    Boolean disableChinesePreventSend
) {
}
```

```java
package com.smartscrm.server.web.vo;

public record TranslationNodeVO(Long id, String name, String label, String url, Integer baseDelayMs, Boolean reachable) {
}
```

```java
package com.smartscrm.server.web.vo;

public record ServerDelayVO(String name, Integer delay) {
}
```

```java
package com.smartscrm.server.web.vo;

public record TranslationCacheEntryVO(String cacheKey, String sourceText, String targetText, Integer hitCount, Boolean partial) {
}
```

```java
package com.smartscrm.server.web.vo;

import java.util.List;

public record TranslationCacheStatsVO(long totalKeys, long totalHits, List<TranslationCacheEntryVO> top) {
}
```

- [ ] **Step 2: `TranslationService`**

```java
package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.TranslationCache;
import com.smartscrm.server.entity.TranslationNode;
import com.smartscrm.server.entity.TranslationSetting;
import com.smartscrm.server.mapper.TranslationCacheMapper;
import com.smartscrm.server.mapper.TranslationNodeMapper;
import com.smartscrm.server.mapper.TranslationSettingMapper;
import com.smartscrm.server.web.dto.TranslateDTO;
import com.smartscrm.server.web.dto.TranslationSettingInput;
import com.smartscrm.server.web.vo.ServerDelayVO;
import com.smartscrm.server.web.vo.TranslateVO;
import com.smartscrm.server.web.vo.TranslationCacheEntryVO;
import com.smartscrm.server.web.vo.TranslationCacheStatsVO;
import com.smartscrm.server.web.vo.TranslationNodeVO;
import com.smartscrm.server.web.vo.TranslationSettingVO;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Pattern;
import net.openhft.hashing.LongHashFunction;
import org.springframework.stereotype.Service;

@Service
public class TranslationService {

    private static final Pattern CHINESE = Pattern.compile("[\\u4e00-\\u9fa5]");
    private static final Set<String> CHANNELS = Set.of("1", "2", "3", "4");

    private final TranslationSettingMapper settingMapper;
    private final TranslationNodeMapper nodeMapper;
    private final TranslationCacheMapper cacheMapper;
    private final SimulatedTranslationEngine engine;

    public TranslationService(TranslationSettingMapper settingMapper, TranslationNodeMapper nodeMapper,
                              TranslationCacheMapper cacheMapper, SimulatedTranslationEngine engine) {
        this.settingMapper = settingMapper;
        this.nodeMapper = nodeMapper;
        this.cacheMapper = cacheMapper;
        this.engine = engine;
    }

    // ============ settings ============

    public TranslationSettingVO getSettings(Long tenantId) {
        return toVO(requireSettings(tenantId));
    }

    public TranslationSettingVO updateSettings(Long tenantId, TranslationSettingInput input) {
        TranslationSetting current = requireSettings(tenantId);
        String channel = defaultIfBlank(input.channel(), current.getChannel());
        String server = defaultIfBlank(input.server(), current.getServer());
        if (!CHANNELS.contains(channel)) {
            throw new BizException(40000, "channel 只能是 1 / 2 / 3 / 4");
        }
        Set<String> nodeNames = nodeMapper.selectList(new LambdaQueryWrapper<TranslationNode>())
            .stream().map(TranslationNode::getName).collect(java.util.stream.Collectors.toSet());
        if (!nodeNames.contains(server)) {
            throw new BizException(40000, "未知翻译节点: " + server);
        }
        if ("hk".equals(server) && !"1".equals(channel)) {
            throw new BizException(40000, "hk 节点只支持 Google 线路");
        }
        current.setChannel(channel);
        current.setServer(server);
        current.setServerMode(defaultIfBlank(input.serverMode(), current.getServerMode()));
        current.setReceiveEnabled(input.receiveEnabled() == null ? current.getReceiveEnabled() : input.receiveEnabled());
        current.setReceiveFromLang(input.receiveFromLang() == null ? current.getReceiveFromLang() : input.receiveFromLang().trim());
        current.setReceiveToLang(input.receiveToLang().trim());
        current.setSendEnabled(input.sendEnabled() == null ? current.getSendEnabled() : input.sendEnabled());
        current.setSendFromLang(input.sendFromLang() == null ? current.getSendFromLang() : input.sendFromLang().trim());
        current.setSendToLang(input.sendToLang().trim());
        current.setVoiceEnabled(input.voiceEnabled() == null ? current.getVoiceEnabled() : input.voiceEnabled());
        current.setPreviewEnabled(input.previewEnabled() == null ? current.getPreviewEnabled() : input.previewEnabled());
        current.setEnterToSend(input.enterToSend() == null ? current.getEnterToSend() : input.enterToSend());
        current.setDisableChinese(input.disableChinese() == null ? current.getDisableChinese() : input.disableChinese());
        current.setDisableChinesePreventSend(input.disableChinesePreventSend() == null
            ? current.getDisableChinesePreventSend() : input.disableChinesePreventSend());
        settingMapper.updateById(current);
        return toVO(settingMapper.selectById(current.getId()));
    }

    private TranslationSetting requireSettings(Long tenantId) {
        TranslationSetting setting = settingMapper.selectOne(new LambdaQueryWrapper<TranslationSetting>()
            .eq(TranslationSetting::getTenantId, tenantId)
            .eq(TranslationSetting::getScope, "global")
            .last("LIMIT 1"));
        if (setting != null) {
            return setting;
        }
        setting = new TranslationSetting();
        setting.setTenantId(tenantId);
        setting.setScope("global");
        settingMapper.insert(setting);
        return settingMapper.selectById(setting.getId());
    }

    // ============ nodes ============

    public List<TranslationNodeVO> nodes() {
        return nodeMapper.selectList(new LambdaQueryWrapper<TranslationNode>()
                .orderByAsc(TranslationNode::getSort))
            .stream()
            .map(n -> new TranslationNodeVO(n.getId(), n.getName(), n.getLabel(), n.getUrl(),
                n.getBaseDelayMs(), n.getReachable()))
            .toList();
    }

    /** R9: delay is arithmetic, never a sleep. Unreachable nodes report null. */
    public List<ServerDelayVO> delays() {
        return nodeMapper.selectList(new LambdaQueryWrapper<TranslationNode>()
                .orderByAsc(TranslationNode::getSort))
            .stream()
            .map(n -> new ServerDelayVO(n.getName(),
                Boolean.FALSE.equals(n.getReachable()) ? null : n.getBaseDelayMs() + ThreadLocalRandom.current().nextInt(31)))
            .toList();
    }

    // ============ translate ============

    public TranslateVO translate(Long tenantId, TranslateDTO dto) {
        if (!"receive".equals(dto.type()) && !"send".equals(dto.type())) {
            throw new BizException(40000, "type 只能是 receive 或 send");
        }
        TranslationSetting s = requireSettings(tenantId);
        String fromLang = "receive".equals(dto.type()) ? s.getReceiveFromLang() : s.getSendFromLang();
        String toLang = "receive".equals(dto.type()) ? s.getReceiveToLang() : s.getSendToLang();
        String channel = s.getChannel();
        String normalized = SimulatedTranslationEngine.normalize(dto.text());
        if (normalized.isEmpty()) {
            throw new BizException(40000, "text 不能为空白");
        }
        String cacheKey = buildCacheKey(dto.type(), channel, fromLang, toLang, normalized);
        boolean keepInCache = !Boolean.TRUE.equals(dto.input());

        if (!Boolean.TRUE.equals(dto.noCache())) {
            TranslationCache hit = cacheMapper.selectOne(new LambdaQueryWrapper<TranslationCache>()
                .eq(TranslationCache::getTenantId, tenantId)
                .eq(TranslationCache::getCacheKey, cacheKey));
            if (hit != null) {
                cacheMapper.update(null, new LambdaUpdateWrapper<TranslationCache>()
                    .eq(TranslationCache::getId, hit.getId())
                    .setSql("hit_count = hit_count + 1"));
                return new TranslateVO(hit.getTargetText(), true, Boolean.TRUE.equals(hit.getPartial()),
                    containsChinese(hit.getTargetText()), dto.type(), channel,
                    displayFrom(fromLang, hit.getFromLang()), toLang, cacheKey);
            }
        }

        // R7: same in and out language — hand back the source, and do not cache it.
        if (fromLang != null && fromLang.equals(toLang)) {
            return new TranslateVO(normalized, false, false, containsChinese(normalized), dto.type(), channel,
                fromLang, toLang, cacheKey);
        }

        SimulatedTranslationEngine.EngineResult result = engine.translate(normalized, fromLang, toLang, channel);
        if (keepInCache) {
            writeCache(tenantId, cacheKey, dto.type(), channel, fromLang, toLang, normalized, result);
        }
        return new TranslateVO(result.translation(), false, result.partial(), containsChinese(result.translation()),
            dto.type(), channel, result.fromLang(), toLang, cacheKey);
    }

    private void writeCache(Long tenantId, String cacheKey, String type, String channel, String fromLang,
                            String toLang, String sourceText, SimulatedTranslationEngine.EngineResult result) {
        TranslationCache row = new TranslationCache();
        row.setTenantId(tenantId);
        row.setCacheKey(cacheKey);
        row.setType(type);
        row.setChannel(channel);
        row.setFromLang(fromLang == null ? "" : fromLang);
        row.setToLang(toLang);
        row.setSourceText(sourceText);
        row.setTargetText(result.translation());
        row.setPartial(result.partial());
        row.setHitCount(0);
        try {
            cacheMapper.insert(row);
        } catch (org.springframework.dao.DuplicateKeyException race) {
            // Another request for the same phrase won the race; its value is identical.
            cacheMapper.update(null, new LambdaUpdateWrapper<TranslationCache>()
                .eq(TranslationCache::getTenantId, tenantId)
                .eq(TranslationCache::getCacheKey, cacheKey)
                .setSql("hit_count = hit_count + 1"));
        }
    }

    public static String buildCacheKey(String type, String channel, String fromLang, String toLang, String normalized) {
        long hash = LongHashFunction.xx().hashChars(normalized);
        String from = (fromLang == null || fromLang.isBlank()) ? "auto" : fromLang;
        return type + "-" + channel + "-" + from + "-" + toLang + "-" + String.format("%016x", hash);
    }

    // ============ stats ============

    public TranslationCacheStatsVO cacheStats(Long tenantId) {
        List<TranslationCacheEntryVO> top = cacheMapper.selectList(new LambdaQueryWrapper<TranslationCache>()
                .eq(TranslationCache::getTenantId, tenantId)
                .orderByDesc(TranslationCache::getHitCount)
                .orderByDesc(TranslationCache::getId)
                .last("LIMIT 5"))
            .stream()
            .map(c -> new TranslationCacheEntryVO(c.getCacheKey(), c.getSourceText(), c.getTargetText(),
                c.getHitCount(), c.getPartial()))
            .toList();
        return new TranslationCacheStatsVO(cacheMapper.countKeys(tenantId), cacheMapper.sumHits(tenantId), top);
    }

    // ============ helpers ============

    private boolean containsChinese(String text) {
        return text != null && CHINESE.matcher(text).find();
    }

    private String displayFrom(String configured, String cachedFrom) {
        return (configured == null || configured.isBlank()) ? cachedFrom : configured;
    }

    private String defaultIfBlank(String value, String fallback) {
        return (value == null || value.isBlank()) ? fallback : value.trim();
    }

    private TranslationSettingVO toVO(TranslationSetting s) {
        return new TranslationSettingVO(s.getId(), s.getServer(), s.getServerMode(), s.getChannel(),
            s.getReceiveEnabled(), s.getReceiveFromLang(), s.getReceiveToLang(),
            s.getSendEnabled(), s.getSendFromLang(), s.getSendToLang(),
            s.getVoiceEnabled(), s.getPreviewEnabled(), s.getEnterToSend(),
            s.getDisableChinese(), s.getDisableChinesePreventSend());
    }
}
```

- [ ] **Step 3: `TranslationController`**

```java
package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.TranslationService;
import com.smartscrm.server.web.dto.TranslateDTO;
import com.smartscrm.server.web.dto.TranslationSettingInput;
import com.smartscrm.server.web.vo.ServerDelayVO;
import com.smartscrm.server.web.vo.TranslateVO;
import com.smartscrm.server.web.vo.TranslationCacheStatsVO;
import com.smartscrm.server.web.vo.TranslationNodeVO;
import com.smartscrm.server.web.vo.TranslationSettingVO;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/translation")
public class TranslationController {

    private final TranslationService service;

    public TranslationController(TranslationService service) {
        this.service = service;
    }

    @GetMapping("/settings")
    public ApiResponse<TranslationSettingVO> getSettings(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.getSettings(principal.tenantId()));
    }

    @PutMapping("/settings")
    public ApiResponse<TranslationSettingVO> updateSettings(@AuthenticationPrincipal AuthPrincipal principal,
                                                            @Valid @RequestBody TranslationSettingInput input) {
        return ApiResponse.ok(service.updateSettings(principal.tenantId(), input));
    }

    @GetMapping("/nodes")
    public ApiResponse<List<TranslationNodeVO>> nodes() {
        return ApiResponse.ok(service.nodes());
    }

    @GetMapping("/nodes/delays")
    public ApiResponse<List<ServerDelayVO>> delays() {
        return ApiResponse.ok(service.delays());
    }

    @PostMapping("/translate")
    public ApiResponse<TranslateVO> translate(@AuthenticationPrincipal AuthPrincipal principal,
                                              @Valid @RequestBody TranslateDTO dto) {
        return ApiResponse.ok(service.translate(principal.tenantId(), dto));
    }

    @GetMapping("/cache/stats")
    public ApiResponse<TranslationCacheStatsVO> cacheStats(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.cacheStats(principal.tenantId()));
    }
}
```

- [ ] **Step 4: 补第二个租户，让 R3 跨租户隔离可验证**

`config/DataSeeder.java`：在 `seedUsers` bean 之后追加一个幂等 bean（现有 `seedUsers` 在已有用户时直接 return，所以不能塞进它内部），并注入 `PasswordEncoder`：

```java
    @Bean
    public ApplicationRunner seedIsolationTenant(TenantMapper tenantMapper, AppUserMapper userMapper,
                                                 PasswordEncoder encoder) {
        return args -> {
            if (tenantMapper.selectCount(new LambdaQueryWrapper<Tenant>().eq(Tenant::getInviteCode, "QA0002")) > 0) {
                return;
            }
            Tenant qa = new Tenant();
            qa.setInviteCode("QA0002");
            qa.setName("QA Isolation Tenant");
            qa.setStatus(1);
            tenantMapper.insert(qa);
            userMapper.insert(buildUser(qa.getId(), "qa", "qa12345", "QA", "owner", encoder));
            log.info("Seeded QA0002 tenant for cross-tenant isolation checks");
        };
    }
```

`buildUser` 已是私有方法，直接复用。`Tenant` 实体的字段名以 `entity/Tenant.java` 为准（`inviteCode` / `name` / `status`）。

- [ ] **Step 5: 编译 + 单测回归 + 重启**

```bash
cd apps/server && ./mvnw -q -DskipTests package && ./mvnw -q test -Dtest=SimulatedTranslationEngineTest
netstat -ano | grep ':8180' | head -3
taskkill //PID <PID> //F
cd apps/server && ./mvnw -q spring-boot:run       # 后台
```

预期：打包成功、9 个测试通过、`curl -s localhost:8180/api/health` 返回 `code: 0`。

- [ ] **Step 6: 冒烟（两条命令，细节验证留给 Task 4）**

```bash
BASE=http://localhost:8180
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' \
  -d '{"inviteCode":"DEMO0001","username":"admin","password":"admin123","deviceId":"plan-p5"}' \
  | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
curl -s $BASE/api/translation/settings -H "Authorization: Bearer $TOKEN"; echo
curl -s $BASE/api/translation/nodes -H "Authorization: Bearer $TOKEN"; echo
```

预期：第一条返回 `code:0` 且 `data.server = "sg"`、`data.channel = "1"`、`data.receiveToLang = "zh-CN"`、`data.sendToLang = "en"`（注意 V5 已为 DEMO 租户插入该行，走的是 `requireSettings` 的读分支）；第二条返回 7 个节点，`sort` 升序，`my2.reachable = false`。

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/main/java/com/smartscrm/server
git commit -m "feat(P5a): 翻译中心后端 API"
```

---

### Task 4: 后端契约逐条验证（spec §6.1）

**Files:**
- Create（临时，验证用）: `tmp/p5-translate-zh.json`、`tmp/p5-translate-5001.json`、`tmp/p5-settings-bad-channel.json`（`.gitignore` 已忽略 `tmp/`；若未忽略则验证后删除，不提交）

**Interfaces:**
- Consumes: Task 3 的六个接口；`QA0002` / `qa` / `qa12345` 第二租户。
- Produces: 一张"用例 → 实际结果"的验证结论，写进最终报告。

- [ ] **Step 1: 准备 token 与 UTF-8 payload 文件**

```bash
BASE=http://localhost:8180
login() { curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' \
  -d "{\"inviteCode\":\"$1\",\"username\":\"$2\",\"password\":\"$3\",\"deviceId\":\"plan-p5\"}" \
  | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4; }
T_DEMO=$(login DEMO0001 admin admin123)
T_QA=$(login QA0002 qa qa12345)
echo "${#T_DEMO} ${#T_QA}"
```

预期：两个长度都大于 100（token 拿到）。用 Write 工具创建 `tmp/p5-translate-zh.json`（UTF-8）：

```json
{"text": "Xin chào, đơn hàng đã được gửi", "type": "receive"}
```

载荷必须是**外语**：默认 receive 语向是「自动 → zh-CN」，喂中文会走进同语向分支，
既证明不了词典翻译，也证明不了写缓存。

- [ ] **Step 2: 17 条契约用例**

逐条执行并记录（`H` 代表 `-H "Authorization: Bearer $T_DEMO"`；`POST_T` 代表 `-X POST -H 'content-type: application/json'`）：

| # | 命令要点 | 期望 |
|---|---|---|
| 1 | `GET /settings` | `data.server="sg"`、`serverMode="auto"`、`channel="1"`、`receiveToLang="zh-CN"`、`sendToLang="en"` |
| 2 | `PUT /settings` body `{"channel":"9","receiveToLang":"zh-CN","sendToLang":"en"}` | `code:40000` |
| 3 | `PUT /settings` body `{"server":"xx","receiveToLang":"zh-CN","sendToLang":"en"}` | `code:40000` |
| 4 | `PUT /settings` body `{"server":"hk","channel":"2",...}` | `code:40000`（R5 后端侧） |
| 5 | `GET /nodes/delays` 两次 | 7 项、`my2.delay === null`、两次同名节点 delay 有差异（R9 抖动） |
| 6 | `POST /translate @tmp/p5-translate-zh.json` | `cached:false`、`translation=="你好, 订单已发货"`、`fromLangCode="vi"`、`partial:true`（逗号未命中）、`cacheKey` 形如 `receive-1-auto-zh-CN-<16 hex>` |
| 7 | 同命令再跑一次 | `cached:true`；`GET /cache/stats` 里该键 `hitCount` 变 1 |
| 8 | `PUT /settings {"channel":"2",...}` 后再 `POST /translate` 同文本 | `cached:false`（key 含渠道） |
| 9 | `PUT /settings {"channel":"1","sendFromLang":"en","sendToLang":"en",...}` 后 `POST /translate {"text":"hello there","type":"send"}` 两次 | 两次都 `cached:false`，译文 == 归一化原文（R7） |
| 10 | `PUT /settings` 恢复 `channel:"1"`；`POST /translate @tmp/p5-translate-zh.json` 带 `"noCache":true` | `cached:false`（跳过读） |
| 11 | `POST /translate {"text":"hello there friend","type":"send","input":true}` 两次 | 两次 `cached:false`，且 `GET /cache/stats` 的 `totalKeys` 不因这两次增长 |
| 12 | `PUT /settings {"receiveFromLang":"sw","receiveToLang":"is",...}` 后 `POST /translate {"text":"habari gani","type":"receive"}` | `translation=="habari gani"`、`partial:true`、HTTP 200（R8）；随后把 from/to 恢复 `""` / `zh-CN` |
| 13 | `POST /translate @tmp/p5-translate-5001.json`（5001 个 `a`） | `code:40000` |
| 14 | `PUT /settings {"channel":"3","sendFromLang":"zh-CN","sendToLang":"en",...}` 后 `POST /translate {"text":"你好","type":"send","noCache":true}` | 译文 `"Hello."`（句首大写 + 句号）；再 `PUT {"channel":"1"}` 跑同文本 → `"Hello"` 保持原样。语向必须真的发生翻译，否则同语向分支直接返回原文，`style()` 走不到 |
| 15 | `GET /cache/stats` | `totalKeys >= 1`、`totalHits >= 1`、`top` ≤ 5 条 |
| 16 | 用 `$T_QA` 跑 `POST /translate @tmp/p5-translate-zh.json`（先确保 QA 租户 channel=1） | `cached:false`（R3 跨租户不共享） |
| 17 | 不带 token `POST /translate @tmp/p5-translate-zh.json` | HTTP 401，`code:40100` |

`tmp/p5-translate-5001.json` 用 Write 生成（`{"text":"aaaa…(5001)","type":"receive"}`）。5001 个 `a` 由执行者用编辑器复制生成，或用一行 shell 生成后检查长度：

```bash
python - <<'PY'
open('tmp/p5-translate-5001.json','w',encoding='utf-8').write('{"text":"' + 'a'*5001 + '","type":"receive"}')
PY
```

（本机没有 python 时改用：`node -e "require('fs').writeFileSync('tmp/p5-translate-5001.json', JSON.stringify({text:'a'.repeat(5001), type:'receive'}))"`；两者都不可用时用 Write 工具直接写文件。）

- [ ] **Step 3: 逐条核对**

任一条不符即视为缺陷：**修代码**（不留 `TODO`），修完 `./mvnw -q -DskipTests package` + 重启 + 重跑该条与它相邻的两条。全部通过才进 Step 4。

- [ ] **Step 4: 复位设置并清理临时文件**

```bash
curl -s -X PUT $BASE/api/translation/settings -H "Authorization: Bearer $T_DEMO" \
  -H 'content-type: application/json' \
  -d '{"server":"sg","serverMode":"auto","channel":"1","receiveFromLang":"","receiveToLang":"zh-CN","sendFromLang":"","sendToLang":"en","enterToSend":false,"disableChinesePreventSend":false}'
curl -s $BASE/api/translation/settings -H "Authorization: Bearer $T_DEMO"; echo
rm -f tmp/p5-translate-zh.json tmp/p5-translate-5001.json tmp/p5-settings-bad-channel.json
```

预期：`data.channel="1"`、`receiveFromLang=""`、`sendToLang="en"`、`enterToSend=false`。
`translation_cache` 里自测产生的键**保留**（见"对 spec 的收敛 #4"），DEMO 的客户 / 标签 / 人群包 / 素材 / 快捷回复计数不受影响。

- [ ] **Step 5: 若 Step 2–4 暴露过缺陷，此时提交修复**

```bash
cd apps/server && ./mvnw -q test -Dtest=SimulatedTranslationEngineTest
git status --short
```

有改动才提交：

```bash
git add apps/server/src
git commit -m "fix(P5a): <用一句话写明哪条契约用例暴露的问题>"
```

P5a 完成判据：`./mvnw test` 绿 + §6.1 全部用例通过 + 设置已复位。

---

## P5b — 主进程通道 + 注入渲染层

### Task 5: `sendToView` 与真实 `view:invoke` 转发

**Files:**
- Modify: `apps/desktop/src/main/webContentsView/manager.ts`（`uninject` 之后插入新方法）
- Create: `apps/desktop/src/main/services/translationBridge.ts`
- Modify: `apps/desktop/src/main/webContentsView/ipc.ts`（`registerViewIpc` 内）
- Modify: `apps/desktop/src/preload/index.ts`（`scrm.view` 内）
- Modify: `apps/desktop/src/renderer/src/services/viewService.ts`（fallback）

**Interfaces:**
- Consumes: `getSession()`（`main/state/session.ts`）、后端 `POST /api/translation/translate`、`viewManager.getViewIdByWebContents()`。
- Produces:
  - `viewManager.sendToView(viewId: string, channel: string, payload: unknown): boolean`
  - `viewManager.getInjectConfig(viewId: string): Record<string, unknown> | undefined`
  - IPC `wcv-send-to-view`（handle，参数同上，返回 `boolean`）
  - IPC `view:invoke`：`{ channel: 'translate-api', data: TranslateRequest }` → `TranslateResponse | null`
  - `requestTranslation(req: TranslateRequest, apiBase?: string): Promise<TranslateResponse | null>`
  - preload `scrm.view.sendToView(viewId, channel, payload): Promise<boolean>`

- [ ] **Step 1: manager 补 sendToView 与 getInjectConfig**

`preload/view.ts` 已经在监听 `view:host:${channel}`，主进程缺的是发送方。在 `WebContentsViewManager` 的 `uninject()` 方法之后加：

```ts
  /** Push to an embedded page; `preload/view.ts` exposes these as `window.ele.on(channel, cb)`. */
  sendToView(viewId: string, channel: string, payload: unknown): boolean {
    const managed = this.views.get(viewId)
    if (!managed) return false
    managed.view.webContents.send(`view:host:${channel}`, payload)
    return true
  }

  getInjectConfig(viewId: string): Record<string, unknown> | undefined {
    return this.injects.get(viewId)?.config
  }
```

- [ ] **Step 2: 新建 translationBridge**

`apps/desktop/src/main/services/translationBridge.ts`：后端地址沿用渲染层注入时传下来的 `apiBase`（`AccountStage` 的 `injectConfig`），主进程不再引入第二个环境开关。

```ts
import { getSession } from '../state/session'

const DEFAULT_API_BASE = 'http://localhost:8180'
const REQUEST_TIMEOUT_MS = 5000

export interface TranslateRequest {
  text: string
  type: 'receive' | 'send'
  input?: boolean
  noCache?: boolean
}

export interface TranslateResponse {
  translation: string
  cached: boolean
  partial: boolean
  containsChinese: boolean
  channel: string
  fromLangCode: string
  toLangCode: string
  cacheKey: string
}

/**
 * The only privileged hop in the translation path: an embedded third-party page asks for
 * a translation, this module calls the local backend with the stored token attached.
 * The token never crosses into the preload or the page, and every failure collapses to null
 * so the injected layer can fall back to "no translation".
 */
export async function requestTranslation(
  req: TranslateRequest,
  apiBase?: string
): Promise<TranslateResponse | null> {
  const accessToken = getSession()?.accessToken
  if (!accessToken) return null
  try {
    const res = await fetch(`${apiBase || DEFAULT_API_BASE}/api/translation/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const body = (await res.json()) as { code: number; data?: TranslateResponse }
    return body.code === 0 && body.data ? body.data : null
  } catch {
    return null
  }
}
```

- [ ] **Step 3: ipc.ts 接上两条通道**

文件顶部补 import：

```ts
import { requestTranslation } from '../services/translationBridge'
```

`ALLOWED_HOST_CHANNELS` 之后加白名单与令牌桶（速率限制按 `viewId`，窗口固定 1 秒）：

```ts
/** Channels an embedded page may ask the host to serve. */
const ALLOWED_INVOKE_CHANNELS = new Set<string>(['translate-api'])
/** Channels the host renderer may push into an embedded page. */
const ALLOWED_PUSH_CHANNELS = new Set<string>(['update-translation-flags'])
const RATE_WINDOW_MS = 1000
const RATE_LIMIT = 20
const rateBuckets = new Map<string, { windowStart: number; count: number }>()

function rateLimited(viewId: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(viewId)
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(viewId, { windowStart: now, count: 1 })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT
}
```

`registerViewIpc()` 内，`wcv-uninject` 那行之后注册推送通道：

```ts
  ipcMain.handle('wcv-send-to-view', (_e, viewId: string, channel: string, payload: unknown) => {
    if (!ALLOWED_PUSH_CHANNELS.has(channel)) return false
    return viewManager.sendToView(viewId, channel, payload)
  })
```

把 `view:invoke` 的空桩整段替换为：

```ts
  // Page -> host request/response. Only whitelisted channels reach the backend, and the
  // page can never name a language, a channel or a token (spec §4.2).
  ipcMain.handle('view:invoke', async (event: IpcMainInvokeEvent, arg: { channel: string; data: unknown }) => {
    if (!arg || !ALLOWED_INVOKE_CHANNELS.has(arg.channel)) return null
    const viewId = viewManager.getViewIdByWebContents(event.sender.id)
    if (!viewId || rateLimited(viewId)) return null
    const req = arg.data as Partial<{ text: string; type: string; input: boolean; noCache: boolean }> | undefined
    const text = typeof req?.text === 'string' ? req.text : ''
    if (!text || text.length > 5000) return null
    const type = req?.type === 'send' ? 'send' : 'receive'
    const apiBase = viewManager.getInjectConfig(viewId)?.apiBase
    return requestTranslation({
      text,
      type,
      ...(req?.input === true ? { input: true } : {}),
      ...(req?.noCache === true ? { noCache: true } : {}),
    }, typeof apiBase === 'string' ? apiBase : undefined)
  })
```

（`apiBase` 由渲染层注入时写进 `injectConfig`，见 `AccountStage.tsx`；缺省时 `translationBridge` 用 `DEFAULT_API_BASE`。）

- [ ] **Step 4: preload 与 viewService 补 sendToView**

`src/preload/index.ts` 的 `view` 对象里，`uninject` 那行之后加：

```ts
    sendToView: (viewId: string, channel: string, payload: unknown): Promise<boolean> =>
      ipcRenderer.invoke('wcv-send-to-view', viewId, channel, payload),
```

`src/renderer/src/services/viewService.ts` 的 `fallback` 里，`uninject: noop,` 之后加（`ViewApi` 类型由 preload 推导，无需另改）：

```ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sendToView: (_viewId: string, _channel: string, _payload: unknown): Promise<boolean> =>
    Promise.resolve(false),
```

- [ ] **Step 5: typecheck + 构建**

```bash
cd apps/desktop && pnpm typecheck
```

预期：三份 tsconfig 全部无错误（`ViewApi` 会自动带上新的 `sendToView`；若报 fallback 缺属性，说明 Step 4 的第二处漏了）。

- [ ] **Step 6: 用"自测视图"端到端验证 `view:invoke`（不需要 WhatsApp 登录）**

后端保持运行（Task 3 已启动 8180）。启动桌面端并在主窗口 DevTools（右键 → 检查）Console 里执行：

```js
const v = window.scrm.view
await v.create('selftest', 'http://localhost:8180/api/health')   // 本地页面，可注入
await v.show('selftest')
await v.setBounds('selftest', { x: 80, y: 80, width: 600, height: 400 })
await v.inject('selftest', 'WhatsApp', { webviewId: 'selftest', inviteCode: 'DEMO0001' })
await v.executeJS('selftest', 'JSON.stringify(window.ele ? { bridge: true } : {})')
await v.executeJS('selftest',
  'window.ele.invoke("translate-api", { text: "你好", type: "send" }).then(r => JSON.stringify(r))')
```

预期：最后一行返回一个 JSON 字符串，其中 `translation` 含 `Hello`、`cached` 为 `false`/`true`、`cacheKey` 形如 `send-1-auto-en-xxxxxxxxxxxxxxxx`。这里用 `type:"send"`（默认语向 → en）而不是 `receive`：receive 的目标语是 `zh-CN`，喂中文会走进同语向分支、拿不到 `Hello`。这一步证明 页面 → 主进程 → Java 的转发、白名单与令牌桶入口都通了。再验证白名单：

```js
await v.executeJS('selftest', 'window.ele.invoke("delete-everything", {}).then(r => JSON.stringify(r ?? null))')
await v.executeJS('selftest', 'window.ele.invoke("translate-api", { text: "x".repeat(5001), type: "receive" }).then(r => JSON.stringify(r ?? null))')
```

预期：两次都返回 `null`。收尾：`await v.destroy('selftest')`。

> 这一步是本机唯一能在不扫码登录的情况下验证注入 → 后端通路的手段；它验证的是通道，不是 WhatsApp DOM 渲染（那是 §6.3 手工清单）。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer/src/services/viewService.ts
git commit -m "feat(P5b): 主进程翻译转发与页面推送通道"
```

---

### Task 6: 注入层状态与设置通道对齐（含两处前置修复）

**Files:**
- Modify: `apps/desktop/src/inject/constants/events.ts`
- Modify: `apps/desktop/src/inject/constants/config.ts`
- Modify: `apps/desktop/src/inject/types.ts`
- Modify: `apps/desktop/src/inject/core/StateManager.ts`
- Modify: `apps/desktop/src/inject/core/PlatformAdapter.ts`
- Modify: `apps/desktop/src/inject/core/BaseInjector.ts`

**Interfaces:**
- Consumes: Task 5 的 `wcv-send-to-view` / `update-translation-flags` 通道名。
- Produces:
  - 常量 `UPDATE_TRANSLATION_FLAGS = 'update-translation-flags'`（`constants/events.ts`）
  - `interface TranslationFlags { receiveEnabled: boolean; sendEnabled: boolean; previewEnabled: boolean; disableChinese: boolean; disableChinesePreventSend: boolean; revision: number }`（`types.ts`）
  - `StateManager.receiveLangSetting: LangSetting{ enabled, fromLangCode, toLangCode }`、`sendLangSetting`、`previewEnabled`、`disableChinese`、`disableChinesePreventSend`、`updateTranslationFlags(flags)`、`attachTranslationTimer(timer)`
  - `PlatformAdapter.setupTranslationListeners(injector: BaseInjector): () => void`

- [ ] **Step 1: 事件常量**

`constants/events.ts`：删掉 `LANG_SETTING_CHANGE` 与 `VOICE_SETTING_CHANGE` 两行（当前无人发送，属于死通道），在 `// Host -> inject` 段落末尾加：

```ts
/** Single host -> inject channel carrying every translation toggle (spec §4.1 fix 2). */
export const UPDATE_TRANSLATION_FLAGS = 'update-translation-flags'
```

- [ ] **Step 2: config 常量**

`constants/config.ts`：把

```ts
export const DEFAULT_LANG_SETTING = { enabled: true, fromLang: 'auto', toLang: 'zh' }
export const DEFAULT_VOICE_SETTING = { enabled: true }
```

替换为（字段名与值都要能和后端 VO 对上；语向只作展示，实际以服务端解析为准）：

```ts
export const DEFAULT_RECEIVE_LANG_SETTING = { enabled: true, fromLangCode: '', toLangCode: 'zh-CN' }
export const DEFAULT_SEND_LANG_SETTING = { enabled: true, fromLangCode: '', toLangCode: 'en' }
```

并删掉未被使用的 `TRANSLATION_POLL_INTERVAL`（扫描只用 `MESSAGE_SCAN_INTERVAL` + MutationObserver，不引入第三个轮询）。

- [ ] **Step 3: types.ts 补 TranslationFlags**

在 `export interface InjectConfig` 之前加：

```ts
/** Host -> inject translation switches. Language choice is resolved by the backend (R2). */
export interface TranslationFlags {
  receiveEnabled: boolean
  sendEnabled: boolean
  previewEnabled: boolean
  disableChinese: boolean
  disableChinesePreventSend: boolean
  /** Bumped by the renderer whenever the stored settings actually changed. */
  revision: number
}
```

- [ ] **Step 4: StateManager**

`core/StateManager.ts` 改动四处：

```ts
import { DEFAULT_RECEIVE_LANG_SETTING, DEFAULT_SEND_LANG_SETTING } from '../constants/config'
import type { TranslationFlags } from '../types'

export interface LangSetting {
  enabled: boolean
  fromLangCode: string
  toLangCode: string
}
```

字段区把 `receiveLangSetting` / `sendLangSetting` 换成新默认值，删掉 `VoiceSetting` 接口、`voiceSetting` 字段与 `updateVoiceSetting` 方法，并新增三个开关：

```ts
  receiveLangSetting: LangSetting = { ...DEFAULT_RECEIVE_LANG_SETTING }
  sendLangSetting: LangSetting = { ...DEFAULT_SEND_LANG_SETTING }
  previewEnabled = true
  disableChinese = true
  disableChinesePreventSend = false
```

把 `updateLangSetting` 整个方法换成下面这个（`updateLangSetting` 的唯一调用方是 Step 6 要删掉的死监听，留着就是无人调用的公开方法）：

```ts
  updateTranslationFlags(flags: Partial<TranslationFlags>): void {
    if (typeof flags.receiveEnabled === 'boolean') {
      this.receiveLangSetting = { ...this.receiveLangSetting, enabled: flags.receiveEnabled }
    }
    if (typeof flags.sendEnabled === 'boolean') {
      this.sendLangSetting = { ...this.sendLangSetting, enabled: flags.sendEnabled }
    }
    if (typeof flags.previewEnabled === 'boolean') this.previewEnabled = flags.previewEnabled
    if (typeof flags.disableChinese === 'boolean') this.disableChinese = flags.disableChinese
    if (typeof flags.disableChinesePreventSend === 'boolean') {
      this.disableChinesePreventSend = flags.disableChinesePreventSend
    }
  }

  attachTranslationTimer(timer: ReturnType<typeof setInterval>): void {
    if (this._translationTimer) clearInterval(this._translationTimer)
    this._translationTimer = timer
  }
```

- [ ] **Step 5: PlatformAdapter**

删掉 `renderTranslation(element, translatedText)` 方法（全仓库无调用方，译文 DOM 由 Task 7 的新模块负责）。在 `setupPlatformListeners` 之后加：

```ts
  /** Mount translation behaviour even when a backgrounded view skips foreground lightening. */
  setupTranslationListeners(_injector: BaseInjector): () => void {
    return () => {}
  }
```

- [ ] **Step 6: BaseInjector 通道名修复 + 翻译挂载**

`core/BaseInjector.ts`：import 补

```ts
import { INJECTOR_READY, REPORT_ERROR, UPDATE_TRANSLATION_FLAGS } from '../constants/events'
import type { InjectConfig, TranslationFlags } from '../types'
```

（原有 `import type { InjectConfig } from '../types'` 改成这一行。）

`_setupIpcListeners()` 里删掉两个死监听，换成：

```ts
    on<TranslationFlags>(UPDATE_TRANSLATION_FLAGS, (flags) => this._applyFlags(flags))
```

类字段区加 `private _translationDisposers: Array<() => void> = []`，方法区加：

```ts
  private _applyFlags(flags: TranslationFlags): void {
    this.state.updateTranslationFlags(flags)
    this.sendToHost('translation-flags-applied', { webviewId: this.webviewId, revision: flags.revision })
  }

  /** Translation is mounted outside the background-lightening gate: a hidden view still needs it. */
  private _attachTranslation(): void {
    try {
      this._translationDisposers.push(this.adapter.setupTranslationListeners(this))
    } catch (e) {
      this._reportError('translation', e)
    }
  }
```

`inject()` 内，把现有的门控块改成（保持 foreground 特性仍受后台轻量化控制，翻译不受）：

```ts
      await this.adapter.init()
      this._setupIpcListeners()
      this._attachTranslation()
      if (!this._runtimeOptimizationEnabled || this.platform !== 'WhatsApp') {
        this._attachForegroundFeatures()
      }
```

`destroy()` 内在 `this.adapter.cleanup()` 之前加：

```ts
    this._translationDisposers.forEach((off) => off())
    this._translationDisposers = []
```

> `_applyFlags` 里的 `sendToHost('translation-flags-applied', …)` 是给 §6.3 手工清单"关闭接收翻译后新消息不再插译文"留的可见证据。它走 `view:toHost`，因此必须把 `'translation-flags-applied'` 加进 `ipc.ts` 的 `ALLOWED_HOST_CHANNELS`（本任务同一批改动里补上）。

- [ ] **Step 7: typecheck**

```bash
cd apps/desktop && pnpm typecheck && pnpm build:inject
```

预期：无类型错误，`resources/inject.bundle.js` 重新生成。（若 `platforms/telegram/index.ts` 因 `renderTranslation` 删除而报错，说明 TG 侧有调用方——按报错把它一起删掉，不要保留兼容壳。）

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/inject apps/desktop/src/main/webContentsView/ipc.ts
git commit -m "fix(P5b): 注入层设置通道与状态字段对齐"
```

---

### Task 7: 译文状态、请求节流与 DOM 渲染

**Files:**
- Create: `apps/desktop/src/inject/core/translation/messageState.ts`
- Create: `apps/desktop/src/inject/core/translation/translationQueue.ts`
- Create: `apps/desktop/src/inject/core/translation/renderTranslation.ts`

**Interfaces:**
- Consumes: `BaseInjector.invoke()`、`constants/config.ts` 的 `TRANSLATE_THROTTLE_TIME` / `CSS_CLASSES`、`constants/events.ts` 的 `TRANSLATE_API`、`StateManager.markTranslated/isTranslated`。
- Produces:
  - `interface MsgState { msgId: string; text: string; channel: string; toLang: string; translation: string | null; retryCount: number }`
  - `getMessageState(msgId): MsgState | undefined` / `saveMessageState(state): void` / `clearMessageStates(): void`
  - `requestTranslate(injector: BaseInjector, req: TranslateRequest): Promise<TranslateResponse | null>`
  - `interface TranslateRequest { text: string; type: 'receive' | 'send'; input?: boolean; noCache?: boolean }` / `interface TranslateResponse { translation: string; cached: boolean; partial: boolean; containsChinese: boolean; channel: string; fromLangCode: string; toLangCode: string; cacheKey: string }`
  - `translationNodeId(msgId: string): string` / `ensureTranslationStyle(): void` / `renderTranslation(msgId, row, text, opts?): void` / `renderPendingTranslation(msgId, row): void` / `hasTranslationNode(msgId): boolean` / `removeTranslation(msgId): void` / `removeAllTranslations(): void`

- [ ] **Step 1: messageState.ts**

```ts
export interface MsgState {
  msgId: string
  /** The source text this translation belongs to; a change means the message was edited. */
  text: string
  channel: string
  toLang: string
  translation: string | null
  retryCount: number
}

const states = new Map<string, MsgState>()

export function getMessageState(msgId: string): MsgState | undefined {
  return states.get(msgId)
}

export function saveMessageState(state: MsgState): void {
  states.set(state.msgId, state)
}

export function clearMessageStates(): void {
  states.clear()
}
```

- [ ] **Step 2: translationQueue.ts**

```ts
import { TRANSLATE_THROTTLE_TIME } from '../../constants/config'
import { TRANSLATE_API } from '../../constants/events'
import type { BaseInjector } from '../BaseInjector'

export interface TranslateRequest {
  text: string
  type: 'receive' | 'send'
  input?: boolean
  noCache?: boolean
}

export interface TranslateResponse {
  translation: string
  cached: boolean
  partial: boolean
  containsChinese: boolean
  channel: string
  fromLangCode: string
  toLangCode: string
  cacheKey: string
}

const inflight = new Map<string, Promise<TranslateResponse | null>>()
let lastStartedAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One shared pacing gate: the page can hold hundreds of bubbles but the backend needs calm. */
async function pace(): Promise<void> {
  const wait = lastStartedAt + TRANSLATE_THROTTLE_TIME - Date.now()
  if (wait > 0) await sleep(wait)
  lastStartedAt = Date.now()
}

export function requestTranslate(
  injector: BaseInjector,
  req: TranslateRequest
): Promise<TranslateResponse | null> {
  const key = `${req.type}|${req.input === true ? 'i' : 'f'}|${req.text}`
  const running = inflight.get(key)
  if (running) return running

  const task = (async (): Promise<TranslateResponse | null> => {
    await pace()
    try {
      return (await injector.invoke<TranslateResponse>(TRANSLATE_API, req)) ?? null
    } catch {
      return null
    }
  })().finally(() => inflight.delete(key))

  inflight.set(key, task)
  return task
}
```

- [ ] **Step 3: renderTranslation.ts**

```ts
import { CSS_CLASSES } from '../../constants/config'

const STYLE_ID = 'scrm-inject-style'
const TEXT_CLASS = 'translated-text'

export function translationNodeId(msgId: string): string {
  return `translation-${msgId}`
}

/** Ids are assigned through the DOM API, so `getElementById` is the only safe lookup. */
export function hasTranslationNode(msgId: string): boolean {
  return document.getElementById(translationNodeId(msgId)) !== null
}

export function ensureTranslationStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = [
    `.${CSS_CLASSES.TRANSLATED}{margin-top:4px;font-size:13px;line-height:18px;opacity:.85;white-space:pre-wrap;word-break:break-word}`,
    `.${CSS_CLASSES.TRANSLATED} .${TEXT_CLASS}{display:block}`,
    `.${CSS_CLASSES.TRANSLATING}{opacity:.5}`,
    `.${CSS_CLASSES.TRANSLATE_ERROR}{opacity:.8}`,
    `.${CSS_CLASSES.MASK}{display:inline-block;margin-top:2px;font-size:12px;color:#00a884;cursor:pointer;border-bottom:1px dashed currentColor}`
  ].join('\n')
  document.head.appendChild(style)
}

function node(msgId: string, row: HTMLElement): HTMLElement | null {
  const existing = document.getElementById(translationNodeId(msgId))
  if (existing) return existing
  if (!row.isConnected) return null
  const created = document.createElement('div')
  created.id = translationNodeId(msgId)
  created.className = CSS_CLASSES.TRANSLATED
  row.appendChild(created)
  return created
}

export function renderPendingTranslation(msgId: string, row: HTMLElement): void {
  const holder = node(msgId, row)
  if (!holder) return
  holder.className = `${CSS_CLASSES.TRANSLATED} ${CSS_CLASSES.TRANSLATING}`
  holder.textContent = '翻译中…'
}

export function renderTranslation(
  msgId: string,
  row: HTMLElement,
  text: string,
  opts: { error?: boolean } = {}
): void {
  const holder = node(msgId, row)
  if (!holder) return
  holder.className = opts.error
    ? `${CSS_CLASSES.TRANSLATED} ${CSS_CLASSES.TRANSLATE_ERROR}`
    : CSS_CLASSES.TRANSLATED
  holder.textContent = ''
  const span = document.createElement('span')
  span.className = TEXT_CLASS
  span.textContent = text
  holder.appendChild(span)
}

export function removeTranslation(msgId: string): void {
  document.getElementById(translationNodeId(msgId))?.remove()
}

export function removeAllTranslations(): void {
  document.querySelectorAll(`.${CSS_CLASSES.TRANSLATED}`).forEach((el) => el.remove())
}
```

- [ ] **Step 4: typecheck 并提交**

```bash
cd apps/desktop && pnpm typecheck:inject
git add apps/desktop/src/inject/core/translation
git commit -m "feat(P5b): 注入层译文状态、节流与渲染模块"
```

预期：`typecheck:inject` 无错误（这三个模块还没有调用方，`noUnusedLocals` 只在文件内生效，不会因"未被引用"报错）。

---

### Task 8: 消息扫描、重试上限与 WhatsApp 接线

**Files:**
- Modify: `apps/desktop/src/inject/platforms/whatsapp/selectors.ts`（`MESSAGE` 内加 `expandMore`）
- Create: `apps/desktop/src/inject/core/translation/manualButton.ts`
- Create: `apps/desktop/src/inject/core/translation/domScan.ts`
- Modify: `apps/desktop/src/inject/platforms/whatsapp/index.ts`
- Modify: `apps/desktop/src/inject/core/BaseInjector.ts`（flags revision 变化时清表）

**Interfaces:**
- Consumes: Task 7 三个模块；`PlatformAdapter.getMessageElements()` / `getMessageId()` / `getMessageText()` / `getMessageContainer()`；`StateManager.markTranslated/isTranslated/reset`。
- Produces:
  - `startMessageTranslation(injector: BaseInjector): () => void`
  - `renderManualButton(msgId: string, row: HTMLElement, onRetry: () => void): void`
  - `MESSAGE.expandMore` 选择器常量
  - `WhatsAppAdapter.setupTranslationListeners(injector)` 覆盖

- [ ] **Step 1: 折叠长文本选择器**

`platforms/whatsapp/selectors.ts` 的 `MESSAGE` 对象里加一行（这是 WhatsApp 的"阅读更多"控件，类名易漂移，所以集中在本文件）：

```ts
export const MESSAGE = {
  container: 'div#main',
  textNode: '.copyable-text',
  focusable: 'div[role="listitem"]',
  /** "Read more" marker on a collapsed long message; collapsed text must not be translated. */
  expandMore: '[data-tab="10"]'
}
```

- [ ] **Step 2: manualButton.ts**

```ts
import { CSS_CLASSES } from '../../constants/config'
import { removeTranslation, translationNodeId } from './renderTranslation'

/** Shown after the retry budget is spent, so a dead backend stops as a button, not a loop. */
export function renderManualButton(msgId: string, row: HTMLElement, onRetry: () => void): void {
  const existing = document.getElementById(translationNodeId(msgId))
  const holder = existing ?? document.createElement('div')
  holder.id = translationNodeId(msgId)
  holder.className = `${CSS_CLASSES.TRANSLATED} ${CSS_CLASSES.TRANSLATE_ERROR}`
  holder.textContent = ''
  const button = document.createElement('span')
  button.className = CSS_CLASSES.MASK
  button.textContent = '手动翻译'
  button.setAttribute('role', 'button')
  button.tabIndex = 0
  const run = (): void => {
    removeTranslation(msgId)
    onRetry()
  }
  button.addEventListener('click', run)
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') run()
  })
  holder.appendChild(button)
  if (!existing && row.isConnected) row.appendChild(holder)
}
```

- [ ] **Step 3: domScan.ts**

```ts
import { MESSAGE_SCAN_INTERVAL } from '../../constants/config'
import type { BaseInjector } from '../BaseInjector'
import { clearMessageStates, getMessageState, saveMessageState } from './messageState'
import { requestTranslate } from './translationQueue'
import {
  ensureTranslationStyle,
  hasTranslationNode,
  removeTranslation,
  removeAllTranslations,
  renderPendingTranslation,
  renderTranslation
} from './renderTranslation'
import { renderManualButton } from './manualButton'

const MAX_RETRY = 3

export function startMessageTranslation(injector: BaseInjector): () => void {
  ensureTranslationStyle()
  const { adapter, state } = injector
  const expandMore = adapter.getSelectors().expandMore
  let stopped = false
  let scanning = false
  let observer: MutationObserver | null = null
  let lastRevision = -1

  const queue = (): void => {
    if (stopped || scanning) return
    scanning = true
    void scan()
      .catch(() => undefined)
      .finally(() => {
        scanning = false
      })
  }

  async function scan(): Promise<void> {
    if (!state.receiveLangSetting.enabled) return
    if (state.translationRevision !== lastRevision) {
      lastRevision = state.translationRevision
      clearMessageStates()
      removeAllTranslations()
    }
    for (const row of adapter.getMessageElements()) {
      if (stopped) return
      const msgId = adapter.getMessageId(row)
      if (!msgId) continue
      const text = adapter.getMessageText(row)
      if (!text) continue
      // 折叠长文本里只有截断内容：宁可不译，展开后 MutationObserver 会补译。
      if (expandMore && row.querySelector(expandMore)) continue
      await translateOne(row, msgId, text)
    }
  }

  async function translateOne(row: HTMLElement, msgId: string, text: string): Promise<void> {
    const saved = getMessageState(msgId)
    // 已有译文：只重绘，不再发请求（消息滚出可视区再回来走这条）。
    if (saved && saved.translation !== null && saved.text === text) {
      if (!hasTranslationNode(msgId)) {
        renderTranslation(msgId, row, saved.translation)
        state.markTranslated(msgId)
      }
      return
    }
    // 重试预算花完：停成一个按钮，不是一个循环。
    if (saved && saved.text === text && saved.retryCount >= MAX_RETRY) {
      if (!hasTranslationNode(msgId)) renderManualButton(msgId, row, () => retry(msgId, text))
      state.markTranslated(msgId)
      return
    }
    if (state.isTranslated(msgId)) return

    renderPendingTranslation(msgId, row)
    // R1: sent and received bubbles alike go through the receive direction.
    const result = await requestTranslate(injector, { text, type: 'receive' })
    if (stopped || !row.isConnected) return

    if (result) {
      state.markTranslated(msgId)
      saveMessageState({
        msgId,
        text,
        channel: result.channel,
        toLang: result.toLangCode,
        translation: result.translation,
        retryCount: 0
      })
      renderTranslation(msgId, row, result.translation)
      return
    }

    // 失败：不标记完成，留给下一轮扫描重试；retryCount 累加到 MAX_RETRY 后出手动按钮。
    removeTranslation(msgId)
    saveMessageState({
      msgId,
      text,
      channel: '',
      toLang: '',
      translation: null,
      retryCount: (saved && saved.text === text ? saved.retryCount : 0) + 1
    })
  }

  function retry(msgId: string, text: string): void {
    saveMessageState({ msgId, text, channel: '', toLang: '', translation: null, retryCount: 0 })
    // 手动按钮那条分支已经 markTranslated，这里必须放行一次，否则点击无效。
    state.translatedMsgIds.delete(msgId)
    queue()
  }

  const container = adapter.getMessageContainer()
  if (container) {
    observer = new MutationObserver(queue)
    observer.observe(container, { childList: true, subtree: true })
  }
  const timer = setInterval(queue, MESSAGE_SCAN_INTERVAL)
  state.attachTranslationTimer(timer)

  return () => {
    stopped = true
    clearInterval(timer)
    observer?.disconnect()
    observer = null
    removeAllTranslations()
    clearMessageStates()
  }
}
```

`translateOne` 的三个分支顺序不能换：已有译文 → 重试耗尽 → 尚未发起。失败时**不**调用 `markTranslated`，所以 `MESSAGE_SCAN_INTERVAL` 的下一轮扫描就是重试；累加到 `MAX_RETRY` 后停在手动按钮上（§spec 6.3 倒数第二项）。

- [ ] **Step 4: StateManager 加 revision**

`core/StateManager.ts`：字段区加 `translationRevision = 0`，`updateTranslationFlags(flags)` 末尾加：

```ts
    if (typeof flags.revision === 'number' && flags.revision !== this.translationRevision) {
      this.translationRevision = flags.revision
    }
```

`reset()` 里加 `this.translationRevision = 0`。

- [ ] **Step 5: WhatsApp 适配器接线**

`platforms/whatsapp/index.ts` import 补：

```ts
import { startMessageTranslation } from '../../core/translation/domScan'
```

类内加覆盖：

```ts
  override setupTranslationListeners(injector: BaseInjector): () => void {
    return startMessageTranslation(injector)
  }
```

- [ ] **Step 6: typecheck + build**

```bash
cd apps/desktop && pnpm typecheck && pnpm build:inject
```

预期：全绿。这一步之后，注入 bundle 已具备扫描与渲染能力，但还没有推送方（Task 13 的 `translationSync`）；没有推送时 `receiveEnabled` 取默认值 `true`，翻译照常工作。

- [ ] **Step 7: 桌面端冒烟（不需要登录）**

沿用 Task 5 Step 6 的自测视图：`pnpm dev` 起客户端，在主窗口 Console 里对内嵌的本地页面执行

```js
await window.scrm.view.executeJS('selftest', 'JSON.stringify({ injector: !!window.__SCRM_INJECTOR__, style: !!document.getElementById("scrm-inject-style") })')
```

预期：`{"injector":true,"style":true}` —— 证明翻译模块挂载了、样式写入了、且在没有 WhatsApp DOM 的页面上不抛错（`getMessageContainer()` 返回 null → 只有兜底 interval 在跑）。收尾 `await window.scrm.view.destroy('selftest')`。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/inject
git commit -m "feat(P5b): WhatsApp 气泡译文自动渲染与重试上限"
```

---

### Task 9: 输入框发送前预览

**Files:**
- Create: `apps/desktop/src/inject/core/translation/inputPreview.ts`
- Modify: `apps/desktop/src/inject/platforms/whatsapp/index.ts`

**Interfaces:**
- Consumes: `requestTranslate`、`BaseInjector.adapter.getInputElement()` / `getInputText()` / `setInputText()`、`StateManager.sendLangSetting` / `previewEnabled` / `disableChinese` / `disableChinesePreventSend`、`CSS_CLASSES`。
- Produces: `mountInputPreview(injector: BaseInjector): () => void`

- [ ] **Step 1: inputPreview.ts**

```ts
import { CSS_CLASSES, TRANSLATE_THROTTLE_TIME } from '../../constants/config'
import type { BaseInjector } from '../BaseInjector'
import { requestTranslate, type TranslateResponse } from './translationQueue'

const PREVIEW_ID = 'scrm-inject-preview'

/**
 * Send-direction preview (R1: the only place the `send` language direction is used).
 * The request goes out with `input: true`, so the backend never writes half-typed text
 * into the translation cache.
 */
export function mountInputPreview(injector: BaseInjector): () => void {
  const { adapter, state } = injector
  let layer: HTMLElement | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let lastText = ''
  let stopped = false

  function ensureLayer(): HTMLElement {
    const found = document.getElementById(PREVIEW_ID)
    if (found) return found
    const created = document.createElement('div')
    created.id = PREVIEW_ID
    created.className = CSS_CLASSES.TRANSLATED
    created.style.position = 'fixed'
    created.style.zIndex = '2147483000'
    created.style.maxWidth = '360px'
    created.style.background = 'rgba(11, 23, 51, 0.92)'
    created.style.color = '#fff'
    created.style.padding = '6px 10px'
    created.style.borderRadius = '10px'
    document.body.appendChild(created)
    return created
  }

  function place(input: HTMLElement): void {
    if (!layer) return
    const rect = input.getBoundingClientRect()
    layer.style.left = `${Math.max(8, rect.left)}px`
    layer.style.top = `${Math.max(8, rect.top - 12)}px`
    layer.style.transform = 'translateY(-100%)'
  }

  function hide(): void {
    if (layer) layer.style.display = 'none'
    lastText = ''
  }

  function paint(result: TranslateResponse): void {
    if (!layer || stopped) return
    layer.style.display = 'block'
    layer.textContent = ''

    const text = document.createElement('span')
    text.className = 'translated-text'
    text.textContent = result.translation
    layer.appendChild(text)

    if (state.disableChinese && result.containsChinese) {
      const hint = document.createElement('div')
      hint.className = CSS_CLASSES.TRANSLATE_ERROR
      hint.textContent = '译文含中文，可能被拦截'
      layer.appendChild(hint)
    }

    const use = document.createElement('span')
    use.className = CSS_CLASSES.MASK
    use.textContent = '用译文替换输入框'
    use.tabIndex = 0
    use.addEventListener('click', () => void adapter.setInputText(result.translation))
    layer.appendChild(use)
  }

  const onInput = (): void => {
    if (!state.sendLangSetting.enabled || !state.previewEnabled) {
      hide()
      return
    }
    const input = adapter.getInputElement()
    const text = input ? adapter.getInputText() : ''
    if (!text || text === lastText) {
      if (!text) hide()
      return
    }
    lastText = text
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(async () => {
      const target = adapter.getInputElement()
      if (!target) return
      layer = ensureLayer()
      place(target)
      const result = await requestTranslate(injector, { text, type: 'send', input: true })
      if (result) paint(result)
      else hide()
    }, TRANSLATE_THROTTLE_TIME)
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || e.shiftKey) return
    const input = adapter.getInputElement()
    const text = input ? adapter.getInputText() : ''
    if (!input || !text) return

    if (state.disableChinese && state.disableChinesePreventSend) {
      // The preview already tells us; block before WhatsApp sees the Enter.
      if (/[\u4e00-\u9fa5]/.test(text)) {
        e.preventDefault()
        e.stopPropagation()
        layer = ensureLayer()
        place(input)
        layer.style.display = 'block'
        layer.textContent = '消息含中文，已拦截发送'
        return
      }
    }
    if (!state.sendLangSetting.enabled || !state.enterToSend) return

    e.preventDefault()
    e.stopPropagation()
    void (async () => {
      const result = await requestTranslate(injector, { text, type: 'send' })
      if (!result) return
      await adapter.setInputText(result.translation)
      adapter
        .getInputElement()
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
        )
    })()
  }

  const root = document.body
  root.addEventListener('input', onInput, true)
  root.addEventListener('keydown', onKeydown, true)

  return () => {
    stopped = true
    if (debounce) clearTimeout(debounce)
    root.removeEventListener('input', onInput, true)
    root.removeEventListener('keydown', onKeydown, true)
    document.getElementById(PREVIEW_ID)?.remove()
  }
}
```

`enter_to_send` 默认关：按 Enter 走 WhatsApp 原生发送，只有用户在翻译中心打开它，才会先译再发。

- [ ] **Step 2: StateManager 补 enterToSend**

`core/StateManager.ts`：`TranslationFlags`（`types.ts`）加 `enterToSend: boolean`；`StateManager` 字段区加 `enterToSend = false`；`updateTranslationFlags` 里加

```ts
    if (typeof flags.enterToSend === 'boolean') this.enterToSend = flags.enterToSend
```

`reset()` 不需要清它（跟随设置推送）。

- [ ] **Step 3: WhatsApp 挂载预览**

`platforms/whatsapp/index.ts`：import `mountInputPreview`，并把 Step 5（Task 8）写的覆盖改成组合两个 disposer：

```ts
  override setupTranslationListeners(injector: BaseInjector): () => void {
    const stopScan = startMessageTranslation(injector)
    const stopPreview = mountInputPreview(injector)
    return () => {
      stopPreview()
      stopScan()
    }
  }
```

- [ ] **Step 4: typecheck + build + 提交**

```bash
cd apps/desktop && pnpm typecheck && pnpm build:inject
git add apps/desktop/src/inject
git commit -m "feat(P5b): 输入框发送前译文预览"
```

预期：`pnpm typecheck` 三份配置全绿，`pnpm build:inject` 成功。

P5b 完成判据：`pnpm typecheck` + `pnpm build:inject` 绿、Task 5 Step 6 的自测视图端到端拿到译文、§6.3 前 5 项由用户在真实 WhatsApp 会话里勾验（**没跑完不得声称渲染已验证**）。

---

## P5c — 渲染层翻译中心

### Task 10: 语言清单与自动选优

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/langData.ts`
- Create: `apps/desktop/src/renderer/src/lib/nodeSelect.ts`

**Interfaces:**
- Consumes: 无（纯静态数据 + 纯函数）。
- Produces:
  - `interface Language { code: string; zh: string; en: string }`
  - `allLanguages: Language[]`、`deeplSourceLanguages: Language[]`、`deeplTargetLanguages: Language[]`、`chatGptLanguages: Language[]`
  - `TRANSLATION_CHANNELS: { code: string; label: string }[]`
  - `sourceLanguagesFor(channel: string): Language[]`、`targetLanguagesFor(channel: string): Language[]`
  - `languageName(code: string): string`、`ENGINE_LANGUAGES: string[]`
  - `isNodeCompatible(name: string, channel: string): boolean`
  - `pickBestNode(delays: NodeDelay[], currentServer: string, channel: string): PickResult`，`interface NodeDelay { name: string; delay: number | null }`、`interface PickResult { server: string; skipped: { name: string; reason: string }[] }`

- [ ] **Step 1: langData.ts**

```ts
export interface Language {
  code: string
  zh: string
  en: string
}

const L = (code: string, zh: string, en: string): Language => ({ code, zh, en })

/** Full candidate list; shared by the Google and Gemini channels. */
export const allLanguages: Language[] = [
  L('af', '南非荷兰语', 'Afrikaans'), L('sq', '阿尔巴尼亚语', 'Albanian'), L('am', '阿姆哈拉语', 'Amharic'),
  L('ar', '阿拉伯语', 'Arabic'), L('hy', '亚美尼亚语', 'Armenian'), L('az', '阿塞拜疆语', 'Azerbaijani'),
  L('eu', '巴斯克语', 'Basque'), L('be', '白俄罗斯语', 'Belarusian'), L('bn', '孟加拉语', 'Bengali'),
  L('bs', '波斯尼亚语', 'Bosnian'), L('bg', '保加利亚语', 'Bulgarian'), L('ca', '加泰罗尼亚语', 'Catalan'),
  L('ceb', '宿务语', 'Cebuano'), L('zh-CN', '简体中文', 'Chinese (Simplified)'), L('zh-TW', '繁体中文', 'Chinese (Traditional)'),
  L('co', '科西嘉语', 'Corsican'), L('hr', '克罗地亚语', 'Croatian'), L('cs', '捷克语', 'Czech'),
  L('da', '丹麦语', 'Danish'), L('nl', '荷兰语', 'Dutch'), L('en', '英语', 'English'),
  L('eo', '世界语', 'Esperanto'), L('et', '爱沙尼亚语', 'Estonian'), L('tl', '菲律宾语', 'Filipino'),
  L('fi', '芬兰语', 'Finnish'), L('fr', '法语', 'French'), L('fy', '弗里斯兰语', 'Frisian'),
  L('gl', '加利西亚语', 'Galician'), L('ka', '格鲁吉亚语', 'Georgian'), L('de', '德语', 'German'),
  L('el', '希腊语', 'Greek'), L('gu', '古吉拉特语', 'Gujarati'), L('ht', '海地克里奥尔语', 'Haitian Creole'),
  L('ha', '豪萨语', 'Hausa'), L('haw', '夏威夷语', 'Hawaiian'), L('he', '希伯来语', 'Hebrew'),
  L('hi', '印地语', 'Hindi'), L('hmn', '苗语', 'Hmong'), L('hu', '匈牙利语', 'Hungarian'),
  L('is', '冰岛语', 'Icelandic'), L('ig', '伊博语', 'Igbo'), L('id', '印尼语', 'Indonesian'),
  L('ga', '爱尔兰语', 'Irish'), L('it', '意大利语', 'Italian'), L('ja', '日语', 'Japanese'),
  L('jv', '爪哇语', 'Javanese'), L('kn', '卡纳达语', 'Kannada'), L('kk', '哈萨克语', 'Kazakh'),
  L('km', '高棉语', 'Khmer'), L('rw', '卢旺达语', 'Kinyarwanda'), L('ko', '韩语', 'Korean'),
  L('ku', '库尔德语', 'Kurdish'), L('ky', '吉尔吉斯语', 'Kyrgyz'), L('lo', '老挝语', 'Lao'),
  L('la', '拉丁语', 'Latin'), L('lv', '拉脱维亚语', 'Latvian'), L('lt', '立陶宛语', 'Lithuanian'),
  L('lb', '卢森堡语', 'Luxembourgish'), L('mk', '马其顿语', 'Macedonian'), L('mg', '马达加斯加语', 'Malagasy'),
  L('ms', '马来语', 'Malay'), L('ml', '马拉雅拉姆语', 'Malayalam'), L('mt', '马耳他语', 'Maltese'),
  L('mi', '毛利语', 'Maori'), L('mr', '马拉地语', 'Marathi'), L('mn', '蒙古语', 'Mongolian'),
  L('my', '缅甸语', 'Burmese'), L('ne', '尼泊尔语', 'Nepali'), L('nb', '挪威语', 'Norwegian'),
  L('or', '奥里亚语', 'Odia'), L('ps', '普什图语', 'Pashto'), L('fa', '波斯语', 'Persian'),
  L('pl', '波兰语', 'Polish'), L('pt', '葡萄牙语', 'Portuguese'), L('pa', '旁遮普语', 'Punjabi'),
  L('ro', '罗马尼亚语', 'Romanian'), L('ru', '俄语', 'Russian'), L('sm', '萨摩亚语', 'Samoan'),
  L('gd', '苏格兰盖尔语', 'Scots Gaelic'), L('sr', '塞尔维亚语', 'Serbian'), L('st', '塞索托语', 'Sesotho'),
  L('sn', '绍纳语', 'Shona'), L('sd', '信德语', 'Sindhi'), L('si', '僧伽罗语', 'Sinhala'),
  L('sk', '斯洛伐克语', 'Slovak'), L('sl', '斯洛文尼亚语', 'Slovenian'), L('so', '索马里语', 'Somali'),
  L('es', '西班牙语', 'Spanish'), L('su', '巽他语', 'Sundanese'), L('sw', '斯瓦希里语', 'Swahili'),
  L('sv', '瑞典语', 'Swedish'), L('tg', '塔吉克语', 'Tajik'), L('ta', '泰米尔语', 'Tamil'),
  L('tt', '鞑靼语', 'Tatar'), L('te', '泰卢固语', 'Telugu'), L('th', '泰语', 'Thai'),
  L('tr', '土耳其语', 'Turkish'), L('tk', '土库曼语', 'Turkmen'), L('uk', '乌克兰语', 'Ukrainian'),
  L('ur', '乌尔都语', 'Urdu'), L('ug', '维吾尔语', 'Uyghur'), L('uz', '乌兹别克语', 'Uzbek'),
  L('vi', '越南语', 'Vietnamese'), L('cy', '威尔士语', 'Welsh'), L('xh', '科萨语', 'Xhosa'),
  L('yi', '意第绪语', 'Yiddish'), L('yo', '约鲁巴语', 'Yoruba'), L('zu', '祖鲁语', 'Zulu')
]

const byCode = new Map(allLanguages.map((lang) => [lang.code, lang]))

function pick(codes: string[]): Language[] {
  return codes.map((code) => byCode.get(code)).filter((lang): lang is Language => !!lang)
}

/** R4: DeepL offers different source and target sets — `pt`/`nb` in, `pt-BR`/`ar`/`he`/`ms` out. */
export const deeplSourceLanguages: Language[] = pick([
  'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hu', 'id', 'it', 'ja', 'ko',
  'lt', 'lv', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'zh-CN'
])

export const deeplTargetLanguages: Language[] = pick([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hu', 'id', 'it',
  'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr',
  'uk', 'zh-CN'
])

export const chatGptLanguages: Language[] = pick([
  'ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'pl', 'pt', 'ru',
  'th', 'tr', 'uk', 'ur', 'vi', 'zh-CN', 'zh-TW'
])

/** The eight languages the simulated engine can actually produce (spec §3.4 step 2). */
export const ENGINE_LANGUAGES = ['zh-CN', 'en', 'vi', 'id', 'lo', 'hi', 'my', 'ms']

export const TRANSLATION_CHANNELS = [
  { code: '1', label: 'Google' },
  { code: '2', label: 'DeepL' },
  { code: '3', label: 'ChatGPT' },
  { code: '4', label: 'Gemini' }
]

export function sourceLanguagesFor(channel: string): Language[] {
  if (channel === '2') return deeplSourceLanguages
  if (channel === '3') return chatGptLanguages
  return allLanguages
}

export function targetLanguagesFor(channel: string): Language[] {
  if (channel === '2') return deeplTargetLanguages
  if (channel === '3') return chatGptLanguages
  return allLanguages
}

export function languageName(code: string): string {
  if (!code) return '自动检测'
  const lang = byCode.get(code)
  return lang ? `${lang.zh}（${lang.code}）` : code
}
```

- [ ] **Step 2: nodeSelect.ts**

桌面端没有 vitest / jest，本任务不引入（新增测试框架属独立决策）。`pickBestNode` 的正确性由 TypeScript 严格模式 + Task 11 Step 4 的控制台断言覆盖。**不要为了这一步临时装测试框架。**

```ts
/** 与 api/translation 的 ServerDelayVO 结构一致；这里自带形状，本任务因此不依赖那个模块。 */
export interface NodeDelay {
  name: string
  delay: number | null
}

export interface PickResult {
  server: string
  skipped: { name: string; reason: string }[]
}

/** R5: `hk` only serves the Google line. */
export function isNodeCompatible(name: string, channel: string): boolean {
  return name !== 'hk' || channel === '1'
}

/**
 * R6: candidates are nodes with a finite delay that are compatible with the channel;
 * the smallest wins, and a current node that is already smallest stays put (hysteresis).
 */
export function pickBestNode(delays: NodeDelay[], currentServer: string, channel: string): PickResult {
  const skipped: { name: string; reason: string }[] = []
  const candidates: { name: string; delay: number }[] = []

  for (const node of delays) {
    if (node.delay === null) {
      skipped.push({ name: node.name, reason: '不可达' })
      continue
    }
    if (!isNodeCompatible(node.name, channel)) {
      skipped.push({ name: node.name, reason: '仅支持 Google 线路' })
      continue
    }
    candidates.push({ name: node.name, delay: node.delay })
  }

  if (candidates.length === 0) {
    return { server: currentServer || 'sg', skipped }
  }
  const best = candidates.reduce((min, node) => (node.delay < min.delay ? node : min))
  const current = candidates.find((node) => node.name === currentServer)
  if (current && current.delay <= best.delay) {
    return { server: current.name, skipped }
  }
  return { server: best.name, skipped }
}
```

- [ ] **Step 3: typecheck**

```bash
cd apps/desktop && pnpm typecheck:web
```

预期：无错误。

- [ ] **Step 4: 暂存，等 Task 11 一起提交**

本任务与 Task 11 合成一次提交（命令见 Task 11 Step 3）。

---

### Task 11: 翻译中心数据层与开关组件

**Files:**
- Create: `apps/desktop/src/renderer/src/api/translation.ts`
- Create: `apps/desktop/src/renderer/src/components/ui/switch.tsx`

**Interfaces:**
- Consumes: `http`（`@/lib/http`）、`radix-ui` 伞形包（已在依赖里）。
- Produces（Task 12 / 13 按此对齐）:
  - `type TranslateType = 'receive' | 'send'`
  - `interface TranslationSettingVO`（与后端 VO 字段一一对应，camelCase）
  - `interface TranslationNodeVO { id: number; name: string; label: string; url: string; baseDelayMs: number; reachable: boolean }`
  - `interface ServerDelayVO { name: string; delay: number | null }`
  - `interface TranslateVO { translation: string; cached: boolean; partial: boolean; containsChinese: boolean; type: string; channel: string; fromLangCode: string; toLangCode: string; cacheKey: string }`
  - `interface TranslationCacheStatsVO { totalKeys: number; totalHits: number; top: { cacheKey: string; sourceText: string; targetText: string; hitCount: number; partial: boolean }[] }`
  - `useTranslationSettings()`、`useUpdateTranslationSettings()`、`useTranslationNodes()`、`useTranslationDelays(enabled: boolean)`、`useTranslationCacheStats()`、`useTrialTranslate()`
  - `Switch`（`components/ui/switch.tsx`）

- [ ] **Step 1: api/translation.ts**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'

export type TranslateType = 'receive' | 'send'

export interface TranslationSettingVO {
  id: number
  server: string
  serverMode: 'auto' | 'manual' | string
  channel: string
  receiveEnabled: boolean
  receiveFromLang: string
  receiveToLang: string
  sendEnabled: boolean
  sendFromLang: string
  sendToLang: string
  voiceEnabled: boolean
  previewEnabled: boolean
  enterToSend: boolean
  disableChinese: boolean
  disableChinesePreventSend: boolean
}

export interface TranslationSettingInput {
  server?: string
  serverMode?: string
  channel?: string
  receiveEnabled?: boolean
  receiveFromLang?: string
  receiveToLang: string
  sendEnabled?: boolean
  sendFromLang?: string
  sendToLang: string
  voiceEnabled?: boolean
  previewEnabled?: boolean
  enterToSend?: boolean
  disableChinese?: boolean
  disableChinesePreventSend?: boolean
}

export interface TranslationNodeVO {
  id: number
  name: string
  label: string
  url: string
  baseDelayMs: number
  reachable: boolean
}

export interface ServerDelayVO {
  name: string
  delay: number | null
}

export interface TranslateVO {
  translation: string
  cached: boolean
  partial: boolean
  containsChinese: boolean
  type: string
  channel: string
  fromLangCode: string
  toLangCode: string
  cacheKey: string
}

export interface TranslationCacheEntryVO {
  cacheKey: string
  sourceText: string
  targetText: string
  hitCount: number
  partial: boolean
}

export interface TranslationCacheStatsVO {
  totalKeys: number
  totalHits: number
  top: TranslationCacheEntryVO[]
}

const SETTINGS_KEY = ['translation-settings'] as const
const NODES_KEY = ['translation-nodes'] as const
const DELAYS_KEY = ['translation-delays'] as const
const STATS_KEY = ['translation-cache-stats'] as const

export function useTranslationSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => http.get<TranslationSettingVO>('/api/translation/settings')
  })
}

export function useTranslationNodes() {
  return useQuery({
    queryKey: NODES_KEY,
    queryFn: () => http.get<TranslationNodeVO[]>('/api/translation/nodes'),
    staleTime: 60_000
  })
}

/** Measuring is on-demand only (no polling): entering the page, "重新测速", after a save. */
export function useTranslationDelays(enabled: boolean) {
  return useQuery({
    queryKey: DELAYS_KEY,
    queryFn: () => http.get<ServerDelayVO[]>('/api/translation/nodes/delays'),
    enabled
  })
}

export function useTranslationCacheStats() {
  return useQuery({
    queryKey: STATS_KEY,
    queryFn: () => http.get<TranslationCacheStatsVO>('/api/translation/cache/stats')
  })
}

export function useUpdateTranslationSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TranslationSettingInput) =>
      http.put<TranslationSettingVO>('/api/translation/settings', input),
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data)
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    }
  })
}

export function useTrialTranslate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { text: string; type: TranslateType }) =>
      http.post<TranslateVO>('/api/translation/translate', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: STATS_KEY })
  })
}
```

- [ ] **Step 2: components/ui/switch.tsx**

按现有 `select.tsx` 的写法（`radix-ui` 伞形包 + `data-slot` + `cn`）：

```tsx
import * as React from 'react'
import { cn } from 'cn'
import { Switch as SwitchPrimitive } from 'radix-ui'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5'
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
```

- [ ] **Step 3: typecheck + 提交（Task 10 + 11 一起）**

```bash
cd apps/desktop && pnpm typecheck:web
git add apps/desktop/src/renderer/src/lib/langData.ts apps/desktop/src/renderer/src/lib/nodeSelect.ts \
        apps/desktop/src/renderer/src/api/translation.ts apps/desktop/src/renderer/src/components/ui/switch.tsx
git commit -m "feat(P5c): 翻译中心数据层、语言清单与开关组件"
```

预期：`typecheck:web` 无错误（Task 10 Step 4 的模块缺失报错此时消失）。

- [ ] **Step 4: 控制台核对自动选优（替代单测）**

`pnpm dev` 起客户端，登录后进 `#/translation`（Task 12 完成前这一页还不存在，所以改在 Console 里现推一遍逻辑）：

```js
// 与 nodeSelect.ts 同规则的手工核对，三条断言都要为 true
const delays = [
  { name: 'sg', delay: 22 }, { name: 'my', delay: 47 }, { name: 'my2', delay: null },
  { name: 'id', delay: 73 }, { name: 'hk', delay: 91 }, { name: 'uk', delay: 133 }, { name: 'us', delay: 182 }
]
```

三条期望结论（Task 12 之后在页面上看，不在此处执行代码）：
1. `channel='1'`、`currentServer='us'` → 选中 `sg`，`skipped` 只含 `my2 不可达`。
2. `channel='2'`、`currentServer='sg'` → `hk` 出现在 `skipped` 且 reason 为 `仅支持 Google 线路`。
3. `channel='1'`、`currentServer='sg'` → 结果仍是 `sg`（滞回，R6），即使 `sg` 本身就是最小值。

---

### Task 12: 翻译中心页面

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/TranslationPage.tsx`

**Interfaces:**
- Consumes: Task 10 的 `langData` / `nodeSelect`、Task 11 的 hooks 与 `Switch`、既有 `Card*` / `Button` / `Badge` / `Input` / `Label` / `Select*` 组件、`broadcastTranslationFlags`（Task 13 提供；本任务先按签名 import）。
- Produces: `export default function TranslationPage(): React.JSX.Element`；页面在 `#/translation` 下渲染四张设置卡 + 节点测速 + 缓存统计 + 翻译试用。

- [ ] **Step 1: 页面骨架与两张右栏卡片**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Activity, Coins, Database, Languages, RotateCw, Send, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  useTranslationCacheStats, useTranslationDelays, useTranslationNodes,
  useTranslationSettings, useTrialTranslate, useUpdateTranslationSettings,
  type ServerDelayVO, type TranslateType, type TranslationSettingVO
} from '@/api/translation'
import { ENGINE_LANGUAGES, TRANSLATION_CHANNELS, languageName, sourceLanguagesFor, targetLanguagesFor } from '@/lib/langData'
import { isNodeCompatible, pickBestNode } from '@/lib/nodeSelect'
import { broadcastTranslationFlags } from '@/lib/translationSync'
import { cn } from '@/lib/utils'

const AUTO = 'auto'

function delayTone(delay: number | null): string {
  if (delay === null) return 'bg-muted text-muted-foreground'
  if (delay < 60) return 'bg-emerald-500/15 text-emerald-600'
  if (delay < 120) return 'bg-amber-500/15 text-amber-600'
  return 'bg-red-500/15 text-red-600'
}

function delayText(delay: number | null): string {
  return delay === null ? '不可达' : `${delay} ms`
}
```

页面主体（同文件继续往下写）：

```tsx
export default function TranslationPage(): React.JSX.Element {
  const settingsQuery = useTranslationSettings()
  const nodesQuery = useTranslationNodes()
  const statsQuery = useTranslationCacheStats()
  const updateSettings = useUpdateTranslationSettings()
  const [measureOn, setMeasureOn] = useState(true)
  const delaysQuery = useTranslationDelays(measureOn)
  const [draft, setDraft] = useState<TranslationSettingVO | null>(null)

  useEffect(() => {
    if (settingsQuery.data && !draft) setDraft(settingsQuery.data)
  }, [settingsQuery.data, draft])

  const settings = draft ?? settingsQuery.data ?? null
  const delays = delaysQuery.data ?? []
  const nodes = nodesQuery.data ?? []

  const choice = useMemo(
    () => (settings ? pickBestNode(delays, settings.server, settings.channel) : null),
    [delays, settings]
  )

  /** 测速只在进页、手动、保存后各来一次；关掉再打开 query 就是重新取一次，不做轮询。 */
  function remeasure(): void {
    setMeasureOn(false)
    setTimeout(() => setMeasureOn(true), 0)
  }

  async function patch(next: Partial<TranslationSettingVO>): Promise<void> {
    if (!settings) return
    const merged = { ...settings, ...next }
    setDraft(merged)
    // 自动模式下换线路，要用「新线路」重算推荐；本帧的 choice 还是旧线路的，用了就选错节点
    if (merged.serverMode === AUTO && next.channel !== undefined) {
      merged.server = pickBestNode(delays, settings.server, merged.channel).server
    }
    const saved = await updateSettings.mutateAsync(toInput(merged))
    setDraft(saved)
    await broadcastTranslationFlags(saved)
    remeasure()
  }

  if (!settings) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <PageHeader />
        <p className="py-16 text-center text-sm text-muted-foreground">
          {settingsQuery.isPending ? '加载翻译设置中…' : '翻译设置读取失败，请确认后端已启动。'}
        </p>
      </div>
    )
  }

  const nodeLabel = (name: string): string => nodes.find((n) => n.name === name)?.label ?? name

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <PageHeader />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <NodeCard settings={settings} delays={delays} nodes={nodes} choice={choice}
            onReselect={async (server) => patch({ server, serverMode: server === AUTO ? AUTO : 'manual' })}
            onChannel={(channel) => patch({ channel })}
            onAuto={async () => {
              const best = pickBestNode(delays, settings.server, settings.channel)
              await patch({ server: best.server, serverMode: AUTO })
            }} />
          <DirectionCard title="接收翻译" description="会话气泡下的译文（含自己发出的消息，R1）"
            enabled={settings.receiveEnabled} onToggle={(v) => patch({ receiveEnabled: v })}
            from={settings.receiveFromLang} to={settings.receiveToLang} channel={settings.channel}
            onFrom={(v) => patch({ receiveFromLang: v })} onTo={(v) => patch({ receiveToLang: v })}
            extra={<ToggleRow label="语音翻译" hint="本期不生效" checked={settings.voiceEnabled}
              onChange={(v) => patch({ voiceEnabled: v })} />} />
          <DirectionCard title="发送翻译" description="输入框的发送前预览语向"
            enabled={settings.sendEnabled} onToggle={(v) => patch({ sendEnabled: v })}
            from={settings.sendFromLang} to={settings.sendToLang} channel={settings.channel}
            onFrom={(v) => patch({ sendFromLang: v })} onTo={(v) => patch({ sendToLang: v })}
            extra={<>
              <ToggleRow label="实时预览" checked={settings.previewEnabled} onChange={(v) => patch({ previewEnabled: v })} />
              <ToggleRow label="回车即译即发" checked={settings.enterToSend} onChange={(v) => patch({ enterToSend: v })} />
            </>} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm"><ShieldIcon />风控</CardTitle>
              <CardDescription>注入层按推送的开关提示或拦截</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ToggleRow label="提示译文含中文" checked={settings.disableChinese} onChange={(v) => patch({ disableChinese: v })} />
              <ToggleRow label="含中文时拦截发送" hint="开启后若消息含中文将拦截发送并提示"
                checked={settings.disableChinesePreventSend} onChange={(v) => patch({ disableChinesePreventSend: v })} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm"><Zap className="size-4 text-gold" />节点测速</CardTitle>
                <CardDescription>模拟延迟，不产生任何网络请求</CardDescription>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={remeasure}>
                <RotateCw className="size-3.5" />重新测速
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {delays.map((node) => {
                const active = settings.server === node.name || (settings.serverMode === AUTO && choice?.server === node.name)
                const reason = choice?.skipped.find((s) => s.name === node.name)?.reason
                return (
                  <div key={node.name}
                    className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs',
                      active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground')}>
                    <span className="w-8 font-semibold text-foreground">{node.name}</span>
                    <span className="flex-1 truncate">{nodeLabel(node.name)}</span>
                    {reason && <span className="text-[11px] text-muted-foreground/80">{reason}</span>}
                    <Badge variant="outline" className={cn('border-0', delayTone(node.delay))}>{delayText(node.delay)}</Badge>
                  </div>
                )
              })}
              {settings.serverMode === AUTO && choice && (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  自动选优结果：<span className="font-semibold text-primary">{choice.server}</span>
                  （当前 <span className="font-semibold">{settings.server}</span> 已是最小时保持不变）
                </p>
              )}
            </CardContent>
          </Card>

          <CacheStatsCard stats={statsQuery.data ?? null} loading={statsQuery.isPending} />
          <TrialCard />
        </div>
      </div>
    </div>
  )
}

function ShieldIcon(): React.JSX.Element {
  return <Shield className="size-4 text-primary" />
}
```

补 import：`Shield` 也来自 lucide-react（把 `Shield` 加到第一行 lucide 的 import 里）；`PageHeader`、`ToggleRow`、`LangSelect`、`NodeCard`、`DirectionCard`、`toInput` 在下面的 Step 2 里定义，`CacheStatsCard`、`TrialCard` 在 Step 3 里定义（`delayTone`、`delayText` 已在 Step 1 写过）。

- [ ] **Step 2: 左栏组件**

```tsx
function PageHeader(): React.JSX.Element {
  return (
    <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Languages className="size-5 text-primary" />
          翻译中心
        </h1>
        <p className="text-xs text-muted-foreground">语向、渠道与生效节点由后端按账号设置解析，页面只做配置</p>
      </div>
      <Badge variant="outline" className="gap-1.5">
        <Activity className="size-3" />
        模拟通道
      </Badge>
    </header>
  )
}

function ToggleRow({ label, hint, checked, disabled, onChange }: {
  label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-xs font-medium text-foreground">{label}</Label>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
    </div>
  )
}

/** radix 的 SelectItem 不接受空串 value，用 `auto` 作哨兵并在边界换回 `''`。 */
const AUTO_SOURCE = 'auto'

function LangSelect({ value, options, allowAuto, onChange }: {
  value: string; options: { code: string; zh: string }[]; allowAuto?: boolean; onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <Select
      value={allowAuto && value === '' ? AUTO_SOURCE : value}
      onValueChange={(v) => onChange(v === AUTO_SOURCE ? '' : v)}
    >
      <SelectTrigger className="h-8 w-full text-xs">
        <SelectValue placeholder="自动检测" />
      </SelectTrigger>
      <SelectContent>
        {allowAuto && <SelectItem value={AUTO_SOURCE}>自动检测</SelectItem>}
        {options.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>{languageName(lang.code)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function NodeCard({ settings, delays, nodes, choice, onReselect, onChannel, onAuto }: {
  settings: TranslationSettingVO; delays: ServerDelayVO[]; nodes: { name: string; label: string }[]
  choice: { server: string } | null; onReselect: (server: string) => void
  onChannel: (channel: string) => void; onAuto: () => void
}): React.JSX.Element {
  const delayOf = (name: string): number | null => delays.find((d) => d.name === name)?.delay ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Database className="size-4 text-primary" />节点与线路</CardTitle>
        <CardDescription>节点只影响测速与自动选优，译文一律由本地引擎生成</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">生效节点</span>
          <Badge variant="outline" className="border-0 bg-primary/10 text-primary">
            {settings.serverMode === 'auto' ? `auto · ${choice?.server ?? settings.server}` : settings.server}
          </Badge>
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={onAuto}>按测速重选</Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {nodes.map((node) => {
            const delay = delayOf(node.name)
            const incompatible = !isNodeCompatible(node.name, settings.channel)
            return (
              <button key={node.name} type="button" disabled={delay === null || incompatible}
                onClick={() => onReselect(node.name)}
                className={cn('rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  settings.server === node.name ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                  (delay === null || incompatible) && 'cursor-not-allowed opacity-40')}>
                {node.name} · {delay === null ? '不可达' : `${delay}ms`}
                {incompatible && ' · 仅 Google'}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">线路</span>
          <div className="flex flex-wrap gap-1.5">
            {TRANSLATION_CHANNELS.map((channel) => (
              <button key={channel.code} type="button" onClick={() => onChannel(channel.code)}
                className={cn('rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  settings.channel === channel.code ? 'border-gold bg-gold/15 text-foreground' : 'border-border text-muted-foreground')}>
                {channel.code} {channel.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DirectionCard({ title, description, enabled, onToggle, from, to, channel, onFrom, onTo, extra }: {
  title: string; description: string; enabled: boolean; onToggle: (v: boolean) => void
  from: string; to: string; channel: string
  onFrom: (v: string) => void; onTo: (v: string) => void; extra?: React.ReactNode
}): React.JSX.Element {
  const sources = sourceLanguagesFor(channel)
  const targets = targetLanguagesFor(channel)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ToggleRow label="启用" checked={enabled} onChange={onToggle} />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">源语言</Label>
            <LangSelect value={from} allowAuto options={sources} onChange={onFrom} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">目标语言</Label>
            <LangSelect value={to} options={targets} onChange={onTo} />
          </div>
        </div>
        {!ENGINE_LANGUAGES.includes(to) && (
          <p className="text-[11px] text-amber-600">该语向超出模拟词典范围，译文会按原文返回并标 partial。</p>
        )}
        {extra}
      </CardContent>
    </Card>
  )
}

function toInput(s: TranslationSettingVO) {
  return {
    server: s.server, serverMode: s.serverMode, channel: s.channel,
    receiveEnabled: s.receiveEnabled, receiveFromLang: s.receiveFromLang, receiveToLang: s.receiveToLang,
    sendEnabled: s.sendEnabled, sendFromLang: s.sendFromLang, sendToLang: s.sendToLang,
    voiceEnabled: s.voiceEnabled, previewEnabled: s.previewEnabled, enterToSend: s.enterToSend,
    disableChinese: s.disableChinese, disableChinesePreventSend: s.disableChinesePreventSend
  }
}
```

- [ ] **Step 3: 右栏两张卡**

```tsx
function CacheStatsCard({ stats, loading }: {
  stats: { totalKeys: number; totalHits: number; top: { cacheKey: string; sourceText: string; targetText: string; hitCount: number; partial: boolean }[] } | null
  loading: boolean
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Coins className="size-4 text-gold" />译文缓存</CardTitle>
        <CardDescription>按租户隔离，键形如 type-channel-from-to-hash</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading || !stats ? (
          <p className="py-4 text-center text-xs text-muted-foreground">读取中…</p>
        ) : (
          <>
            <div className="flex gap-3 text-xs">
              <span className="rounded-lg bg-muted px-2 py-1">键数 <b className="text-foreground">{stats.totalKeys}</b></span>
              <span className="rounded-lg bg-muted px-2 py-1">总命中 <b className="text-foreground">{stats.totalHits}</b></span>
            </div>
            {stats.top.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">还没有缓存条目。</p>}
            {stats.top.map((entry) => (
              <div key={entry.cacheKey} className="rounded-lg border border-border/60 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-foreground">{entry.sourceText}</span>
                  <Badge variant="outline" className="shrink-0 border-0 bg-primary/10 text-primary">
                    {entry.hitCount} 次
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{entry.targetText}</p>
                <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground/70">
                  {entry.cacheKey}
                  {entry.partial && <span className="text-amber-600">partial</span>}
                </p>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TrialCard(): React.JSX.Element {
  const trial = useTrialTranslate()
  const [text, setText] = useState('你好，订单已发货')
  const [type, setType] = useState<TranslateType>('receive')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Send className="size-4 text-primary" />翻译试用</CardTitle>
        <CardDescription>不登录 WhatsApp 也能验证引擎与缓存；走的是当前设置解析出的语向</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="输入要翻译的文本" className="h-8 text-xs" />
        <div className="flex items-center gap-2">
          {(['receive', 'send'] as TranslateType[]).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={cn('rounded-full border px-2.5 py-1 text-[11px]',
                type === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>
              {t === 'receive' ? '接收语向' : '发送语向'}
            </button>
          ))}
          <Button size="sm" className="ml-auto gap-1.5" disabled={!text.trim() || trial.isPending}
            onClick={() => trial.mutate({ text: text.trim(), type })}>
            <Send className="size-3.5" />翻译
          </Button>
        </div>
        {trial.data && (
          <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs">
            <p className="text-foreground">{trial.data.translation}</p>
            <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              <span>{trial.data.cached ? '命中缓存' : '新生成'}</span>
              {trial.data.partial && <span className="text-amber-600">partial</span>}
              {trial.data.containsChinese && <span className="text-amber-600">含中文</span>}
              <span>{trial.data.fromLangCode || 'auto'} → {trial.data.toLangCode}</span>
              <span>渠道 {trial.data.channel}</span>
            </p>
            <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/70">{trial.data.cacheKey}</p>
          </div>
        )}
        {trial.isError && <p className="text-[11px] text-red-600">翻译请求失败，请检查后端是否运行。</p>}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: typecheck（此时 `translationSync` 还不存在）**

```bash
cd apps/desktop && pnpm typecheck:web
```

预期：`Cannot find module '@/lib/translationSync'`。**接着做 Task 13，再回来跑 typecheck**——Task 12 与 13 是同一份可编译交付物，不要在此提交。

---

### Task 13: 设置推送、路由与导航

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/translationSync.ts`
- Modify: `apps/desktop/src/renderer/src/layouts/AppLayout.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/nav.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `viewService.sendToView` / `getOpenIds` / `onState`（Task 5）、`useTranslationSettings`（Task 11）、`TranslationSettingVO`。
- Produces:
  - `interface TranslationFlagsPayload { receiveEnabled: boolean; sendEnabled: boolean; previewEnabled: boolean; enterToSend: boolean; disableChinese: boolean; disableChinesePreventSend: boolean; revision: number }`
  - `fingerprintOf(settings: TranslationSettingVO): string`
  - `broadcastTranslationFlags(settings: TranslationSettingVO): Promise<number>`（返回推送的 view 数）
  - `useTranslationSync(): void`

- [ ] **Step 1: translationSync.ts**

```ts
import { useEffect, useRef } from 'react'
import { useTranslationSettings, type TranslationSettingVO } from '@/api/translation'
import { viewService } from '@/services/viewService'

const CHANNEL = 'update-translation-flags'

export interface TranslationFlagsPayload {
  receiveEnabled: boolean
  sendEnabled: boolean
  previewEnabled: boolean
  enterToSend: boolean
  disableChinese: boolean
  disableChinesePreventSend: boolean
  revision: number
}

let revision = 0
let latest: TranslationFlagsPayload | null = null
let lastFingerprint = ''

/** Only a real change bumps the revision, so an idle refetch never wipes rendered bubbles. */
export function fingerprintOf(settings: TranslationSettingVO): string {
  return JSON.stringify(settings)
}

function flagsOf(settings: TranslationSettingVO): TranslationFlagsPayload {
  if (fingerprintOf(settings) !== lastFingerprint) {
    lastFingerprint = fingerprintOf(settings)
    revision += 1
  }
  return {
    receiveEnabled: settings.receiveEnabled,
    sendEnabled: settings.sendEnabled,
    previewEnabled: settings.previewEnabled,
    enterToSend: settings.enterToSend,
    disableChinese: settings.disableChinese,
    disableChinesePreventSend: settings.disableChinesePreventSend,
    revision
  }
}

export async function broadcastTranslationFlags(settings: TranslationSettingVO): Promise<number> {
  const flags = flagsOf(settings)
  latest = flags
  const viewIds = await viewService.getOpenIds()
  const results = await Promise.all(viewIds.map((id) => viewService.sendToView(id, CHANNEL, flags)))
  return results.filter(Boolean).length
}

/**
 * Mounted once in AppLayout: keeps every embedded page in sync with the stored toggles,
 * including views created after the last settings change (spec §5.4).
 */
export function useTranslationSync(): void {
  const settingsQuery = useTranslationSettings()
  const pushed = useRef(false)

  useEffect(() => {
    if (settingsQuery.data && !pushed.current) {
      pushed.current = true
      void broadcastTranslationFlags(settingsQuery.data)
    }
  }, [settingsQuery.data])

  useEffect(
    () =>
      viewService.onState((state) => {
        if (state.event !== 'created' || !latest) return
        void viewService.sendToView(state.viewId, CHANNEL, latest)
      }),
    []
  )
}
```

> 注入层只在 `revision` 变化时清表重译（Task 8 Step 3），因此"改设置 → 已渲染气泡按新语向重来"这条链要有推送方；页面上的每次保存都显式调用 `broadcastTranslationFlags(saved)`（Task 12 Step 1 的 `patch` 已包含），这一行就是验收点。

- [ ] **Step 2: 挂到 AppLayout**

`layouts/AppLayout.tsx`：

```tsx
import { Outlet } from 'react-router-dom'
import TitleBar from '@/components/TitleBar'
import ModuleRail from '@/components/ModuleRail'
import { useTranslationSync } from '@/lib/translationSync'

interface Props {
  onLogout: () => void
}

export default function AppLayout({ onLogout }: Props): React.JSX.Element {
  useTranslationSync()
  // …以下 JSX 不变
```

- [ ] **Step 3: 路由与导航**

`lib/nav.ts`：lucide import 里加 `Languages`，`NAV_ITEMS` 末尾加一项（素材库之后，保持 rail 从上到下是"工作台 → 客户 → 标签 → 人群包 → 快捷回复 → 素材库 → 翻译中心"）：

```ts
  { path: '/translation', label: '翻译中心', icon: Languages }
```

`App.tsx`：import `TranslationPage from '@/pages/TranslationPage'`，并在 `/materials` 那条 `Route` 之后加：

```tsx
          <Route path="/translation" element={<TranslationPage />} />
```

- [ ] **Step 4: typecheck + 构建**

```bash
cd apps/desktop && pnpm typecheck && pnpm build
```

预期：三份 tsconfig 全绿；`pnpm build` 走完 `typecheck → build:inject → electron-vite build` 并产出 `out/`。这一步同时覆盖 Task 12 与 Task 10 遗留的检查。

- [ ] **Step 5: 浏览器内手工核对（不登录 WhatsApp）**

```bash
cd apps/desktop && pnpm dev
```

用 `DEMO0001 / admin / admin123` 登录后，逐条确认并在报告里记录：

1. `#/translation` 打开即显示：节点与线路选到 `sg`（auto）、四张设置卡默认值与后端一致。
2. 点「重新测速」→ 7 行延迟徽标刷新，`my2` 灰色"不可达"，同名节点两次数值不同。
3. 线路点 `2 DeepL` → 源/目标下拉的候选条数变了（R4 的可见证据），且 `hk` 徽标出现"仅支持 Google 线路"。
4. 线路切回 `1 Google`、接收翻译里目标语言选 `英语` → 翻译试用输入 `你好` → 译文仍是中文方向（因为后端按 `type='receive'` 读的是 receive 语向；若刚保存成功，此处应出 `Hello`）。**这一条同时验"保存 → 立即生效"，若出 `Hello` 说明 PUT 与解析都通了。**
5. 缓存统计出现新键，重复点「翻译」→ 该键命中数递增。
6. 打开工作台某个账号视图（未登录 WhatsApp 也没关系）→ Console 里 `window.scrm.view.getOpenIds()` 有值，改一次开关后注入层 Console 不再报错（无 `view:host` 相关异常）。

---

### Task 14: 全量回归与交付

**Files:**
- 无新增；只跑验证与必要的修复。

**Interfaces:**
- Consumes: Task 1–13 的全部产出。
- Produces: 一份"已验证 / 未验证"的明确清单。

- [ ] **Step 1: 三端构建与单测**

```bash
cd apps/desktop && pnpm typecheck && pnpm build
cd apps/server && ./mvnw -q test
```

预期：typecheck 三份配置无错误；`pnpm build` 成功；`./mvnw test` 输出 `Tests run: 9, Failures: 0, Errors: 0`（P5a 之前没有测试类，这是全仓库第一个）。

- [ ] **Step 2: 后端契约回归**

重跑 Task 4 的 17 条用例（同一套命令），全部保持原期望。任一回归先修再进 Step 3。

- [ ] **Step 3: 交付手工清单**

把 spec §6.3 的 8 项逐条贴给用户，并明确说明：

> 本机的验证只到「后端契约 + 自测视图端到端 `view:invoke` + typecheck/build」，§6.3 需要在真实 WhatsApp Web 会话里扫码后才能勾验；在这些项目前不声明渲染已完成。

- [ ] **Step 4: 最终提交状态检查**

```bash
git status --short
git log --oneline -8
```

预期：工作区干净（`tmp/` 下的验证文件已删）；`git log` 里 P5 的提交按片排列（P5a 2–4 个、P5b 4 个、P5c 2–3 个）。**不要 push**——由用户手动推送。

- [ ] **Step 5: 已知限制如实记录（不写进代码注释，写在最终报告里）**

- 模拟词典只有 41 条短语，真实对话会大面积 `partial: true`：这是刻意的，避免假装本地能做真翻译。
- WhatsApp DOM 类名（`.copyable-text`、`[data-tab="10"]`）随版本漂移，坏了只改 `platforms/whatsapp/selectors.ts` 一处。
- Telegram 渲染本期不接线：翻译逻辑在 `inject/core/translation/` 下与平台无关，TG 只差一组选择器 + 一个 `setupTranslationListeners` 覆盖。
- 按客户覆盖语向（`translation_setting.scope='customer'`）与语音翻译本体留到后续阶段；本期 `voice_enabled` 只入库、UI 标"本期不生效"。

---

## 完成判据（整阶段）

| 判据 | 来源 |
|---|---|
| `./mvnw test` 绿（9 个引擎用例） | Task 2 |
| §6.1 的 17 条 curl 契约逐条通过，且设置已复位 | Task 3–4、Task 14 Step 2 |
| `pnpm typecheck`（node / web / inject）+ `pnpm build` 绿 | Task 5–13 |
| 自测视图能拿到 `translation` / `cacheKey`，白名单与 5001 字符返回 `null` | Task 5 Step 6 |
| `#/translation` 六项手工核对通过 | Task 13 Step 5 |
| §6.3 八项**由用户真实登录后**勾验；未勾前不得声明"渲染已验证" | spec §1.3 |
| 全链路零线上请求：`translation_node.url` 只作展示，无任何 `fetch` 指向外部域名 | spec §0 |


