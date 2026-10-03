import { useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Download, RefreshCw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/lib/utils'
import {
  GROUP_EVENT_PAGE_SIZE,
  GROUP_MEMBER_PAGE_SIZE,
  useGroupBuild,
  useGroupEvents,
  useGroupExport,
  useGroupMembers,
  type GroupRowVO,
  type MemberFilters
} from '@/api/groupMembers'
import {
  actorCopy,
  buildFailureNotes,
  eventTypeCopy,
  exitCell,
  exportOutcomeCopy,
  firstSeenNote,
  gateNote,
  inGroupCopy,
  joinTimeCopy,
  LIVE_EVENT_TIME_NOTE,
  memberAreaCopy,
  memberAreaState,
  sourceCopy,
  timeCopy
} from '@/lib/groupDisplay'
import type { GroupMemberRole } from '@shared/groupMembers'
// 角色列的中文词只有 shared 那一份作者（R46），组件里不许再写一张表。
import { groupRoleLabel } from '@shared/groupMembers'

const ALL = 'all'
const ROLES: GroupMemberRole[] = ['member', 'admin', 'super']
const EVENT_TYPES = ['added', 'joined', 'left', 'removed', 'promoted', 'demoted']

interface Props {
  accountId: number
  row: GroupRowVO
  onClose: () => void
}

export default function GroupMembersDialog({ accountId, row, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState('members')
  const build = useGroupBuild()
  const groupExport = useGroupExport()
  // 「点了没反应」与「还没点」的唯一分界：`outcome===null` 两种来路都成立（没点过 / 宿主没给答案）。
  const [buildRequested, setBuildRequested] = useState(false)

  const area = memberAreaState(row)
  const areaNote = memberAreaCopy(area)
  const notes = buildRequested ? buildFailureNotes(build.outcome) : []
  const exportMsg = groupExport.result ? exportOutcomeCopy(groupExport.result) : ''

  const refresh = (): void => {
    setBuildRequested(true)
    build.build({ accountId, chatKey: row.chatKey }) // 单数键（R49）：三处契约逐字一致
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      {/* 不再调 beginOverlay：DialogContent 内部已挂浮层计数（Task 15 技术要点 9）。 */}
      <DialogContent className="max-w-5xl" data-p8g-dialog="">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="truncate">{row.title ?? row.chatKey}</span>
            {row.isFinal && <Badge variant="outline">{t('customers.groups.disbanded')}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {t('customers.dialog.desc', {
              in: row.inGroupCount,
              snapshot: row.participantCount,
              time: timeCopy(row.lastSnapshotAt),
              count: row.snapshotCount
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            data-p8g-refresh=""
            disabled={build.pending || row.isFinal}
            title={row.isFinal ? t('customers.dialog.refreshSkipFinal') : t('customers.dialog.refreshOneShot')}
            onClick={refresh}
          >
            <RefreshCw className={cn('size-3.5', build.pending && 'animate-spin')} />
            {build.pending ? t('customers.dialog.building') : t('customers.dialog.refresh')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-p8g-export-one=""
            disabled={groupExport.pending || row.snapshotCount === 0}
            title={
              row.snapshotCount === 0
                ? t('customers.dialog.exportNoSnapshot')
                : undefined
            }
            onClick={() => groupExport.exportRows({ accountId, chatKeys: [row.chatKey] })}
          >
            <Download className="size-3.5" />
            {groupExport.pending ? t('customers.dialog.exporting') : t('customers.dialog.exportOne')}
          </Button>
          <Button size="sm" variant="ghost" data-p8g-close="" className="ml-auto" onClick={onClose}>
            <X className="size-4" />
            {t('common.close')}
          </Button>
        </div>

        {build.pending && (
          <p className="text-xs text-muted-foreground" data-p8g-build-pending="">
            {t('customers.dialog.buildingNote')}
          </p>
        )}
        {areaNote && (
          <p
            className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground"
            data-p8g-area={area}
          >
            {areaNote}
          </p>
        )}
        {notes.map((line) => (
          <p key={line} className="text-xs text-destructive" data-p8g-build-msg="">
            {line}
          </p>
        ))}
        {exportMsg && <p className="text-xs text-muted-foreground" data-p8g-export-msg="">{exportMsg}</p>}

        {/* 非 WhatsApp 与从没快照过的群不显示空名单冒充结果（spec §8 第六行）：两句话各自出，tab 都不给。 */}
        {area === 'built' ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="members" data-p8g-tab-members="">
                {t('customers.dialog.tabMembers')}
              </TabsTrigger>
              <TabsTrigger value="events" data-p8g-tab-events="">
                {t('customers.dialog.tabEvents')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="members">
              <MemberTable accountId={accountId} chatKey={row.chatKey} />
            </TabsContent>
            <TabsContent value="events">
              <EventTable accountId={accountId} chatKey={row.chatKey} />
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** 名单与流水各一张表。两个 hook 都待在组件内部：未激活的 tab 被 Radix 卸载，
 *  才不会一开弹层就打两次 GET（第二个 tab 还没被人看过）。 */
function MemberTable({
  accountId,
  chatKey
}: {
  accountId: number
  chatKey: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [inGroup, setInGroup] = useState(ALL)
  const [role, setRole] = useState(ALL)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const debouncedQ = useDebouncedValue(q, 300)

  const filters: MemberFilters = {
    // 「全部」传 undefined，"只看已退群"传 false（Task 15 技术要点 2：`qs` 丢 undefined 但保留 false）。
    isInGroup: inGroup === 'in' ? true : inGroup === 'out' ? false : undefined,
    role: role === ALL ? '' : (role as GroupMemberRole),
    q: debouncedQ.trim(),
    page
  }
  const { data, isPending, isError } = useGroupMembers(accountId, chatKey, filters)
  const records = data?.members.records ?? []
  const total = data?.members.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / GROUP_MEMBER_PAGE_SIZE))
  const gate = gateNote(data?.reason ?? null, data?.coverage ?? null)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={inGroup} onValueChange={(v) => { setInGroup(v); setPage(1) }}>
          <SelectTrigger size="sm" className="w-28" data-p8g-f-in-group="">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('customers.dialog.filterAllMembers')}</SelectItem>
            <SelectItem value="in">{t('customers.dialog.filterInGroup')}</SelectItem>
            <SelectItem value="out">{t('customers.dialog.filterOutGroup')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={(v) => { setRole(v); setPage(1) }}>
          <SelectTrigger size="sm" className="w-28" data-p8g-f-role="">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('customers.dialog.filterAllRoles')}</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {groupRoleLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-44"
          data-p8g-f-q=""
          placeholder={t('customers.dialog.searchPlaceholder')}
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1) }}
        />
        {gate && (
          <span className="ml-auto text-xs text-amber-600" data-p8g-coverage-note="">
            {gate}
          </span>
        )}
      </div>

      {isPending ? (
        <p className="py-8 text-center text-xs text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <p className="py-8 text-center text-xs text-destructive">{t('customers.dialog.membersLoadError')}</p>
      ) : records.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">{t('customers.dialog.membersEmpty')}</p>
      ) : (
        <div className="max-h-[52vh] overflow-auto rounded-lg border border-border/50">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-muted/70 text-left text-[11px] text-muted-foreground backdrop-blur">
              <tr>
                {t('customers.dialog.memberHeader')
                  .split(' / ')
                  .map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {records.map((m) => {
                const exit = exitCell(m)
                const seen = firstSeenNote(m)
                return (
                  <tr key={m.memberKey} data-p8g-member-row={m.memberKey} className="border-b border-border/40">
                    <Td>
                      <span className="block max-w-[12rem] truncate">{m.displayName ?? '—'}</span>
                    </Td>
                    <Td>{m.phone ?? '—'}</Td>
                    <Td>{groupRoleLabel(m.roleType)}</Td>
                    <Td>{inGroupCopy(m.isInGroup)}</Td>
                    <Td>
                      {joinTimeCopy(m)}
                      {/* §8 第三行 + §11 第 2 条：没有进群证据时补一句"首次见到"，且绝不叫进群时间。 */}
                      {seen && <span className="block text-[11px] text-muted-foreground">{seen}</span>}
                    </Td>
                    <Td>{m.joinCount}</Td>
                    <Td>{exit.time}</Td>
                    <Td>{exit.method}</Td>
                    <Td>{timeCopy(m.lastMsgAt)}</Td>
                    {/* 聚合列可空：null 是"没查过"，0 是"查了、那天没说话"。把 null 印成 0 就是替后端编一个读数。 */}
                    <Td>
                      {m.msgCount == null ? '—' : m.msgCount}
                      {m.dayMsgCount == null ? '' : ` / ${m.dayMsgCount}`}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pager anchor="member" page={page} pageCount={pageCount} total={total} unit={t('customers.groups.unitPeople')} onPage={setPage} />
    </div>
  )
}

function EventTable({
  accountId,
  chatKey
}: {
  accountId: number
  chatKey: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [eventType, setEventType] = useState(ALL)
  const [page, setPage] = useState(1)
  const { data, isPending, isError } = useGroupEvents(
    accountId,
    chatKey,
    eventType === ALL ? '' : eventType,
    page
  )
  const records = data?.records ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / GROUP_EVENT_PAGE_SIZE))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={eventType} onValueChange={(v) => { setEventType(v); setPage(1) }}>
          <SelectTrigger size="sm" className="w-32" data-p8g-f-event="">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('customers.dialog.filterAllEvents')}</SelectItem>
            {EVENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {eventTypeCopy(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">{LIVE_EVENT_TIME_NOTE}</span>
      </div>

      {isPending ? (
        <p className="py-8 text-center text-xs text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <p className="py-8 text-center text-xs text-destructive">{t('customers.dialog.eventsLoadError')}</p>
      ) : records.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          {t('customers.dialog.eventsEmpty')}
        </p>
      ) : (
        <div className="max-h-[52vh] overflow-auto rounded-lg border border-border/50">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-muted/70 text-left text-[11px] text-muted-foreground backdrop-blur">
              <tr>
                {t('customers.dialog.eventHeader')
                  .split(' / ')
                  .map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {records.map((e) => (
                <tr key={e.id} data-p8g-event-row={e.id} className="border-b border-border/40">
                  <Td>{timeCopy(e.occurredAt)}</Td>
                  <Td>{eventTypeCopy(e.eventType)}</Td>
                  {/* 本期流水只有键没有名（GroupEventVO 不含 displayName），目标人那一格给键。 */}
                  <Td>
                    <span className="block max-w-[14rem] truncate font-mono text-[11px]" title={e.memberKey ?? ''}>
                      {e.memberKey ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="block max-w-[10rem] truncate" title={actorCopy(e)}>
                      {actorCopy(e)}
                    </span>
                  </Td>
                  <Td>{sourceCopy(e.source)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager anchor="event" page={page} pageCount={pageCount} total={total} unit={t('customers.groups.unitItems')} onPage={setPage} />
    </div>
  )
}

/** 在 `components/customers/` 里写一份、两个表共用，不去 import CustomersPage 那两个私有件
 *  （它们没导出），也不抽进 `components/ui/table.tsx`——抽出来要同时改两个已验收文件，
 *  那是另一期的一步。 */
function Th({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <th className="px-3 py-2 font-medium">{children}</th>
}

function Td({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <td className="px-3 py-2 align-middle">{children}</td>
}

function Pager({
  anchor,
  page,
  pageCount,
  total,
  unit,
  onPage
}: {
  anchor: 'member' | 'event'
  page: number
  pageCount: number
  total: number
  unit: string
  onPage: (next: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span
        data-p8g-event-page={anchor === 'event' ? '' : undefined}
        data-p8g-member-page={anchor === 'member' ? '' : undefined}
      >
        {t('customers.groups.pageInfo', { page, pageCount, total, unit })}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('customers.prevPage')}
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          {t('customers.nextPage')}
        </Button>
      </div>
    </div>
  )
}
