import {
  FileText,
  FolderOpen,
  History,
  Languages,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
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
  // 日志中心（A19）：排查用的宿主能力，排在业务模块之后、设置之前。
  { path: '/logs', i18nKey: 'nav.logs', icon: FileText },
  // 设置排在最后：它是宿主能力，不是业务模块。
  { path: '/settings', i18nKey: 'nav.settings', icon: Settings }
]

export const DEFAULT_NAV_PATH = '/workspace'
