import {
  LayoutDashboard,
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
  { path: '/customers', label: '客户', icon: Users },
  { path: '/labels', label: '标签', icon: Tags },
  { path: '/audiences', label: '人群包', icon: Target }
]

export const DEFAULT_NAV_PATH = '/workspace'
