import {
  BarChart3,
  Bell,
  Bot,
  Cloud,
  FileText,
  Fingerprint,
  Layers,
  ShieldAlert,
  Sprout,
  Cpu,
  Smartphone,
  FolderOpen,
  Globe,
  HelpCircle,
  History,
  Languages,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Settings,
  Target,
  Tags,
  Users,
  type LucideIcon
} from 'lucide-react'

export interface NavItem {
  path: string
  /** i18n 键（落在 `nav.*` 命名空间），渲染时由 ModuleRail 用 `t()` 取。 */
  i18nKey: string
  icon: LucideIcon
}

/** Left module rail: workbench keeps the embedded-account workspace; the rest are data modules. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/workspace', i18nKey: 'nav.workspace', icon: LayoutDashboard },
  // 报表仪表盘（B11）：租户级总览（账号/客户/会话/任务 + 7 天消息趋势），紧随工作台。
  { path: '/dashboard', i18nKey: 'nav.dashboard', icon: BarChart3 },
  // 记录页是"看数据"的模块，所以排在工作台（账号在不在）之后、客户（数据归属谁）之前。
  { path: '/messages', i18nKey: 'nav.messages', icon: History },
  { path: '/customers', i18nKey: 'nav.customers', icon: Users },
  { path: '/labels', i18nKey: 'nav.labels', icon: Tags },
  { path: '/audiences', i18nKey: 'nav.audiences', icon: Target },
  // 群发消费人群包选出的收件人，所以紧跟在人群包之后。
  { path: '/broadcast', i18nKey: 'nav.broadcast', icon: Megaphone },
  { path: '/quick-replies', i18nKey: 'nav.quickReplies', icon: MessagesSquare },
  { path: '/materials', i18nKey: 'nav.materials', icon: FolderOpen },
  { path: '/translation', i18nKey: 'nav.translation', icon: Languages },
  // 消息中心（A10）：站内通知列表，独立内容页，排在业务模块之后、宿主能力之前。
  { path: '/notifications', i18nKey: 'nav.notifications', icon: Bell },
  // 帮助中心（A11）：FAQ + 模板下载，独立内容页。
  { path: '/help', i18nKey: 'nav.help', icon: HelpCircle },
  // AI 工作区（B28）：知识库三栏/文档/人设/养号/接管台，独立内容页。
  { path: '/ai', i18nKey: 'nav.ai', icon: Bot },
  // 炒群引擎（B8）：角色库三级/剧本/任务面板，紧随 AI 工作区。
  { path: '/script', i18nKey: 'nav.script', icon: Layers },
  // 群自动加群/踢人（B18/B19）：带人工门，独立内容页，紧随炒群引擎。
  { path: '/group-ops', i18nKey: 'nav.groupOps', icon: ShieldAlert },
  // 互聊养号（B9）：多账号进群按可复现日程轮流发言，带人工门。
  { path: '/nurture', i18nKey: 'nav.nurture', icon: Sprout },
  // 本地自动化任务面板（B20）：跨模块只读聚合 + 账号批量关闭/删除（删除先停任务）。
  { path: '/automation', i18nKey: 'nav.automation', icon: Cpu },
  // 云手机（B10）：设备管理 + 模拟拉流视图（v1 不接真实 VMOS，符合开源红线）。
  { path: '/cloud-phone', i18nKey: 'nav.cloudphone', icon: Smartphone },
  // 代理池（B13）：代理 CRUD + 模拟出口探测（开源红线：探测不发起真实外连）。
  { path: '/proxy-pool', i18nKey: 'nav.proxypool', icon: Globe },
  // 浏览器指纹配置（B14）：指纹档案 CRUD + 模拟生成（开源红线：生成不探测真实设备）。
  { path: '/fingerprint-profiles', i18nKey: 'nav.fingerprint', icon: Fingerprint },
  // 云账号池（B21）：分组 / 统计卡 / 批量转移 / 筛选 / 同步到本地（开源红线：同步只写本地账号记录）。
  { path: '/cloud-accounts', i18nKey: 'nav.cloudaccount', icon: Cloud },
  // 客户跟进记录（B23）：跟进记录 + 标签变更流水 + 统计卡 / 批量操作条。
  { path: '/customer-follow-ups', i18nKey: 'nav.customerfollow', icon: NotebookPen },
  // 日志中心（A19）：排查用的宿主能力，排在业务模块之后、设置之前。
  { path: '/logs', i18nKey: 'nav.logs', icon: FileText },
  // 设置排在最后：它是宿主能力，不是业务模块。
  { path: '/settings', i18nKey: 'nav.settings', icon: Settings }
]

export const DEFAULT_NAV_PATH = '/workspace'
