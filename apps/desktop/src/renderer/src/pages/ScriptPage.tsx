import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, ListOrdered, PlayCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  SCRIPT_ACTIONS,
  ACTION_TYPES,
  useActionTpls,
  usePlaybookMutations,
  usePlaybooks,
  usePlaybookSteps,
  useRoleCategories,
  useRoleMutations,
  useRoles,
  useTaskMutations,
  useTaskSteps,
  useTasks
} from '@/api/scriptEngine'

type Tab = 'library' | 'playbook' | 'tasks'

/**
 * B8 炒群引擎工作区（三个 tab：角色库三级 / 剧本 / 任务面板）。
 *
 * 任务面板刻意暴露「推进一格」「回报结果」——本期真执行器还没接（动手归 B18/B19），
 * 但状态机、断点续跑、failover 都能在 UI 上被驱动和观察，不至于是一堆点不动的按钮。
 */
export default function ScriptPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('library')
  const tabs: { key: Tab; labelKey: string; icon: typeof Layers }[] = [
    { key: 'library', labelKey: 'script.tab.library', icon: Layers },
    { key: 'playbook', labelKey: 'script.tab.playbook', icon: ListOrdered },
    { key: 'tasks', labelKey: 'script.tab.tasks', icon: PlayCircle }
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="border-b border-border/60 px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Layers className="size-5 text-primary" />
          {t('script.title')}
        </h1>
        <nav className="mt-3 flex flex-wrap gap-1">
          {tabs.map(({ key, labelKey, icon: Icon }) => (
            <Button
              key={key}
              size="sm"
              variant={tab === key ? 'default' : 'ghost'}
              onClick={() => setTab(key)}
              data-testid={`script-tab-${key}`}
            >
              <Icon className="size-4" />
              {t(labelKey)}
            </Button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {tab === 'library' && <LibraryTab />}
        {tab === 'playbook' && <PlaybookTab />}
        {tab === 'tasks' && <TasksTab />}
      </div>
    </div>
  )
}

/* ---------------- 角色库三级 ---------------- */

function LibraryTab(): React.JSX.Element {
  const { t } = useTranslation()
  const cats = useRoleCategories()
  const m = useRoleMutations()
  const [selCat, setSelCat] = useState<number | null>(null)
  const roles = useRoles(selCat)
  const tpls = useActionTpls(null)
  const [catName, setCatName] = useState('')
  const [roleName, setRoleName] = useState('')
  const [tplName, setTplName] = useState('')
  const [tplType, setTplType] = useState('post_message')
  const [tplRole, setTplRole] = useState<number | null>(null)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>{t('script.category.title')}</CardTitle>
          <CardDescription>{t('script.category.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (catName.trim()) {
                m.createCategory.mutate({ name: catName })
                setCatName('')
              }
            }}
          >
            <Input
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder={t('script.category.name')}
              data-testid="cat-name"
            />
            <Button type="submit" size="sm">
              {t('script.add')}
            </Button>
          </form>
          <ul className="flex flex-col divide-y divide-border/50 text-sm">
            {(cats.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => setSelCat(c.id)}
                  className={`min-w-0 flex-1 truncate text-left ${selCat === c.id ? 'font-semibold text-primary' : ''}`}
                >
                  {c.name}
                </button>
                <Button variant="ghost" size="sm" onClick={() => m.deleteCategory.mutate(c.id)}>
                  {t('script.delete')}
                </Button>
              </li>
            ))}
            {(cats.data ?? []).length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">{t('script.empty')}</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('script.role.title')}</CardTitle>
          <CardDescription>{t('script.role.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (roleName.trim() && selCat) {
                m.createRole.mutate({ name: roleName, categoryId: selCat })
                setRoleName('')
              }
            }}
          >
            <Input
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder={selCat ? t('script.role.name') : t('script.role.pickCatFirst')}
              disabled={!selCat}
              data-testid="role-name"
            />
            <Button type="submit" size="sm" disabled={!selCat}>
              {t('script.add')}
            </Button>
          </form>
          <ul className="flex flex-col divide-y divide-border/50 text-sm" data-testid="role-list">
            {(roles.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => setTplRole(r.id)}
                  className={`min-w-0 flex-1 truncate text-left ${tplRole === r.id ? 'font-semibold text-primary' : ''}`}
                >
                  {r.name}
                </button>
                <Button variant="ghost" size="sm" onClick={() => m.deleteRole.mutate(r.id)}>
                  {t('script.delete')}
                </Button>
              </li>
            ))}
            {(roles.data ?? []).length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">{t('script.empty')}</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('script.tpl.title')}</CardTitle>
          <CardDescription>{t('script.tpl.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (tplName.trim() && tplRole) {
                m.createTpl.mutate({ name: tplName, actionType: tplType, roleId: tplRole })
                setTplName('')
              }
            }}
          >
            <Input
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              placeholder={tplRole ? t('script.tpl.name') : t('script.tpl.pickRoleFirst')}
              disabled={!tplRole}
              data-testid="tpl-name"
            />
            <select
              className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
              value={tplType}
              onChange={(e) => setTplType(e.target.value)}
              data-testid="tpl-type"
            >
              {ACTION_TYPES.map((a) => (
                <option key={a} value={a}>
                  {SCRIPT_ACTIONS[a].label}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" disabled={!tplRole}>
              {t('script.add')}
            </Button>
          </form>
          <ul className="flex flex-col divide-y divide-border/50 text-sm">
            {(tpls.data ?? [])
              .filter((x) => !tplRole || x.roleId === tplRole)
              .map((x) => (
                <li key={x.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <Badge variant="outline">
                    {SCRIPT_ACTIONS[x.actionType]?.label ?? x.actionType}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => m.deleteTpl.mutate(x.id)}>
                    {t('script.delete')}
                  </Button>
                </li>
              ))}
            {(tpls.data ?? []).length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">{t('script.empty')}</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

/* ---------------- 剧本 ---------------- */

function PlaybookTab(): React.JSX.Element {
  const { t } = useTranslation()
  const pbs = usePlaybooks()
  const roles = useRoles(null)
  const m = usePlaybookMutations()
  const [sel, setSel] = useState<number | null>(null)
  const steps = usePlaybookSteps(sel)
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState<number | null>(null)
  const [loopSec, setLoopSec] = useState('3600')
  const [accounts, setAccounts] = useState('')
  const [newType, setNewType] = useState('post_message')

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('script.playbook.title')}</CardTitle>
          <CardDescription>{t('script.playbook.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim() && roleId) {
                m.create.mutate({
                  name,
                  roleId,
                  loopIntervalSec: Number(loopSec) || 3600,
                  accountIds: accounts || null
                })
                setName('')
              }
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('script.playbook.name')}
              data-testid="pb-name"
            />
            <select
              className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
              value={roleId ?? ''}
              onChange={(e) => setRoleId(e.target.value ? Number(e.target.value) : null)}
              data-testid="pb-role"
            >
              <option value="">{t('script.playbook.pickRole')}</option>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              {t('script.playbook.interval')}
              <Input
                type="number"
                className="w-28"
                value={loopSec}
                onChange={(e) => setLoopSec(e.target.value)}
              />
            </label>
            <Input
              value={accounts}
              onChange={(e) => setAccounts(e.target.value)}
              placeholder="7,2"
              data-testid="pb-accounts"
            />{' '}
            <p className="text-xs text-muted-foreground">{t('script.playbook.accountHint')}</p>
            <Button type="submit" size="sm" disabled={!roleId}>
              {t('script.add')}
            </Button>
          </form>
          <ul className="flex flex-col divide-y divide-border/50 text-sm">
            {(pbs.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => setSel(p.id)}
                  className={`min-w-0 flex-1 truncate text-left ${sel === p.id ? 'font-semibold text-primary' : ''}`}
                >
                  {p.name}
                </button>
                <span className="text-xs text-muted-foreground">{p.loopIntervalSec}s</span>
                <Button variant="ghost" size="sm" onClick={() => m.remove.mutate(p.id)}>
                  {t('script.delete')}
                </Button>
              </li>
            ))}
            {(pbs.data ?? []).length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">{t('script.empty')}</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('script.step.title')}</CardTitle>
          <CardDescription>{t('script.step.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {sel == null ? (
            <p className="text-xs text-muted-foreground">{t('script.step.pickPlaybook')}</p>
          ) : (
            <>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  m.addStep.mutate({
                    playbookId: sel,
                    seq: steps.data?.length ?? 0,
                    actionType: newType
                  })
                }}
              >
                <select
                  className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                >
                  {ACTION_TYPES.map((a) => (
                    <option key={a} value={a}>
                      {SCRIPT_ACTIONS[a].label}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm">
                  {t('script.step.add')}
                </Button>
              </form>
              <ul
                className="flex flex-col divide-y divide-border/50 text-sm"
                data-testid="step-list"
              >
                {(steps.data ?? []).map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-2">
                    <span className="w-6 text-xs text-muted-foreground">#{s.seq}</span>
                    <span className="min-w-0 flex-1">
                      {SCRIPT_ACTIONS[s.actionType]?.label ?? s.actionType}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => m.removeStep.mutate(s.id)}>
                      {t('script.delete')}
                    </Button>
                  </li>
                ))}
                {(steps.data ?? []).length === 0 && (
                  <li className="py-2 text-xs text-muted-foreground">{t('script.empty')}</li>
                )}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ---------------- 任务面板 ---------------- */

function TasksTab(): React.JSX.Element {
  const { t } = useTranslation()
  const pbs = usePlaybooks()
  const tasks = useTasks(null)
  const m = useTaskMutations()
  const [sel, setSel] = useState<number | null>(null)
  const steps = useTaskSteps(sel)
  const [chatKey, setChatKey] = useState('')
  const [pbId, setPbId] = useState<number | null>(null)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('script.task.title')}</CardTitle>
          <CardDescription>{t('script.task.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (chatKey.trim() && pbId) {
                m.start.mutate({ playbookId: pbId, targetChatKey: chatKey })
                setChatKey('')
              }
            }}
          >
            <select
              className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
              value={pbId ?? ''}
              onChange={(e) => setPbId(e.target.value ? Number(e.target.value) : null)}
              data-testid="task-pb"
            >
              <option value="">{t('script.task.pickPlaybook')}</option>
              {(pbs.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Input
              value={chatKey}
              onChange={(e) => setChatKey(e.target.value)}
              placeholder="12345@g.us"
              disabled={!pbId}
              data-testid="task-chatkey"
            />
            <Button type="submit" size="sm" disabled={!pbId} data-testid="task-start">
              {t('script.task.start')}
            </Button>
          </form>
          <ul className="flex flex-col divide-y divide-border/50 text-sm" data-testid="task-list">
            {(tasks.data ?? []).map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => setSel(x.id)}
                  className={`min-w-0 flex-1 truncate text-left ${sel === x.id ? 'font-semibold text-primary' : ''}`}
                >
                  {x.targetChatKey}
                </button>
                <Badge variant="outline">{x.status}</Badge>
                <span className="text-xs text-muted-foreground">#{x.currentStep}</span>
                {x.status === 'pending' || x.status === 'running' ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => m.advance.mutate(x.id)}>
                      {t('script.task.advance')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => m.cancel.mutate(x.id)}>
                      {t('script.task.cancel')}
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
            {(tasks.data ?? []).length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">{t('script.empty')}</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('script.taskStep.title')}</CardTitle>
          <CardDescription>{t('script.taskStep.desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {sel == null ? (
            <p className="text-xs text-muted-foreground">{t('script.taskStep.pickTask')}</p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-border/50 text-sm"
              data-testid="task-step-list"
            >
              {(steps.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-2">
                  <span className="w-6 text-xs text-muted-foreground">#{s.seq}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {SCRIPT_ACTIONS[s.actionType]?.label ?? s.actionType}
                  </span>
                  <Badge variant={s.status === 'success' ? 'default' : 'outline'}>{s.status}</Badge>
                  {s.status === 'sending' && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          m.report.mutate({ taskId: sel, seq: s.seq, status: 'success' })
                        }
                      >
                        {t('script.taskStep.ok')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          m.report.mutate({ taskId: sel, seq: s.seq, status: 'failed' })
                        }
                      >
                        {t('script.taskStep.fail')}
                      </Button>
                    </>
                  )}
                </li>
              ))}
              {(steps.data ?? []).length === 0 && (
                <li className="py-2 text-xs text-muted-foreground">{t('script.empty')}</li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
