// src/renderer/src/components/messages/ConversationList.tsx
import { useMemo, useState } from 'react'
import { Hand, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/lib/utils'
import { useAccounts } from '@/stores/accounts'
import { platformOf } from '@/lib/platform'
import { msgService } from '@/services/msgService'
import { useBridgeOf } from '@/lib/liveTailSync'
import {
  chatMs,
  flattenConversations,
  unfilteredConversationQuery,
  useConversations,
  useTakeoverQueueCount,
  type ConversationVO
} from '@/api/messages'
import { listTime } from '@/lib/chatDays'
import { titleOfConversation } from '@/lib/chatDisplay'
import { handlingOf, statusLabelKey, statusToneClass } from '@/lib/handlingStatus'
import { isChatPlatform } from '@shared/chatPlatform'

const ALL = 'all'

interface Props {
  accountId: number | null
  onAccountIdChange: (id: number) => void
  picked: ConversationVO | null
  onPick: (conversation: ConversationVO) => void
}

/** 补底提示：跟着"哪个账号上按的"走，换账号后不再显示上一条（文字留在另一个账号名下会误导）。 */
interface SyncHint {
  accountId: number
  text: string
}

export default function ConversationList({
  accountId,
  onAccountIdChange,
  picked,
  onPick
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { data: accounts = [] } = useAccounts()
  const [keyword, setKeyword] = useState('')
  const [platform, setPlatform] = useState<string>(ALL)
  const [onlyWaiting, setOnlyWaiting] = useState(false)
  const [syncHint, setSyncHint] = useState<SyncHint | null>(null)
  const debouncedKeyword = useDebouncedValue(keyword, 300)
  const bridge = useBridgeOf(accountId)
  const waitingCount = useTakeoverQueueCount()

  /**
   * `handlingStatus` 只在「只看待接」打开时才进查询对象：关着时必须是 `undefined`
   * 而不是 `'AI'` 或 `null`——查询键是整个参数对象的哈希，键里多一个字段就是另一份缓存，
   * 于是「清掉筛选」会切到一份从未被填过的缓存上，表现为列表闪一下空再回来。
   */
  const query = useMemo(
    () => ({
      ...unfilteredConversationQuery(accountId),
      platform: isChatPlatform(platform) ? platform : null,
      q: debouncedKeyword.trim() || undefined,
      handlingStatus: onlyWaiting ? ('WAITING_TAKEOVER' as const) : undefined
    }),
    [accountId, platform, debouncedKeyword, onlyWaiting]
  )
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useConversations(query)
  const conversations = flattenConversations(data?.pages)

  const syncHistory = (): void => {
    if (accountId === null) return
    const at = accountId
    void msgService
      .syncHistory(accountId)
      .then((started) => {
        // 两种结果必须长得不一样：主进程返回 false 表示"命令发出去了但桥没接"，
        // 静默成功会让人以为在补底，然后对着空列表怀疑数据丢了。
        setSyncHint({
          accountId: at,
          text: started ? t('messages.list.syncStarted') : t('messages.list.syncNotOnline')
        })
      })
      // 拒绝了也要有下文：invoke 失败（桥没挂、主进程抛了）原本只剩一个未处理的 rejection，
      // 用户按了按钮什么也没发生，比"补底未启动"更难判断。
      .catch(() => {
        setSyncHint({ accountId: at, text: t('messages.list.syncRequestFailed') })
      })
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-border/60 bg-muted/30">
      <div className="space-y-2 border-b border-border/60 px-3 py-3">
        <Select
          value={accountId === null ? '' : String(accountId)}
          onValueChange={(v) => onAccountIdChange(Number(v))}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('messages.list.selectAccount')} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={String(account.id)}>
                {platformOf(account.platformType)?.short ?? '?'} · {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t('messages.list.searchPlaceholder')}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue placeholder={t('messages.list.platform')} />
            </SelectTrigger>
            <SelectContent>
              {/* 只有这两个平台有消息桥：列全平台会出现"选了永远没结果"的筛选项 */}
              <SelectItem value={ALL}>{t('messages.list.allPlatforms')}</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="telegram">Telegram</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={accountId === null || !bridge}
            onClick={syncHistory}
            title={bridge ? t('messages.list.syncHintOnline') : t('messages.list.syncHintOffline')}
          >
            <RefreshCw className="size-4" />
            {t('messages.list.syncHistory')}
          </Button>
          <Button
            variant={onlyWaiting ? 'default' : 'outline'}
            size="sm"
            className="shrink-0 gap-1"
            onClick={() => setOnlyWaiting((v) => !v)}
            title={t('messages.list.waitingFilterHint')}
            data-p6-action="waiting-filter"
            data-p6-waiting-on={onlyWaiting ? '1' : '0'}
          >
            <Hand className="size-4" />
            {t('messages.list.waitingFilter')}
            {(waitingCount.data ?? 0) > 0 && (
              <span className="tabular-nums">{waitingCount.data}</span>
            )}
          </Button>
        </div>

        {syncHint !== null && syncHint.accountId === accountId && (
          <p className="text-xs text-muted-foreground">{syncHint.text}</p>
        )}
      </div>

      {/* `data-p6-scroller="list"` 与 `MessageThread` 那侧的 `"thread"` 成对：
          跨页跳转（Task 18 的抽屉投递）要在 CDP 里"点左列某一条会话"，右列标题里也有同一个客户名，
          不限定容器就会点到右列去。 */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2" data-p6-scroller="list">
        {/* 没选账号时查询是 disabled 的，`isPending` 会一直挂着——不挡住这句就变成"永远在加载"，
            而真正的原因是没账号可查（右列那句提示在左列看不见）。 */}
        {accountId !== null && isPending && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('messages.list.loading')}</p>
        )}
        {accountId === null && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t('messages.list.pickAccountFirst')}
          </p>
        )}
        {isError && (
          <p className="px-2 py-4 text-center text-xs text-destructive">
            {t('messages.list.loadError')}
          </p>
        )}
        {accountId !== null && !isPending && !isError && conversations.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {/* 空列表有两种原因：账号真没数据，还是被筛选条件筛空。指错原因会让人以为采集丢了。
                「只看待接」也算筛选条件——开着时为空是常态（没人转人工），不能报成"没数据"。 */}
            {debouncedKeyword.trim() !== '' || platform !== ALL || onlyWaiting
              ? t('messages.list.emptyFiltered')
              : t('messages.list.emptyNoData')}
          </p>
        )}
        {conversations.map((c) => {
          const active = picked?.id === c.id
          const summary = c.lastMsgBody ?? ''
          const status = handlingOf(c)
          const tone = statusToneClass(status)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors',
                active ? 'bg-primary/10' : 'hover:bg-muted'
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium text-muted-foreground">
                {titleOfConversation(c).slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {titleOfConversation(c)}
                  </span>
                  {/* AI 态不挂徽标（默认态挂了等于整列同色）；另两态各一个色块，
                      这样"哪几条在等人"扫一眼就知道，不必点进去。 */}
                  {tone !== null && (
                    <Badge
                      variant="outline"
                      className={cn('shrink-0 border-0 px-1.5 py-0 text-[10px]', tone)}
                      data-p6-list-status={status}
                    >
                      {t(statusLabelKey(status))}
                    </Badge>
                  )}
                  {c.isGroup && (
                    <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                      {t('messages.list.badgeGroup')}
                    </Badge>
                  )}
                  {!c.isGroup && c.customerId === null && (
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                      {t('messages.list.badgeStranger')}
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {summary || t('messages.list.noText')}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {/* 必须走 chatMs：后端给的是不带时区的东八区墙钟串，`dayjs(串)` 按浏览器时区
                        解析，右列就会和气泡（ts 由 chatMs 算）差出几个小时。 */}
                    {c.lastMsgTime ? listTime(chatMs(c.lastMsgTime)) : ''}
                  </span>
                </span>
              </span>
              {c.unreadCount > 0 && (
                <Badge className="shrink-0 rounded-full px-1.5 py-0 text-[10px]">
                  {c.unreadCount > 99 ? '99+' : c.unreadCount}
                </Badge>
              )}
            </button>
          )
        })}
        {hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? t('messages.list.loadingMore') : t('messages.list.loadMore')}
          </Button>
        )}
      </div>
    </aside>
  )
}
