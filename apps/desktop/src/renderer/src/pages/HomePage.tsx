import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { http } from '@/lib/http'
import { getDeviceId } from '@/lib/device'
import { useAuthStore } from '@/stores/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Fingerprint, Database, Sparkles } from 'lucide-react'

interface Health {
  app: string
  dbVersion: string
  time: string
}

export default function HomePage(): React.JSX.Element {
  const user = useAuthStore((s) => s.user)
  const [deviceId, setDeviceId] = useState('')

  useEffect(() => {
    void getDeviceId().then(setDeviceId)
  }, [])

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => http.get<Health>('/api/health'),
    retry: false
  })

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-slate-50 via-background to-primary/5">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <Sparkles className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              你好，{user?.nickname || user?.username}
            </h1>
            <p className="text-sm text-muted-foreground">{user?.tenantName} · 角色 {user?.role}</p>
          </div>
        </div>

        <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="size-4 text-primary" /> 后端连接
              </CardTitle>
            </CardHeader>
            <CardContent>
              {health.isPending && <span className="text-sm text-muted-foreground">检测中…</span>}
              {health.isError && <Badge variant="destructive">离线</Badge>}
              {health.data && <Badge className="bg-primary/10 text-primary hover:none">MySQL {health.data.dbVersion}</Badge>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Fingerprint className="size-4 text-gold" /> 设备指纹
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="truncate text-sm font-mono text-foreground" title={deviceId}>
                {deviceId || '—'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">邀请码</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-semibold tracking-wide text-foreground">{user?.inviteCode}</p>
            </CardContent>
          </Card>
        </div>

        <p className="max-w-md text-center text-sm text-muted-foreground">
          P1 窗口壳与登录鉴权已完成。多平台账号视图、客户管理、素材库等模块将在后续阶段逐层接入。
        </p>
      </div>
    </div>
  )
}
