import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sprout } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { parseJsonArray, useNurtureMutations, useNurturePlans, useNurtureRuns } from '@/api/nurturePlan'

/**
 * B9 互聊养号：计划表单 + 状态总览。
 *
 * 建计划时给出**装箱预览**：账号按平台分组（群 chatKey 属某平台，跨平台不能同群），
 * 让建计划的人当场看到"这些号会被怎么分箱"，而不是建完才发现混了平台。
 *
 * 人工门：计划建完是「待确认」，确认按钮显式摆在列表行上（服务端还会再判一次）。
 */
export default function NurturePlanPage(): React.JSX.Element {
  const { t } = useTranslation()
  const plans = useNurturePlans()
  const m = useNurtureMutations()
  const [sel, setSel] = useState<number | null>(null)
  const runs = useNurtureRuns(sel)
  const [name, setName] = useState('')
  const [groupKey, setGroupKey] = useState('')
  const [createGroup, setCreateGroup] = useState(false)
  const [accountIds, setAccountIds] = useState('')
  const [atPoints, setAtPoints] = useState('09:30,20:00')
  const [rounds, setRounds] = useState('1')
  const [seed, setSeed] = useState('1')
  const [perGroup, setPerGroup] = useState('10')

  const ids = accountIds.split(/[\s,]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0)
  const points = atPoints.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="border-b border-border/60 px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Sprout className="size-5 text-primary" />
          {t('nurture.title')}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('nurture.desc')}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('nurture.form.title')}</CardTitle>
              <CardDescription>{t('nurture.form.desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <form className="flex flex-col gap-2" data-testid="nurture-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (ids.length === 0 || points.length === 0) return
                  m.create.mutate({
                    name: name || undefined,
                    groupChatKey: groupKey || undefined,
                    createGroup,
                    accountIds: ids,
                    perGroup: Number(perGroup) || 10,
                    seed: Number(seed) || 1,
                    atPoints: points,
                    speakingRounds: Number(rounds) || 1
                  })
                  setName(''); setGroupKey(''); setAccountIds('')
                }}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('nurture.form.name')} data-testid="nurture-name" />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={createGroup} onChange={(e) => setCreateGroup(e.target.checked)} data-testid="nurture-creategroup" />
                  {t('nurture.form.createGroup')}
                </label>
                <Input value={groupKey} onChange={(e) => setGroupKey(e.target.value)} placeholder="xxx@g.us"
                  disabled={createGroup} data-testid="nurture-group" />
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t('nurture.form.accounts')}
                  <Input value={accountIds} onChange={(e) => setAccountIds(e.target.value)} placeholder="2,6,7" data-testid="nurture-accounts" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t('nurture.form.atPoints')}
                  <Input value={atPoints} onChange={(e) => setAtPoints(e.target.value)} placeholder="09:30,20:00" data-testid="nurture-atpoints" />
                </label>
                <div className="flex gap-2">
                  <label className="flex-1 text-xs text-muted-foreground">
                    {t('nurture.form.rounds')}
                    <Input type="number" className="mt-1" value={rounds} onChange={(e) => setRounds(e.target.value)} />
                  </label>
                  <label className="flex-1 text-xs text-muted-foreground">
                    {t('nurture.form.perGroup')}
                    <Input type="number" className="mt-1" value={perGroup} onChange={(e) => setPerGroup(e.target.value)} data-testid="nurture-pergroup" />
                  </label>
                  <label className="flex-1 text-xs text-muted-foreground">
                    seed
                    <Input type="number" className="mt-1" value={seed} onChange={(e) => setSeed(e.target.value)} />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground" data-testid="nurture-summary">
                  {t('nurture.form.summary', { accounts: ids.length, points: points.length, rounds: Number(rounds) || 1 })}
                </p>
                <Button type="submit" size="sm" disabled={ids.length === 0 || points.length === 0} data-testid="nurture-create">
                  {t('nurture.form.create')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('nurture.list.title')}</CardTitle>
              <CardDescription>{t('nurture.list.desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col divide-y divide-border/50 text-sm" data-testid="nurture-list">
                {(plans.data ?? []).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-2">
                    <button type="button" onClick={() => setSel(p.id)}
                      className={`min-w-0 flex-1 truncate text-left ${sel === p.id ? 'font-semibold text-primary' : ''}`}>
                      {p.name}
                    </button>
                    <span className="text-xs text-muted-foreground">{parseJsonArray(p.accountIds).length}</span>
                    <Badge variant={p.status === 'confirmed' || p.status === 'running' ? 'default' : 'outline'}>{p.status}</Badge>
                    {p.status === 'pending' && (
                      <Button size="sm" data-testid="nurture-confirm" onClick={() => m.confirm.mutate(p.id)}>
                        {t('nurture.confirm')}
                      </Button>
                    )}
                  </li>
                ))}
                {(plans.data ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('nurture.empty')}</li>}
              </ul>

              {sel != null && (
                <div className="flex flex-col gap-2" data-testid="nurture-runs">
                  <p className="text-xs font-medium">{t('nurture.runs.title')}</p>
                  <ul className="flex max-h-72 flex-col divide-y divide-border/50 overflow-auto text-xs">
                    {(runs.data ?? []).map((r) => (
                      <li key={r.id} className="flex items-center gap-2 py-1.5">
                        <span className="w-8 text-muted-foreground">#{r.slotIndex}</span>
                        <span className="w-12 font-mono">{r.atPoint}</span>
                        <span className="w-10 text-muted-foreground">R{r.roundIdx}</span>
                        <span className="min-w-0 flex-1 truncate">acct {r.accountId}</span>
                        <Badge variant={r.status === 'success' ? 'default' : 'outline'}>{r.status}</Badge>
                        {r.errorDetail && <span className="truncate text-destructive">{r.errorDetail}</span>}
                      </li>
                    ))}
                    {(runs.data ?? []).length === 0 && <li className="py-1.5 text-muted-foreground">{t('nurture.empty')}</li>}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
