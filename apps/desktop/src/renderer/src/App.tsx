import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles } from 'lucide-react'

function App(): React.JSX.Element {
  const ping = (): void => window.electron.ipcRenderer.send('ping')

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-8 bg-gradient-to-br from-primary/15 via-background to-gold/10">
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
          <Sparkles className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">SmartSCRM</h1>
          <p className="text-sm text-muted-foreground">React + TypeScript + Electron</p>
        </div>
      </div>

      <Card className="w-96">
        <CardHeader>
          <CardTitle>P0 脚手架冒烟测试</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Tailwind 主题（宝蓝 + 金）、shadcn/ui、preload IPC 桥均已接入。
          </p>
          <Button onClick={ping}>Send IPC Ping</Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default App
