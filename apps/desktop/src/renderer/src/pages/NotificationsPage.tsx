import { useState } from 'react'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount
} from '@/api/notifications'

const PAGE_SIZE = 20

/**
 * A10 消息中心 / 站内通知。
 *
 * 与 A17 桌面弹窗通知是**两件事**：这里是站内持久列表（可回看、可标记已读），
 * A17 是 OS 级弹窗（不落库、点开即走）。本页只读后端通知，不负责投递。
 */
export default function NotificationsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [unreadOnly, setUnreadOnly] = useState(false)

  const { data, isPending, isError } = useNotifications(page, PAGE_SIZE, unreadOnly)
  const { data: unread = 0 } = useUnreadCount()
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()

  const records = data?.records ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  /** 点一条：先标已读（不阻塞跳转），有 link 才跳。 */
  const open = (id: number, link: string | null, read: boolean): void => {
    if (!read) markRead.mutate(id)
    if (link) navigate(link)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Bell className="size-5 text-primary" />
            {t('notifications.title')}
          </h1>
          <p className="text-xs text-muted-foreground">
            {unread > 0 ? t('notifications.unreadCount', { count: unread }) : t('notifications.allRead')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={unreadOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setUnreadOnly((v) => !v)
              setPage(1)
            }}
          >
            {t('notifications.unreadOnly')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <CheckCheck className="size-4" />
            {t('notifications.markAllRead')}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {isPending ? (
          <Message>{t('common.loading')}</Message>
        ) : isError ? (
          <Message tone="error">{t('notifications.loadError')}</Message>
        ) : records.length === 0 ? (
          <Message>{t('notifications.empty')}</Message>
        ) : (
          <ul className="divide-y divide-border/50">
            {records.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  data-p10n-row={n.id}
                  onClick={() => open(n.id, n.link, n.read)}
                  className={cn(
                    'flex w-full items-start gap-3 px-6 py-3 text-left transition-colors hover:bg-muted/40',
                    !n.read && 'bg-primary/5'
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      n.read ? 'bg-transparent' : 'bg-primary'
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'truncate text-sm',
                          n.read ? 'text-foreground' : 'font-semibold text-foreground'
                        )}
                      >
                        {n.title}
                      </span>
                      {n.type === 'system' && (
                        <Badge variant="outline" data-p10n-type={n.type}>
                          {t('notifications.system')}
                        </Badge>
                      )}
                    </span>
                    {n.content && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.content}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dayjs(n.createdAt).format('MM-DD HH:mm')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-border/60 px-6 py-3 text-xs text-muted-foreground">
        <span>{t('notifications.total', { count: total })}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {t('common.prevPage')}
          </Button>
          <span>
            {page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            {t('common.nextPage')}
          </Button>
        </div>
      </footer>
    </div>
  )
}

function Message({
  children,
  tone
}: {
  children: React.ReactNode
  tone?: 'error'
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center px-6 py-16 text-center text-sm text-muted-foreground',
        tone === 'error' && 'text-destructive'
      )}
    >
      {children}
    </div>
  )
}
