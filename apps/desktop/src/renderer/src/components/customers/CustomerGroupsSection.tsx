import { useMemo, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlatformType } from '@/lib/platform'
import { useAccounts, useSelectionStore } from '@/stores/accounts'
import { useCustomerGroups, useGroupExport, type GroupRowVO } from '@/api/groupMembers'
import { exportOutcomeCopy, memberAreaShort, memberAreaState, timeCopy, tooManyCopy } from '@/lib/groupDisplay'
import GroupMembersDialog from '@/components/customers/GroupMembersDialog'
// 组件只在 vite / tsc 两个世界里活（node --test 不加载它），所以走 `@shared` 别名——
// 相对路径那条规则（Task 15 技术要点 10）只约束会被单测加载的 `lib/`。
import { MAX_EXPORT_GROUPS } from '@shared/groupMembers'

interface Props {
  customerId: number
}

/**
 * 抽屉里的「所在群」（spec §9）。这一节同时是**导出所选**的家（R48）：
 * `group:export` 收的是群键数组，能"选出若干群"的地方只有这份列表，不是单个群的弹层。
 */
export default function CustomerGroupsSection({ customerId }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { data: accounts = [] } = useAccounts()
  const selectedId = useSelectionStore((s) => s.selectedId)
  // 只认「在线的 WhatsApp 且视图挂着」那一档：`status===1` 是在线，`viewId` 空 = 没有可下命令的视图
  // （群成员采集靠页内桥 push，协议号/TG 都没有这条链路）。
  // 协议号(7) 现已能被后端识别（platform→whatsapp，B27 入站腿），但群成员采集仍依赖 WebContentsView 桥，
  // 协议号不经网页登录、不建视图，所以本期不入候选；Telegram 本期不做采集（§14）。
  const candidates = useMemo(
    () =>
      accounts.filter(
        (a) => a.platformType === PlatformType.WhatsApp && a.status === 1 && a.viewId !== ''
      ),
    [accounts]
  )
  const [manualId, setManualId] = useState<number | null>(null)
  // 优先级「节内下拉 > 工作台 selectedId > candidates[0]」：下拉是用户刚在这节里点的那一下，
  // 比工作台上一次选择更近；不这么排的话在这窄抽屉里换了账号、读数却还是工作台那一份。
  const accountId = useMemo<number | null>(() => {
    const hit = (id: number | null): number | null =>
      id != null && candidates.some((a) => a.id === id) ? id : null
    return hit(manualId) ?? hit(selectedId) ?? candidates[0]?.id ?? null
  }, [manualId, selectedId, candidates])

  const { data: rows = [], isPending, isError } = useCustomerGroups(accountId, customerId)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [dialog, setDialog] = useState<{ accountId: number; row: GroupRowVO } | null>(null)
  const [blocked, setBlocked] = useState('')
  const groupExport = useGroupExport()

  // 切账号作废全部现场：勾的群键属于上一个账号（chat_key 在两个账号下是两行），
  // 拿 A 账号勾的键去 B 账号导出不是不方便，是错的——seq 与「导出所选（n）」会双双对不上。
  //
  // 用**渲染期对比**而不是 useEffect：effect 里同步 setState 会触发一次级联渲染（lint 规则
  // `react-hooks/set-state-in-effect` 正是挡这个），而 React 官方对"某个 prop 变了就调整 state"
  // 推荐的写法就是这里这种——渲染中发现不一致就立刻 setState，React 会在提交前重跑一次。
  const [prevAccountId, setPrevAccountId] = useState(accountId)
  if (prevAccountId !== accountId) {
    setPrevAccountId(accountId)
    setPicked(new Set())
    setDialog(null)
    setBlocked('')
  }

  const toggle = (chatKey: string): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(chatKey)) next.delete(chatKey)
      else next.add(chatKey)
      return next
    })
  }

  const exportPicked = (): void => {
    if (accountId === null || picked.size === 0) return
    if (picked.size > MAX_EXPORT_GROUPS) {
      setBlocked(tooManyCopy(picked.size)) // 前拦：一次 IPC 都不发
      return
    }
    setBlocked('')
    groupExport.exportRows({ accountId, chatKeys: [...picked] })
  }

  // 弹层那一行要跟着失效后的列表走：「刷新成员」建完档，顶栏那个时间戳必须变，
  // 否则"生效了"与"什么都没做"在界面上长得一样。找不到（换账号重读空了）就退回手里那份。
  const liveRow = dialog ? rows.find((r) => r.chatKey === dialog.row.chatKey) ?? dialog.row : null
  const accountName = candidates.find((a) => a.id === accountId)?.name ?? ''
  const exportMsg = blocked || (groupExport.result ? exportOutcomeCopy(groupExport.result) : '')

  return (
    <section data-p8g-section="">
      <Separator className="my-5" />
      <div className="mb-2 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t('customers.groups.title')}
          {accountName && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{accountName}</span>}
        </h3>
        {candidates.length > 1 && (
          <Select value={String(accountId ?? '')} onValueChange={(v) => setManualId(Number(v))}>
            <SelectTrigger size="sm" className="w-32" data-p8g-account="">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          variant="secondary"
          data-p8g-export-selected=""
          disabled={accountId === null || picked.size === 0 || groupExport.pending}
          onClick={exportPicked}
        >
          <Download className="size-3.5" />
          {groupExport.pending ? t('customers.groups.exporting') : t('customers.groups.exportSelected', { count: picked.size })}
        </Button>
      </div>

      {/* 顺序即判据：`enabled:false` 的查询在 react-query v5 里永远停在 pending，
          所以"没有在线账号"必须排在 loading 前——否则"什么都没做"被显示成"正在做"。 */}
      {accountId === null ? (
        <p className="text-xs text-muted-foreground" data-p8g-no-account="">
          {t('customers.groups.noOnlineAccount')}
        </p>
      ) : isPending ? (
        <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <p className="text-xs text-destructive" data-p8g-error="">
          {t('customers.groups.loadError')}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-p8g-empty="">
          {t('customers.groups.empty')}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const area = memberAreaState(row)
            return (
              <li
                key={row.chatKey}
                data-p8g-group-row={row.chatKey}
                className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-2"
              >
                <input
                  type="checkbox"
                  data-p8g-check={row.chatKey}
                  checked={picked.has(row.chatKey)}
                  onChange={() => toggle(row.chatKey)}
                  aria-label={t('customers.groups.selectAria', { name: row.title ?? row.chatKey })}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Users className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{row.title ?? row.chatKey}</span>
                    {row.isFinal && (
                      <Badge variant="outline" data-p8g-final="">
                        {t('customers.groups.disbanded')}
                      </Badge>
                    )}
                    {area !== 'built' && (
                      <Badge variant="outline" data-p8g-area={area}>
                        {memberAreaShort(area)}
                      </Badge>
                    )}
                  </p>
                  {/* 两个数分开写：不等 = 这一轮的快照被覆盖率闸拦下、没记账（GroupVO 的类注释、R20）。 */}
                  <p className="truncate text-[11px] text-muted-foreground">
                    {t('customers.groups.inGroup', {
                      in: row.inGroupCount,
                      snapshot: row.participantCount,
                      time: timeCopy(row.lastSnapshotAt)
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  data-p8g-open={row.chatKey}
                  onClick={() => setDialog({ accountId, row })}
                >
                  {t('customers.groups.viewMembers')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {exportMsg && (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-p8g-export-msg=""
          data-p8g-blocked={blocked ? '1' : undefined}
        >
          {exportMsg}
        </p>
      )}

      {dialog && liveRow && (
        <GroupMembersDialog accountId={dialog.accountId} row={liveRow} onClose={() => setDialog(null)} />
      )}
    </section>
  )
}
