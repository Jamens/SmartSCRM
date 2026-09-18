import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  description: string
}

export function ModulePlaceholder({ icon: Icon, title, description }: Props): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="border-b border-border/60 px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Icon className="size-5 text-primary" />
          {title}
        </h1>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-7" />
        </div>
        <h2 className="text-base font-semibold text-foreground">{title}即将上线</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export default ModulePlaceholder
