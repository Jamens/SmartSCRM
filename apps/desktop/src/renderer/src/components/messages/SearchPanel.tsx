// src/renderer/src/components/messages/SearchPanel.tsx
import { useMemo, useState } from 'react'
import { LoaderCircle, Search, X } from 'lucide-react'
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
import { flattenHits, useSearchMessages } from '@/api/messages'
import { listTime } from '@/lib/chatDays'
import { jumpToOfHit, MIN_QUERY, type JumpTarget } from '@/lib/chatSearch'
import { accountTypeOfPlatform, isChatPlatform, type ChatPlatform } from '@shared/chatPlatform'
import type { Direction } from '@shared/chatTypes'

const ALL = 'all'
const HIT_SIZE = 20

interface Props {
  onJump: (target: JumpTarget) => void
  /** 右列当前会话的客户：「只看当前客户」开关只认这一个来源（口径见 Step 5 说明第 2 条）。 */
  currentCustomerId: number | null
}

export default function SearchPanel({ onJump, currentCustomerId }: Props): React.JSX.Element {
  const { data: accounts = [] } = useAccounts()
  const [keyword, setKeyword] = useState('')
  const [platform, setPlatform] = useState<string>(ALL)
  const [account, setAccount] = useState<string>(ALL)
  const [direction, setDirection] = useState<string>(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [onlyCurrentCustomer, setOnlyCurrentCustomer] = useState(false)
  const debounced = useDebouncedValue(keyword, 300)
  /**
   * 开关的"生效"= 按下了 **且** 右列确实挂着一位客户。允许在搜索视图里用左列换会话/换账号，那时
   * `currentCustomerId` 会变成 null，请求里的 `customerId` 本来就不发了——如果按钮还显示按下态、
   * 「清除过滤」还算它一位，界面就是"看着在按客户过滤、结果却是全量"。所以三处（请求、按钮态、
   * filtersOn）一律读这一条派生值，并给一行小字说明"换到已关联客户的会话会自动恢复"。
   */
  const customerFilterOn = onlyCurrentCustomer && currentCustomerId !== null

  const query = useMemo(
    () => ({
      q: debounced.trim(),
      platform: isChatPlatform(platform) ? (platform as ChatPlatform) : null,
      accountId: account === ALL ? null : Number(account),
      direction: direction === ALL ? null : (direction as Direction),
      // from/to 交 'YYYY-MM-DD'：后端把 to 展到当天 23:59:59（Task 4 的 parseDay），前端不再拼时分
      from: from || null,
      to: to || null,
      customerId: customerFilterOn ? currentCustomerId : null,
      size: HIT_SIZE
    }),
    [debounced, platform, account, direction, from, to, customerFilterOn, currentCustomerId]
  )
  const { data, isPending, isFetching, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useSearchMessages(query)
  const hits = flattenHits(data?.pages)
  const searchable = query.q.length >= MIN_QUERY
  const filtersOn =
    platform !== ALL ||
    account !== ALL ||
    direction !== ALL ||
    from !== '' ||
    to !== '' ||
    customerFilterOn

  const reset = (): void => {
    setPlatform(ALL)
    setAccount(ALL)
    setDirection(ALL)
    setFrom('')
    setTo('')
    setOnlyCurrentCustomer(false)
  }

  return (
    <div data-p6-search="panel" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-border/60 px-6 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-p6-search-input
              className="pl-8"
              placeholder={`搜索消息正文（至少 ${MIN_QUERY} 个字）`}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="全部平台" />
            </SelectTrigger>
            <SelectContent>
              {/* 只有这两个平台有消息桥：列全平台会造出"选了永远没结果"的筛选项 */}
              <SelectItem value={ALL}>全部平台</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="telegram">Telegram</SelectItem>
            </SelectContent>
          </Select>
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="全部账号" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部账号</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {platformOf(a.platformType)?.short ?? '?'} · {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="全部方向" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部方向</SelectItem>
              <SelectItem value="in">收到</SelectItem>
              <SelectItem value="out">发出</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-muted-foreground">至</span>
          <Input type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button
            type="button"
            variant={customerFilterOn ? 'default' : 'outline'}
            /** 三态读法：`onlyCurrentCustomer` 是"用户按过没有"，`customerFilterOn` 是"现在真的在过滤"。
             *  `aria-pressed` 给后者——驱动与读屏都按它判，别去嗅 class。 */
            aria-pressed={customerFilterOn}
            size="sm"
            disabled={currentCustomerId === null}
            title={currentCustomerId === null ? '先在右侧选中一个已关联客户的会话' : undefined}
            onClick={() => setOnlyCurrentCustomer((v) => !v)}
          >
            只看当前客户
          </Button>
          {filtersOn && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="size-4" />
              清除过滤
            </Button>
          )}
        </div>
        {onlyCurrentCustomer && currentCustomerId === null && (
          <p className="text-[11px] text-muted-foreground">
            当前会话没有关联客户，「只看当前客户」暂时停用；换到已关联客户的会话会自动恢复。
          </p>
        )}
        {searchable && isFetching && !isPending && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" />
            搜索中…
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
        {!searchable && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            输入至少 {MIN_QUERY} 个字开始搜索。搜索扫的是已入库的消息正文。
          </p>
        )}
        {searchable && isPending && <p className="py-6 text-center text-xs text-muted-foreground">搜索中…</p>}
        {searchable && isError && (
          <p className="py-6 text-center text-xs text-destructive">搜索请求失败，请确认后端已启动。</p>
        )}
        {searchable && !isPending && !isError && hits.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            没有命中。换个关键词，或把时间窗放宽。
          </p>
        )}
        {hits.map((hit) => {
          const target = jumpToOfHit(hit)
          return (
            <button
              /**
               * React 的 `key` 用 `chatKey:msgKey`，不是 Produces 里那个 `data-p6-hit` 的值：搜索结果
               * 天生跨会话，而 `msgKey` 只是平台原生 id、**同一条会话内**唯一（TG 的原生 id 会跨会话重号），
               * 拿它当 key 会在撞上时给出重复键、React 复用错的那张卡。
               * `data-p6-hit` 按 brief 保持 `msgKey` 原值 ⇒ 它不是全局主键，选择器要带
               * `[data-p6-search="panel"]` 作用域或配合会话名一起定位（Task 18/19 的驱动照这条写）。
               */
              key={`${hit.message.chatKey}:${hit.message.msgKey}`}
              type="button"
              data-p6-hit={hit.message.msgKey}
              disabled={target === null}
              onClick={() => {
                if (target) onJump(target)
              }}
              className={cn(
                'mb-2 block w-full rounded-lg border border-border/60 px-3 py-2 text-left transition-colors',
                target ? 'hover:bg-muted' : 'cursor-not-allowed opacity-60'
              )}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="truncate font-medium text-foreground">
                  {hit.chatTitle ?? hit.message.chatKey}
                </span>
                <Badge
                  variant={hit.message.direction === 'out' ? 'secondary' : 'outline'}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {hit.message.direction === 'out' ? '发出' : '收到'}
                </Badge>
                <span className="text-muted-foreground">
                  {platformOf(accountTypeOfPlatform(hit.message.platform))?.label ?? hit.message.platform}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {listTime(new Date(hit.message.msgTime).getTime())}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-foreground">
                {hit.message.body ?? '（媒体消息）'}
              </p>
              {target === null && (
                <p className="mt-1 text-[11px] text-muted-foreground">这条消息没有对应的会话头，无法跳转。</p>
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
            {isFetchingNextPage ? '加载中…' : '加载更多'}
          </Button>
        )}
      </div>
    </div>
  )
}
