# SmartSCRM 功能清单与阶段计划（已确认）

范围：最初定的是 15 个模块；2026-09-23 的范围裁定新增 15 项，2026-09-30 再补 B29（会话凭据导入），见文末「阶段增补记录」与各笔补记。保留内嵌真实网页能力；Java 后端为唯一数据层；本地 MySQL；线上 API 全部改为数据库 + 模拟数据（翻译线路是唯一例外）。

## A. 壳层 / 基础框架
| # | 功能 | 阶段 |
|---|------|------|
| A1 | 登录/鉴权（账号密码 + 邀请码租户 + 机器码设备绑定，JWT） | P1 |
| A2 | 无边框主窗（自绘标题栏、托盘、单实例） | P1 |
| A3 | 多开/窗口管理（同账号多窗检测、登录态分区） | P2 |
| A4 | i18n（zh-CN / en 起，8 语种框架；覆盖面铺开中：壳层 + messages 域 + customers 域 + broadcast 域 + 布局壳层(AccountStage/AccountSidebar/AddAccountDialog) + Labels 页面 + Materials 页面 + Audiences 页面 + QuickReplies 页面(主组件 + ReplyCard + ItemPreview + ItemEditor + MaterialPicker 5 子组件) + Translation 页面(主组件 + PageHeader + NodeCard + DirectionCard + CacheStatsCard + TrialCard + KeyConfigCard + ProviderKeyForm 8 子组件) 已抽 t()；zh-TW/ja/ko/vi/id/th 已补译并在 `i18n/index.ts` 注册生效） | P14（已交付） |
| A5 | 主题色板：宝蓝主色 + 金色点缀（light/dark 两套变量层） | P1 |
| A6 | 自动更新框架（本地源） | 🟡 **检查+通知已交付（2026-10-06）**：受开源红线约束，更新源**自托管可配**——`AppSettings.updateManifestUrl` 默认空串 = 不检查、不外连（绝不硬编码商业云）。`shared/update.ts` 纯模型（`parseUpdateManifest` 校验形状、`isNewerVersion` 点分数字比版本、预发布保守判非更新、`verdictFrom`/`disabledVerdict`）有单测；主进程 `services/updateChecker.ts` 拉自托管清单（空则 disabled 零请求，网络/形状错→error 不当"无更新"）+ `downloadUpdate` 下载到本地 downloads 目录；`update:check`/`update:download` IPC + preload + 设置页「自动更新」卡（更新源增删改查/检查/下载并回路径）。**本版不自动安装/替换 exe**（Windows 替换运行中程序有坑，留后续） |
| A7 | 内存/性能监控 | 🟡 **已交付（2026-10-06）**：`shared/perf.ts` 纯模型（字节复用 `machine.formatBytes`、新增 `formatDuration`、固定 6 行 `perfRows`：`memory.rss/heapUsed/heapTotal/external` + `runtime.uptime` + `cpu.total`，取不到时复用「未知」）；主进程 `services/perfMetrics.ts` 采 `process.memoryUsage/cpuUsage/uptime`（微秒→秒）经 `app:get-perf-metrics` IPC → preload `scrm.app.getPerfMetrics` → 渲染层 `lib/perfMetrics.ts`（3s 轮询）+ 设置页「性能监控」卡。shared 单测 6 条 |
| A8 | 敏感词风控（本地库） | 🟡 **已交付 + 发送链接入（2026-10-06）**：V22 建 `sensitive_word`（`uk(tenant_id,word)` 租户内去重，`enabled` 控是否参与命中，`category` 仅分组标签不参与匹配）；`SensitiveWordService` 租户隔离 + CRUD + `match()`（不区分大小写子串、忽略停用词、去重、保留原样便于高亮，做成可单测纯函数）+ `POST /api/sensitive-words/check` 命中端点；前端 `api/sensitiveWords.ts` + 设置页「敏感词库」卡（增删/启停/文本试检）。后端 12 条单测。**发送链接入（2026-10-06）**：渲染层发送漏斗 `useSendText.send`（`MessageThread`/`ReplyComposer` 共用，协议号与 IPC 两分支都在内）在 `appendPending` **之前**调 `checkSensitiveWordsNow(text)` 判一次——命中即拦下**不发**、不留 pending 气泡，返回「消息含敏感词：…」；匹配口径仍唯一在后端。判定请求本身出错时 **fail-open 放行**（风控是旁路，不因它抖动堵死所有回复）。**入站判定已接（2026-10-06）**：V23 给 `chat_message` 加 `has_sensitive`；`MessageService.accept` 入库时对「入站+有正文」判一次（**整批只查一次词表**、内存逐条 `matchWords`，复用已单测纯函数），命中打 `has_sensitive=1` 存进行里（读列表直接读标记、免得 N+1 回查）；`MessageVO` 暴露 `hasSensitive`，渲染层入站气泡底部显示「含敏感词」徽标。`MessageServiceAcceptRuleTest` 补两条（命中打标记/未命中不打）。**批量群发已接（2026-10-06）**：主进程泵 `batchSend/host.ts` 的真发路径改为 `makeRealDispatch(api.checkSensitive)` 工厂——每条**发前**判一次，命中不发光按 `failed` 记（`errorCode=SENSITIVE_WORD`，详情页看得出是风控拦而非发送失败）；判定这一跳失败（`null`）时 fail-open 照发。批量按分钟级间隔慢发、每条一次后端往返可接受，**匹配口径仍唯一在后端**、主进程不复制词表/匹配逻辑 |
| A9 | 修改密码（改密后强制重新登录） | ✅ 已交付（2026-10-03） |
| A10 | 消息中心 / 站内通知（列表 + 未读 + 系统通知投递） | 🟡 **主体已交付（2026-10-06）**：V21 建 `notification` + `notification_read`（`uk(notification_id,user_id)`，**已读按用户记**，故一条全员广播对不同子账号各读各的，兼容 B22 多子账号）；`NotificationService`（租户隔离 + 可见性 `user_id=我 OR NULL`，未读=可见−我已读）+ `NotificationController`（`GET /api/notifications` 分页带 `read` 标记 / `GET /api/notifications/unread-count` / `PUT /{id}/read` / `PUT /read-all`）；前端 `api/notifications.ts`（列表/未读数/已读 hooks，30s 轮询）+ `/notifications` 页（未读高亮、点开即已读并跳 `link`、只看未读、全部已读）+ 侧栏铃铛入口 + 8 语文案（`DeepString` 编译期对齐）。**投递入口** `NotificationService.publish(...)` 已就绪（`userId=null` 即广播）。**第一个真实触发点已接（2026-10-06）**：B7 批量群发任务跑到终态（`BatchSendService.reports` 的 `running→done`/`→error`）时投递一条系统通知给租户（带 `/broadcast` 跳转）；只在真搬进终态那趟发，重复轮询不重复投递，投递失败不崩结算。**第二个触发点已接（2026-10-06）**：`TakeoverService.transferHuman`（会话进入 `WAITING_TAKEOVER` 队列的**唯一收口**，规则引擎与坐席手动转都走它）投递「有会话待接管」系统通知（带 reason、跳 `/messages`），失败 try/catch 记 warn 不崩转人工。**其余业务事件随各功能接入时调 `publish`** |
| A11 | 帮助文档与 FAQ 模板下载 | 🟡 **已交付（2026-10-06）**：独立内容页 `/help`（非设置项）；`HelpPage` 三条 FAQ（走 i18n 8 语）+ 「下载 FAQ 模板」按钮（渲染层就地生成带 BOM 的 UTF-8 CSV → `Blob` + `a[download]`，**不经后端、不落应用目录**，用户自存）；侧栏问号入口 |
| A12 | 任务栏未读角标（数字 + Windows 叠加图标，值来自会话未读投影） | P6 收尾 |
| A13 | 主题切换开关（light / dark / 跟随系统 + 持久化） | P6 收尾 |
| A14 | 设备信息（机器码与设备绑定状态、应用与运行时版本、本地存储占用） | P6 收尾 |
| A15 | 设置页（导航新入口；A13 主题开关与 A14 设备信息各占其中一行，后续 A4/A6/A8/A9、A17/A18、B13/B14 的落点也以它为准） | P6 收尾 |
| A16 | 角色 RBAC + 菜单权限树（角色 CRUD / 启停 / 排序 + 菜单树勾选与父子半选回传） | 🟡 **管理端侧已交付（2026-10-04）**：V14 建 `sys_menu`(type 1=dir/2=menu/3=button 隐藏)/`sys_role`/`sys_role_menu`；`AdminRoleController`（分页 / 创建 / `PUT {id}/menus` 授权 / 删除）；`AdminPermissionInterceptor` 对 `/api/admin/**` **每次请求查库**填 `menuCodes` 并 publish 成 authority（权限不进 JWT，撤权即时生效）；`SecurityConfig` 开 `@EnableMethodSecurity`；管理端 `RoleList` + `RoleEdit` 权限树（父子半选 + BUTTON 隐藏节点）。**业务侧地基已补（2026-10-06，V24）**：seed 业务菜单码（`customer/label/audience/quick_reply/material/broadcast/message/translation/notification` 各 `:read`+`:write`，`sys_menu` 里 type2 菜单带 path + type3 按钮）并授予 `super_admin`(CROSS JOIN)/`tenant_admin`，管理端菜单树可见可授权——**零行为变更**，为后续业务端点按 menuCodes 判定备好地基。**业务侧强制判定已开（2026-10-06）**：机制用实验定论——`@EnableMethodSecurity`(proxy/AOP) 在**方法调用时**求值，早于它求值的 `HandlerInterceptor.preHandle` 才是喂权限码的时机（已用真接口验证管理端点 200）。`AdminPermissionInterceptor` 泛化为「`/api/admin/**` 或 handler 带 `@PreAuthorize` 才查库」，其余业务端点只做一次廉价注解检查（零查库、零行为变更）；`WebMvcConfig` 注册放宽到 `/api/**`。**标签模块垂直切片已接**（`LabelController` 读=`label:read`/写=`label:write`），端到端验证：标签读/写 200（admin 有码不被挡）、管理端回归 200、未接注解端点 200。**剩余模块已铺（2026-10-06）**：`CustomerController`(customer)、`AudienceController`(audience)、`ConversationController`(message)、`QuickReplyController`(quick_reply)、`MaterialController`(material)、`TranslationController`(translation)、`BatchSendController`(broadcast)、`MessageController`(message)、`NotificationController`(notification) 共 77 个端点批量加 `@PreAuthorize`（GET→`:read`、变更→`:write`）。端到端复验 9 个模块读端点全 200、admin 零 403。**平台账号模块已补齐（2026-10-06）**：V25 seed `account:read`/`account:write` 码 + 授予内置角色，`PlatformAccountController` 接 `@PreAuthorize`（端点验 200）。**反向验证已补（2026-10-06）**：`AdminPermissionInterceptorTest` 追加桌面侧用例——只 publish 库里真授予的码（未授予的码不进 authority，故 `@PreAuthorize` 必拒）、空授权角色不产生任何业务码、业务带 `@PreAuthorize` 会查库而未带的不查（零成本守卫）。**唯一"未按菜单码判定"的端点**：`MessageController` 的 `/batch` 消息入库——**有意为之**（2026-10-06 裁定）：它是机器对机器的采集口（主进程代租户上报观测到的消息），不是人在 UI 的操作。① 语义：菜单码模型"这个人能在 UI 做什么"，这里是应用管线报告结果；② 会坏功能：入库用当前登录用户的 token，按其 `message:*` 判定会让只读子账号登录时采集断掉；③ 性能：标注=每批消息多查一次权限码（高频）。边界靠**认证 + 租户隔离**兜底（`/api/**` 全 `authenticated()`，accept 按 `principal.tenantId()` 收窄，跨租户不可达）。代码处已写明该裁定 |
| A17 | 桌面系统通知（OS 通知弹窗 + 同会话合并去抖 + 点击直达会话；**不是** A10 的站内通知列表） | ✅ 已交付（2026-10-03，commit `27062f2`） |
| A18 | GPU 崩溃降级与图形开关（`--gpu-safe-mode` 自动重启降级 + 持久化 + 一键重试标准模式；硬件加速开关；DPI 缩放到全部 WebContentsView） | ✅ 已交付（2026-10-03） |
| A19 | 分类日志落盘 + 日志中心（主进程四类日志 + 未处理 Promise 拒绝 + 批量刷盘；**只落本地，不上报服务端**） | ✅ 已交付（2026-10-03） |

## B. 业务模块
| # | 功能 | 阶段 |
|---|------|------|
| B1 | 多平台账号视图（WebContentsView + 分区登录态 + 代理） | P2 |
| B15 | 注入脚本系统（WhatsApp/TG 适配器、翻译/UI/消息） | P2 |
| B4 | 客户管理（联系人/标签树/备注/时间线/受众包） | P3 |
| B3 | 快捷回复素材库（文字/图片/名片多组件） | P4 |
| B2 | 翻译中心（4 渠道 + 节点测速 + 模拟翻译 + 译文缓存） | P5 |
| B5 | 聊天记录（采集入库 / 全局搜索 / 统计 / 应用内回复发送 / 会话与客户绑定） | P6 |
| B7 | 批量群发（笛卡尔展开/随机间隔/撤回/看门狗） | P7 |
| B6 | 群成员分析（事件流水 + 状态快照 + 导出） | P8 |
| B8 | 炒群引擎（角色库三级/剧本/loop 调度/failover/断点续跑，调度在 Java） | P9 |
| B9 | 互聊养号（装箱算法 + 可复现日程） | P10 |
| B13 | 代理池管理 | P11 |
| B14 | 浏览器指纹配置 | P11 |
| B10 | 云手机（VMOS 管理 + 模拟拉流） | P12 |
| B11 | 报表仪表盘 | P13 |
| B12 | 支付/套餐门控（模拟支付宝） | P13 |
| B16 | 会话级全局设置（内嵌聊天页的会话设置面） | P7 前置 |
| B17 | 素材·按钮消息（interactive buttons）+ 个人/公共/联系人归属分层 | P7 |
| B18 | 群自动加群（任务表单 + 批量加入执行链） | P9 |
| B19 | 群自动踢人（规则表单 + 执行链） | P9 |
| B20 | 本地自动化任务面板（批量关闭 / 批量删除 / 状态总览） | P10 |
| B21 | 云账号池（分组 / 统计卡 / 批量转移 / 筛选 / 同步到本地） | P12 |
| B22 | 团队 / 部门 / 子账号 + 客户绑定客服（坐席归属） | 🟡 **管理端部分交付（2026-10-04）**：V14 建 `sys_team`/`sys_user_team`；`AdminTeamController` + `AdminUserController`（团队树 CRUD、用户 CRUD、`{id}/roles` 与 `{id}/teams` 分配、`{id}/status` 启停、删除）+ 管理端 `TeamList`/`UserList`。**仍缺**：部门三字段 `type`(NORMAL/DC)/`isPushTicket`/`powers`——`SysTeam` 现只有 `parentId`/`name`/`leaderId`/`scope`/`status`；子账号**端口上限**（现只有租户级 `tenant.seat_limit`，V15）；**重置密码**（`AdminUserController` 无该端点）。客户绑定客服已由 B28 的 `chat_conversation.assignee_id` 部分覆盖 |
| B23 | 客户跟进记录 + 标签变更记录 + 客户统计卡 / 批量操作条 | P13 |
| B24 | 首页套餐信息卡 + 快捷入口网格 | P13 |
| B25 | 图片 / 语音翻译（OCR 与 ASR 线路，本地模拟优先） | P15 |
| B26 | 联系人缓存 + 本地数据清理与存储管理 | P15 |
| B27 | WhatsApp 协议号通道（REST 会话/消息/发送/已读/撤回 + WS 入站与状态推送；零注入、不经网页登录，收发两腿分阶段交付） | P16 |
| B28 | AI 智能客服 + AI 知识库（QA / 角色 / 分类三栏 + 养号设置与推荐规则） | P17 · **已扩 spec（2026-10-06，`docs/superpowers/specs/2026-10-06-b28-ai-knowledge-design.md`）**：**已交付 P1 后端** = 转人工规则（V17 `ai_transfer_rule` + `AiTransferRuleService`）+ 接管队列状态机（V16 `chat_conversation.handling_status/assignee_id` + `TakeoverService`）+ 消息入库接线（`accept`→`firstMatch`→`transferIfAi`）+ 进队列 A10 通知；**第一段：三栏数据层后端已交付（2026-10-06，V26）** = `ai_role`/`ai_category`/`knowledge_qa` 三表 + 实体/Mapper/Service/Controller（`/api/ai-roles`·`/api/ai-categories`·`/api/knowledge-qa`，接 A16 `knowledge:read/write` 判定）+ 单测，端到端 CRUD 验过。**第二段：文档管线已交付（2026-10-06，V27）** = `knowledge_doc`/`knowledge_chunk` 两表 + 实体/Mapper/Service/Controller（`/api/knowledge-docs` 上传正文即按空行贪心切成片、解析/重解析/停用/分片列表，`/api/knowledge-qa/derived` 人工确认后落派生 QA 锚回 doc/chunk）；`shared/aiKnowledge.ts` 的 `deriveQaPreview`（分片→候选 QA 预览，**不自动落库**）+ 6 条单测。**剩余**（spec §5–§7）：AI 人设（`ai_persona` + 助手）、养号设置（`ai_nurture_setting`）、接管台前端、三栏前端 |
| B29 | 会话凭据导入（用已登录的会话凭据替代扫码，**仍走内嵌视图**，不新增通道、不涉及注入层改动） | 与 TG 链（12a–12d）同支，排在其后 |

## 阶段增补记录（2026-09-23）

上面 A9–A11 与 B16–B28 是一次成批的范围纳入，不是零散补漏，因此把归阶段与几条不显然的边界写在这里：

- **P15–P17 是新增尾巴阶段**，排在已确认的 P14 之后，不动 P7–P14 的既有次序。归进已有阶段的那些行（B17→P7、B18/B19→P9、B20→P10、B21→P12、B22/B23/B24→P13、A9/A10/A11→P14）按**域**就近：自动化三行跟着群运营与互聊走，号池跟着云手机走，坐席与跟进记录跟着报表套餐走。
- **B16 标的是"P7 前置"**，不是"P6 之内"。它属于聊天页的会话设置面，但 P6 的验收面（Task 19 真实登录态端到端）不能被它拖住，所以排在 P6 交付之后、群发开工之前。
- **B23 的"标签变更记录"需要先改数据模型**：`customer_label` 只有 `created_at`，且 `uk_customer_label(customer_id, label_id)` + 撤标即删行 ⇒ 撤标与重打没有任何审计痕迹。要做变更记录必须新增一张流水表，不能靠现有表推。
- **B27 是与 WhatsApp 网页内嵌并列的第二条收发通道**：它不复用注入层、不复用 wa-js 桥，账号形态在 `lib/platform.ts` 里已有枚举（协议托管，无 `embedUrl`），缺的是整条收发与状态实现，所以单独立阶段。
  这一行内部要按**两条腿分开交付**：
  - **入站腿**只需新增一种账号档位（`WhatsAppProtocol` 不进 `INJECTABLE_CHANNELS`、不建 `WebContentsView`），消息按现有入库面落库即可被记录页、全局搜索与统计卡直接消费，不需要新的展示面。
  - **出站腿**是独立的 HTTP 发送通道，与内嵌视图发送链零复用——per-view 发送锁、每账号一条串行泵、页内撤回命令链都以 `viewId` 寻址，对协议托管账号不成立。群发与回复若要吃这条通道，必须先按通道分派，不能假设 `viewId` 存在。
  - **撤回在 B27 的范围内**（2026-09-30 裁定）。但这一项只有"协议通道自己提供撤回"一条实现路径：内嵌视图那条页内撤回链（选中气泡 → 菜单 → 从我这端删除）对协议托管账号根本不存在，所以 B7 那套撤回面**不覆盖**这条通道。若通道侧没有该能力，B27 的撤回只能停在"通道能力缺失"，**不许用本地状态改写来伪装成已撤回**。
- **B29「会话凭据导入」是从 B27 里摘出来单列的一行**（2026-09-30 裁定）：它做的事是给已有内嵌视图换一套登录凭据（跳过扫码），视图、注入层、采集与发送链全部照旧，因此既不复用 B27 的第二通道，也不该挂在 P16 里搭车。它只对"有内嵌视图但拿不到扫码现场"的通道成立，所以排在 TG 那条链（12a–12d）同支之后。**这一行的阶段归属是我给的判断，不是裁定的一部分**——改档只改这一行与文末「2026-09-30」补记里的那条说明。
- **B21 的"同步到本地"方向是云号 → 本地视图导入**，与 B10 云手机（设备管理 + 拉流）不是一回事，两者同阶段但互不阻塞。

### 同日第二笔：B5 补宽 + 三笔欠账进队

- **B5 补宽成"采集入库 / 全局搜索 / 统计 / 应用内回复发送 / 会话与客户绑定"**。后两项本来就在 P6 的交付面里
  （回复发送是 Task 12/12d，会话与客户绑定是 Task 5/17），只是原来那行没记——属于"做了没写"，不是新增范围。
- **A12 / A13 / A14 是欠账，不是新功能**：角标本来就写在 A2 那行里、light/dark 写在 A5 那行里，两行都给人"已交付"的
  错觉，所以把它们**从原行里摘出来单列**，A2 只留标题栏/托盘/单实例、A5 只留色板与两套变量层。摘出来之后 A2 与 A5
  才是它们真实的状态。设备信息页此前在清单里完全没有行（只有 A1 的机器码绑定），这次补 A14。
- **三笔排在"P6 收尾"**：具体插在 Task 18 之后、Telegram 那条链（12a–12d）之前。理由是角标要有可靠的未读来源，
  而这个来源正是 P6 的会话未读投影——它比 TG 链更依赖 P6，也更便宜；TG 那四步卡在真实设备与选择器实测上，
  不该被壳层小项插队打断，所以放在这三笔之后。
- 这三笔各要一份自己的实施计划再动手，不并进 P6 那份计划文件：它们与聊天记录没有接口关系，混进去会让两份计划的
  验收面互相纠缠。
- **A13 / A14 的宿主已定（2026-09-24）：新开一个「设置」页（A15，导航加一项），两笔都是它里面的一行**，
  不是各自独立成页，也不挂进翻译中心或标题栏下拉。A14 因此从"设备信息页"收成"设备信息（设置页内的一节）"。
  这个宿主同时是后阶段壳层项的落点：A4 语言（已交付）、A6 自动更新、A7 性能监控、A8 敏感词库、A9 修改密码（已交付）与 P11 的代理 /
  指纹配置，都按"设置页里的一行/一节"来放，届时不再重开页面；A10 消息中心与 A11 帮助文档是内容页不是设置项，
  仍各自成页。**A12 角标没有宿主问题**——它写的是任务栏，值来自会话未读投影，全在壳层与主进程侧，不需要任何页面。

### 2026-09-29：B7 批量群发交付（P7 第一段，V11）

- **B7 已交付**：`docs/notes/2026-09-28-b7-batch-send-verification.md` 是它的验收记录（四档总览、机械档五个数字、
  契约 37 条、演练腿 8 条 + 详情腿 6 条、已知行为四条、V1 缺口八条），spec 与计划分别在
  `docs/superpowers/specs/2026-09-28-batch-send-design.md`、`docs/superpowers/plans/2026-09-28-batch-send.md`。
- **第一版边界**（不是"以后再说"，是这一版明确不做的，写进 spec §10）：平台只认 `whatsapp`；内容只到纯文本，媒体与
  按钮消息属于 B17；收件人锁死在已采会话（不碰 `createChat`，发错人不可回收）；没有定时/周期；任务本机跑、不跨设备续；
  `unknown` 明细**只有显示没有裁决入口**——那一行只能人工去 WhatsApp 里核对，系统不替操作者结掉它。
- **两格仍是"待验证"**：真发 1 条、真撤回 1 次，都要用户在场并明确放行才做（spec §9 那一档）。全部自动化腿跑的是
  `dryRun=1`，全程没按下过任何发送键、没撤过任何真实消息。

### 2026-09-30：P16 的边界补记（B27 拆两腿、撤回归入 B27、B29 单列）

- 「阶段增补记录」里 B27 原来只写了"第二条收发通道"，没写清**这条通道能借用什么、必须自己实现什么**。这次补在它自己的条目里：入站腿复用现有入库面（`POST /api/messages/batch` → 会话头投影 → 记录页 / 全局搜索 / 统计卡），
  出站腿与内嵌视图发送链零复用（per-view 发送锁、每账号一条串行泵、页内撤回命令链都以 `viewId` 寻址）。
- **两腿分两次交付**是这一版的执行形状：先只读接入（验收面 = 记录页能列、搜索能命中、统计口径对得上），
  再单独决定出站腿。一旦出站腿落地，群发与回复必须按通道分派，不能假设存在 `viewId`。
- **撤回归 B27**（不另开行），前提是通道侧提供该能力；不提供就停在能力缺失，不做本地伪装。
- **B29 是从 B27 摘出来的独立一行**，不与第二通道混算。

### 2026-10-01：B6 群成员分析的交付切面（按"一个任务一个提交"分批）

B6 不是一次交付，按四个切面推进，前三个已提交，第四个未开始：

| 切面 | 内容 | 状态 | commit |
|---|---|---|---|
| 1 | V12 三表迁移 + `shared/groupMembers.ts` 纯模型与单测 | ✅ | `2b2df31` |
| 2 | Java 数据层（3 实体 / 3 Mapper / 2 Service / Controller / DTO / 4 VO） | ✅ 契约 34/34 | `3771927` |
| 3 | 桥侧采集（名单 / 快照 / 在线事件 / 系统消息旁路） | ✅ 20 条单测 | `ade904e` |
| 4a | 主进程建档泵（engine 通电：ingest POST / dispatch 命令→视图 / host 去重 / `group:build` IPC） | ✅ 17 条单测 | 本提交 |
| 4b | 导出 IPC + exceljs（拉 `export-rows` → 写 14 列 XLSX，落盘经 `group:export` IPC） | ✅ 4 条单测 | 本提交 |
| 5a | 渲染层数据层与原子件（`api/groupMembers.ts` 五个 hook + `lib/groupDisplay.ts` §8 文案纯函数 7 条单测 + `components/ui/tabs.tsx`） | ✅ 7 条单测 | 本提交 |
| 5b | 界面装配（客户抽屉「所在群」节 + 群成员弹层：两个 tab、三档筛选、两处导出入口） | ✅ 编译+单测，未声称可用 | 本提交 |
| 5c | CDP 界面腿 20 条 + 验收台账（B6 的交付闸） | 🟡 已实跑 **18/20**（2026-10-05）：前提全绿；含 L16/L17 两条 8b 界面证人；L3 归 16、L20 属本机 `spawnSync EBUSY` 环境限制（库已复查干净）。台账 `docs/notes/2026-10-05-b6-5c-ui-leg.md` | — |

**口径提醒**：B6 的"事件流水 + 状态快照"两块数据面在切面 1–3 已经能进库了，
建档泵（切面 4a）也通了电——`group:build` IPC 触发后全量建档可在后台跑，不用等在线事件；
导出（切面 4b）也已通电——`group:export` IPC 触发后主进程拉 `export-rows` 生成 14 列 XLSX 落盘，
不占渲染内存。
但 **5b 的判档只到编译与单测**，界面尚未声称可用；**B6 第一次声称"界面可用"要等 5c 的 CDP 腿跑绿**。
所以 B6 的"可用"以 5c 完成为准，前面的切面都只是地基。

**本轮顺带补齐的前置**（原本挂在 Task 12/13 名下却没落地）：`shared/groupMembers.ts` 的
`GroupBuildOutcome` / `GroupStateEvent` / `GroupExportResult` / `groupRoleLabel` / `exitMethodLabel` /
`formatExportTime` / `oneLine`，以及 preload 的 `window.scrm.group.{build,export,onState}`。
同时把已提交的泵对齐计划契约：结论从 `BuildResult` 换成 `GroupBuildOutcome`（并分出
`snapshotted` 与 `postedFailed`）、入参 `chatKeys` 复数改 `chatKey` 单数（R49）、
`group:build` 改成等整轮跑完才 resolve、新增 `group:state` 的 running/settled 广播、
`export.ts` 的时刻文本收敛到 shared（R46）。

### 2026-10-03：A16–A19 壳层增补

这四行补的是「既有 44 行里没有落点」的能力——它们既不落在壳层已有的那几行里，也不属于任何一条业务行。

- **A16 角色 RBAC** 是这四行里唯一有依赖的：角色要分配给子账号，所以**排在 B22 之后**，与 B22 同支落在 P13。
  立项依据是本仓自己的现状：后端 `find -iname "*Role*" -o "*Permission*"` **零命中**，
  与 README §7 第 7 条「只有认证，没有授权，`role` 只签发不参与判定」是同一件事的两面。
- **A17 / A18 / A19 标「可提前」**，理由是它们全在主进程与壳层，不碰任何业务面、不依赖外部服务，
  也不被 B 档任何一行阻塞。A10 与 A7 之所以覆盖不了它们：A10 写的是**站内**通知列表，A7 写的是**监控**——
  监控不等于崩溃自愈，站内通知不等于 OS 弹窗。
- **A17 / A18 的落点是设置页（A15）**（各占一节）；A16 的落点是团队页（与 B22 同一处）；
  A19 的日志中心是内容页，与 A10/A11 同样各自成页。
- **A17 已交付**（commit `27062f2`）：共享规则层 `shared/notification` + 主进程 `desktopNotify` + IPC `notify:show`/`notify:clicked` + 渲染层 `liveTailSync` 提请与 `AppLayout` 跳转。
- **A18 已交付**：GPU 后端在 `app.ready` 之前定（启动参数 `--gpu-safe-mode` 关 GPU）；崩溃走 `child-process-gone`（`type==='gpu'`）→ 记 `gpuSafeMode` 并带参重启；设置页「图形」卡含硬件加速开关与「重试标准模式」；`WebContentsViewManager.syncZoomToWindow` 把缩放对齐到主窗口并在 DPI 变化时同步。设计见 `docs/superpowers/specs/2026-10-03-gpu-fallback-design.md`。
- **A19 已交付**：主进程日志中心——`console.*` 接管按 `[tag]` 归四类（app/ipc/bridge/error）、捕获 `uncaughtException`/`unhandledRejection`、内存环 5000 条 + 按天批量落盘 + 退出前 flush；`installIpcLogging` 包 `ipcMain.handle` 记每次调用；日志中心页 `/logs` 可筛选/刷新/清空/打开目录，只落本地不上报。设计见 `docs/superpowers/specs/2026-10-03-log-center-design.md`。
- **A9 已交付**（2026-10-03）：设置页新增「账户安全」卡。后端 `ChangePasswordRequest`（record，`newPassword @Size(8,64)`）+ `AuthService.changePassword`（校验原密码 / 新旧不可相同 / 重写哈希）+ `AuthController POST /api/auth/change-password`；前端 `api/auth.ts` + `SettingsPage` 表单（原/新/确认 + 可见性切换 + 长度与一致性前端校验）。改密成功后 `useAuthStore.logout()` 清本机会话，`App` 在 `phase==='anonymous'` 自动渲染登录页，实现「强制重新登录」。未做 tokenVersion 失效（保持无状态 JWT 架构）。设计见 `docs/superpowers/specs/2026-10-03-change-password-design.md`。
- **A19 只落本地。** 本项目的定位是外部服务一律自托管或不接，遥测外传那一档不做。
- **「每日养号计划 runner」本轮不入册**：「服务端编排 → 客户端执行」这一形态要不要保留属裁定问题，
  不是实现问题——裁定前不占阶段、不给编号。

### 2026-10-03：B 档范围提示（不改阶段，只提示别做窄）

另有一批「**行已有、但字面写窄了**」的项。它们**不新增行、不改阶段**，只在开工时按下面的口径做，否则会明显缺一块：

| 行 | 清单现写法 | 开工时应补 |
|---|---|---|
| B28 | QA / 角色 / 分类三栏 + 养号设置与推荐规则 | **AI 转人工规则引擎**（规则名 / 匹配模式 任意·全部 / 关键词 / 转接原因）+ **人工接管队列**（`WAITING_TAKEOVER` / `HUMAN_ACTIVE` 双态、接管、恢复 AI）+ **知识库文档实体**（上传→解析模式→分片预览 + 派生 QA 预览→停用 / 重解析）+ **AI 人设助手**（生成 / 优化 / 模板库） |
| B24 | 套餐信息卡 + 快捷入口网格 | 首页另有三块：平台在线盘点卡、数据摘要卡（在线账号 / 客户 / 消息 / 任务 + 涨跌）、用量统计卡（分项进度条） |
| B12 | 支付 / 套餐门控（模拟支付宝） | 门控 ≠ 配额展示：另有**钱包余额卡**与**资源用量卡**（AI Tokens 已用/剩余、翻译字符含「不限量」档） |
| B22 | 团队 / 部门 / 子账号 + 客户绑定客服 | 部门另有 `type`(NORMAL/DC)、`isPushTicket`、`powers`；子账号另有**端口上限**（受租户上限约束）与**重置密码** |
| B13 | 代理池管理 | 另有**会话出口 IP 探测**与**按 IP 查询归属地** |
| B2 | 4 渠道 + 节点测速 + 模拟翻译 + 译文缓存 | 另有**流式翻译 SSE**（失败回退 POST） |
| B7 | v1 明确只到纯文本 | v2 的**随机 Emoji** 与**话术干扰**（随机插表情与特殊字符）属抗风控手段，不在 v1 范围内 |

> B28 那一行尤其要先扩 spec 再动手：智能体 / 转接规则 / 知识文档 / 分片预览这几组字段要先定表，否则做到一半会发现三栏之外还缺半张。

## 技术选型
- desktop: Electron 39 + React 19 + TS(strict) + electron-vite + Tailwind v4 + shadcn/ui + Zustand + TanStack Query + react-i18next
- server: Java 17 + Spring Boot 3.5 + MyBatis-Plus + Flyway + MySQL 8（库名 `smartscrm_react`，不动旧 `smartscrm` 库）
- 数据模型：所有业务表按 `tenant_id` 做租户隔离，字段一律用语义名列（不留 `extra1`-`extra5` 之类的临时列）

## 协作约定
- 每完成一个阶段功能：本地测试通过 → git commit（用户自行 push）
- 提交前缀：feat: / fix: / refa: / update:
