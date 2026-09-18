import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '@/lib/nav'
import { cn } from '@/lib/utils'

export default function ModuleRail(): React.JSX.Element {
  return (
    <nav className="flex h-full w-16 shrink-0 flex-col items-center gap-1 border-r border-border/60 bg-muted/40 py-3">
      {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) =>
            cn(
              'group flex w-full flex-col items-center gap-1 py-2.5 text-[11px] transition-colors',
              isActive
                ? 'text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'flex size-9 items-center justify-center rounded-xl transition-colors',
                  isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'group-hover:bg-background'
                )}
              >
                <Icon className="size-4.5" />
              </span>
              <span className={cn(isActive && 'font-semibold')}>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
