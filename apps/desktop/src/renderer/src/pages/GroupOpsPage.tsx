import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserPlus, UserMinus, ShieldAlert } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  parseParticipantIds,
  useJoinItems,
  useJoinMutations,
  useJoinTasks,
  useKickItems,
  useKickMutations,
  useKickTasks
} from '@/api/groupOps'

type Tab = 'join' | 'kick'

/**
 * B18 加群 / B19 踢人。
 *
 * **两处人工门在 UI 上是显式动作**，不是走过场：
 * - 加群：建完是「待确认」，必须点确认才进执行链（服务端 `requireConfirmed` 还会再判一次）；
 * - 踢人：名单建完是「待审阅」，右侧**逐条列出成员**让人看清要踢谁，批准/驳回都摆在明面上
 *   （服务端 `requireApproved` 再判一次）。踢人不可逆，这层审阅是产品的核心而不是形式。
 */
export default function GroupOpsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('join')
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="border-b border-border/60 px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <ShieldAlert className="size-5 text-primary" />
          {t('groupOps.title')}
        </h1>
        <nav className="mt-3 flex gap-1">
          <Button size="sm" variant={tab === 'join' ? 'default' : 'ghost'} onClick={() => setTab('join')} data-testid="groupops-tab-join">
            <UserPlus className="size-4" />{t('groupOps.tab.join')}
          </Button>
          <Button size="sm" variant={tab === 'kick' ? 'default' : 'ghost'} onClick={() => setTab('kick')} data-testid="groupops-tab-kick">
            <UserMinus className="size-4" />{t('groupOps.tab.kick')}
          </Button>
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {tab === 'join' ? <JoinTab /> : <KickTab />}
      </div>
    </div>
  )
}

/* ==================== B18 加群 ==================== */

function JoinTab(): React.JSX.Element {
  const { t } = useTranslation()
  const tasks = useJoinTasks()
  const m = useJoinMutations()
  const [accountId, setAccountId] = useState('7')
  const [name, setName] = useState('')
  const [codes, setCodes] = useState('')
  const [minSec, setMinSec] = useState('60')
  const [maxSec, setMaxSec] = useState('120')
  const [sel, setSel] = useState<number | null>(null)
  const items = useJoinItems(sel)

  const codeCount = parseParticipantIds(codes).length

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('groupOps.join.title')}</CardTitle>
          <CardDescription>{t('groupOps.join.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex flex-col gap-2" data-testid="join-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (accountId && codeCount > 0) {
                m.create.mutate({
                  accountId: Number(accountId),
                  name: name || undefined,
                  inviteCodes: codes,
                  intervalMinSec: Number(minSec) || 60,
                  intervalMaxSec: Number(maxSec) || 120
                })
                setCodes('')
                setName('')
              }
            }}>
            <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder={t('groupOps.accountId')} data-testid="join-account" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('groupOps.join.name')} data-testid="join-name" />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t('groupOps.join.codes')}
              <textarea value={codes} onChange={(e) => setCodes(e.target.value)} rows={5}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder={t('groupOps.join.codesPlaceholder')} data-testid="join-codes" />
            </label>
            <p className="text-xs text-muted-foreground" data-testid="join-codecount">
              {t('groupOps.join.parsed', { count: codeCount })}
            </p>
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-muted-foreground">
                {t('groupOps.join.minSec')}
                <Input type="number" value={minSec} onChange={(e) => setMinSec(e.target.value)} className="mt-1" />
              </label>
              <label className="flex-1 text-xs text-muted-foreground">
                {t('groupOps.join.maxSec')}
                <Input type="number" value={maxSec} onChange={(e) => setMaxSec(e.target.value)} className="mt-1" />
              </label>
            </div>
            <Button type="submit" size="sm" disabled={!accountId || codeCount === 0} data-testid="join-create">
              {t('groupOps.join.create')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('groupOps.join.list')}</CardTitle>
          <CardDescription>{t('groupOps.join.listDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y divide-border/50 text-sm" data-testid="join-list">
            {(tasks.data ?? []).map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-2">
                <button type="button" onClick={() => setSel(x.id)}
                  className={`min-w-0 flex-1 truncate text-left ${sel === x.id ? 'font-semibold text-primary' : ''}`}>
                  {x.name}
                </button>
                <Badge variant="outline">{x.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  {x.succeeded}/{x.total}
                </span>
                {x.status === 'pending' && (
                  <Button size="sm" data-testid="join-confirm" onClick={() => m.confirm.mutate(x.id)}>
                    {t('groupOps.confirm')}
                  </Button>
                )}
              </li>
            ))}
            {(tasks.data ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('groupOps.empty')}</li>}
          </ul>

          {sel != null && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium">{t('groupOps.join.items')}</p>
              <ul className="flex flex-col divide-y divide-border/50 text-xs" data-testid="join-items">
                {(items.data ?? []).map((it) => (
                  <li key={it.id} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono">{it.inviteCode}</span>
                    {it.groupName && <span className="truncate text-muted-foreground">{it.groupName}</span>}
                    <Badge variant={it.status === 'joined' ? 'default' : 'outline'}>{it.status}</Badge>
                    {it.errorDetail && <span className="truncate text-destructive">{it.errorDetail}</span>}
                  </li>
                ))}
                {(items.data ?? []).length === 0 && <li className="py-1.5 text-muted-foreground">{t('groupOps.empty')}</li>}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ==================== B19 踢人 ==================== */

function KickTab(): React.JSX.Element {
  const { t } = useTranslation()
  const tasks = useKickTasks()
  const m = useKickMutations()
  const [accountId, setAccountId] = useState('7')
  const [groupId, setGroupId] = useState('')
  const [name, setName] = useState('')
  const [list, setList] = useState('')
  const [sel, setSel] = useState<number | null>(null)
  const items = useKickItems(sel)

  const ids = parseParticipantIds(list)
  const pending = (items.data ?? []).filter((x) => x.status === 'pending')

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('groupOps.kick.title')}</CardTitle>
          <CardDescription>{t('groupOps.kick.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex flex-col gap-2" data-testid="kick-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (accountId && groupId.trim() && ids.length > 0) {
                m.create.mutate({
                  accountId: Number(accountId),
                  groupId: groupId.trim(),
                  name: name || undefined,
                  participantIds: ids
                })
                setList('')
                setName('')
              }
            }}>
            <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder={t('groupOps.accountId')} data-testid="kick-account" />
            <Input value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="xxx@g.us" data-testid="kick-group" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('groupOps.kick.name')} data-testid="kick-name" />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t('groupOps.kick.roster')}
              <textarea value={list} onChange={(e) => setList(e.target.value)} rows={5}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder={t('groupOps.kick.rosterPlaceholder')} data-testid="kick-roster" />
            </label>
            <p className="text-xs text-muted-foreground" data-testid="kick-count">{t('groupOps.kick.parsed', { count: ids.length })}</p>
            <Button type="submit" size="sm" disabled={!accountId || !groupId.trim() || ids.length === 0} data-testid="kick-create">
              {t('groupOps.kick.create')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('groupOps.kick.list')}</CardTitle>
          <CardDescription>{t('groupOps.kick.listDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y divide-border/50 text-sm" data-testid="kick-list">
            {(tasks.data ?? []).map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-2">
                <button type="button" onClick={() => setSel(x.id)}
                  className={`min-w-0 flex-1 truncate text-left ${sel === x.id ? 'font-semibold text-primary' : ''}`}>
                  {x.name}
                </button>
                {/* 人工门状态用醒目 Badge：待审阅的东西不该长得跟已批准的一样 */}
                <Badge variant={x.approvalStatus === 'approved' ? 'default' : x.approvalStatus === 'rejected' ? 'outline' : 'secondary'}>
                  {x.approvalStatus}
                </Badge>
                <span className="text-xs text-muted-foreground">{x.succeeded}/{x.total}</span>
              </li>
            ))}
            {(tasks.data ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('groupOps.empty')}</li>}
          </ul>

          {sel != null && (
            <div className="flex flex-col gap-2" data-testid="kick-review">
              <p className="text-xs font-medium">{t('groupOps.kick.review')}</p>
              {/* 不可逆提示：把"你在批一份不可逆的名单"摆在名单上方，而不是藏在帮助里 */}
              <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {t('groupOps.kick.irreversible')}
              </p>
              <ul className="flex max-h-64 flex-col divide-y divide-border/50 overflow-auto text-xs">
                {(items.data ?? []).map((it) => (
                  <li key={it.id} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono">{it.participantId}</span>
                    {it.reason && <span className="truncate text-muted-foreground">{it.reason}</span>}
                    <Badge variant={it.status === 'removed' ? 'default' : 'outline'}>{it.status}</Badge>
                    {it.canRemove === false && (
                      <Badge variant="outline" className="text-destructive">{t('groupOps.kick.cannotRemove')}</Badge>
                    )}
                  </li>
                ))}
                {(items.data ?? []).length === 0 && <li className="py-1.5 text-muted-foreground">{t('groupOps.empty')}</li>}
              </ul>
              {(() => {
                const task = (tasks.data ?? []).find((x) => x.id === sel)
                if (!task || task.approvalStatus !== 'pending') return null
                return (
                  <div className="flex gap-2">
                    <Button size="sm" data-testid="kick-approve" onClick={() => m.approve.mutate(sel)}>
                      {t('groupOps.approve', { count: pending.length })}
                    </Button>
                    <Button size="sm" variant="outline" data-testid="kick-reject" onClick={() => m.reject.mutate(sel)}>
                      {t('groupOps.reject')}
                    </Button>
                  </div>
                )
              })()}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
