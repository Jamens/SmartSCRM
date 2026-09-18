import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, RefreshCw, Search, Users2, X } from 'lucide-react'
import { PLATFORMS, platformOf } from '@/lib/platform'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/lib/utils'
import CustomerDrawer from '@/components/customers/CustomerDrawer'
import { useCustomers, useLabelTree, type CustomerVO } from '@/api/customers'

const PAGE_SIZE = 10
const ALL = 'all'

export default function CustomersPage(): React.JSX.Element {
  const [keyword, setKeyword] = useState('')
  const [platformType, setPlatformType] = useState<string>(ALL)
  const [country, setCountry] = useState('')
  const [labelIds, setLabelIds] = useState<number[]>([])
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const debouncedKeyword = useDebouncedValue(keyword, 300)
  const debouncedCountry = useDebouncedValue(country, 300)

  const { data, isPending, isError, isFetching, refetch } = useCustomers({
    keyword: debouncedKeyword.trim() || undefined,
    platformType: platformType === ALL ? null : Number(platformType),
    country: debouncedCountry.trim() || undefined,
    labelIds: labelIds.length ? labelIds : undefined,
    page,
    pageSize: PAGE_SIZE
  })
  const { data: tree = [] } = useLabelTree()

  useEffect(() => {
    setPage(1)
  }, [debouncedKeyword, platformType, debouncedCountry, labelIds])

  const records = data?.records ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const selected = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId]
  )

  const toggleLabel = (id: number): void => {
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const hasActiveFilter = Boolean(keyword || country) || platformType !== ALL || labelIds.length > 0
  const resetFilters = (): void => {
    setKeyword('')
    setCountry('')
    setPlatformType(ALL)
    setLabelIds([])
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Users2 className="size-5 text-primary" />
            客户管理
          </h1>
          <p className="text-xs text-muted-foreground">共 {total} 位客户</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
          刷新
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-6 py-3">
        <div className="relative w-64 max-w-full">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索昵称 / 手机 / 邮箱"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <Select value={platformType} onValueChange={setPlatformType}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="全部平台" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部平台</SelectItem>
            {Object.values(PLATFORMS).map((p) => (
              <SelectItem key={p.type} value={String(p.type)}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-32"
          placeholder="国家/地区"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        />
        {hasActiveFilter && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <X className="size-4" />
            清除筛选
          </Button>
        )}
      </div>

      {tree.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-6 py-2.5">
          <span className="mr-1 text-xs text-muted-foreground">标签：</span>
          {tree.flatMap((group) =>
            group.labels.map((label) => {
              const active = labelIds.includes(label.id)
              return (
                <button
                  key={label.id}
                  onClick={() => toggleLabel(label.id)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    active ? 'text-white' : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                  style={active ? { backgroundColor: label.color ?? 'var(--primary)', borderColor: 'transparent' } : undefined}
                >
                  {label.name}
                  <span className="ml-1 opacity-70">{label.useCustomerCount}</span>
                </button>
              )
            })
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {isPending ? (
          <TableMessage>加载客户中…</TableMessage>
        ) : isError ? (
          <TableMessage tone="error">无法加载客户，请确认后端已启动。</TableMessage>
        ) : records.length === 0 ? (
          <TableMessage>没有符合条件的客户。</TableMessage>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted/60 text-left text-xs text-muted-foreground backdrop-blur">
              <tr>
                <Th className="pl-6">客户</Th>
                <Th>平台</Th>
                <Th>联系方式</Th>
                <Th>国家</Th>
                <Th>标签</Th>
                <Th>最近联系</Th>
              </tr>
            </thead>
            <tbody>
              {records.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  onOpen={() => setSelectedId(customer.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-border/60 px-6 py-3 text-xs text-muted-foreground">
        <span>
          第 {page} / {pageCount} 页
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="size-4" />
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            下一页
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </footer>

      {selected && <CustomerDrawer customer={selected} tree={tree} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function CustomerRow({ customer, onOpen }: { customer: CustomerVO; onOpen: () => void }): React.JSX.Element {
  const meta = platformOf(customer.platformType)
  const Icon = meta?.icon
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-border/40 transition-colors hover:bg-muted/40"
    >
      <Td className="pl-6">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarImage src={customer.avatar ?? undefined} />
            <AvatarFallback className="text-xs" style={{ backgroundColor: meta?.color, color: '#fff' }}>
              {(customer.nickname ?? customer.openId).trim().slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{customer.nickname ?? '未命名客户'}</p>
            <p className="truncate text-xs text-muted-foreground">{customer.openId}</p>
          </div>
        </div>
      </Td>
      <Td>
        <span className="flex items-center gap-1.5 text-xs">
          {Icon && <Icon className="size-3.5" style={{ color: meta?.color }} />}
          {meta?.short ?? '—'}
        </span>
      </Td>
      <Td>
        <div className="text-xs">
          <p className="truncate">{customer.phone ?? '—'}</p>
          <p className="truncate text-muted-foreground">{customer.email ?? ''}</p>
        </div>
      </Td>
      <Td>
        <span className="text-xs">{customer.country ?? '—'}</span>
      </Td>
      <Td>
        <div className="flex max-w-[16rem] flex-wrap gap-1">
          {customer.labels.slice(0, 3).map((label) => (
            <Badge key={label.id} variant="secondary" className="gap-1 px-1.5 py-0 text-[11px]">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: label.color ?? 'var(--primary)' }} />
              {label.name}
            </Badge>
          ))}
          {customer.labels.length > 3 && (
            <span className="text-[11px] text-muted-foreground">+{customer.labels.length - 3}</span>
          )}
          {customer.labels.length === 0 && <span className="text-xs text-muted-foreground/60">—</span>}
        </div>
      </Td>
      <Td>
        <span className="text-xs text-muted-foreground">
          {customer.lastContactAt ? dayjs(customer.lastContactAt).format('MM-DD HH:mm') : '—'}
        </span>
      </Td>
    </tr>
  )
}

function Th({ className, children }: { className?: string; children: React.ReactNode }): React.JSX.Element {
  return <th className={cn('px-3 py-2 font-medium', className)}>{children}</th>
}

function Td({ className, children }: { className?: string; children: React.ReactNode }): React.JSX.Element {
  return <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>
}

function TableMessage({ children, tone }: { children: React.ReactNode; tone?: 'error' }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center px-6 py-16 text-center text-sm',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {children}
    </div>
  )
}
