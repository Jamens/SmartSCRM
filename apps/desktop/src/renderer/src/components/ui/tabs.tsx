import * as React from "react"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

// 形状与 dialog.tsx 同一家族：data-slot 给样式与 CDP 腿当锚点，props 类型从 primitive 反推，不自己写一遍。
// 群成员弹层的两个 tab（名单 / 流水）用它；报表阶段（B8）同样要 tab，所以这是第一个 ui 原子件
// 而不是内联按钮组。
function Tabs({ ...props }: React.ComponentProps<typeof TabsPrimitive.Root>): React.JSX.Element {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>): React.JSX.Element {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>): React.JSX.Element {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>): React.JSX.Element {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
