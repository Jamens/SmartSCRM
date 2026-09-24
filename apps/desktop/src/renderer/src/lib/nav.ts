import {
  FolderOpen,
  History,
  Languages,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  Target,
  Tags,
  Users,
  type LucideIcon
} from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
}

/** Left module rail: workbench keeps the embedded-account workspace; the rest are data modules. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/workspace', label: '工作台', icon: LayoutDashboard },
  // 记录页是"看数据"的模块，所以排在工作台（账号在不在）之后、客户（数据归属谁）之前。
  { path: '/messages', label: '聊天记录', icon: History },
  { path: '/customers', label: '客户', icon: Users },
  { path: '/labels', label: '标签', icon: Tags },
  { path: '/audiences', label: '人群包', icon: Target },
  { path: '/quick-replies', label: '快捷回复', icon: MessagesSquare },
  { path: '/materials', label: '素材库', icon: FolderOpen },
  { path: '/translation', label: '翻译中心', icon: Languages },
  // 设置排在最后：它是宿主能力，不是业务模块。
  { path: '/settings', label: '设置', icon: Settings }
]

export const DEFAULT_NAV_PATH = '/workspace'
