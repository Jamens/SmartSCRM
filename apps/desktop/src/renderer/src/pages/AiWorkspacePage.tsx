import { useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { Bot, FileText, UserCog, Gauge, Inbox } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { deriveQaPreview } from '@shared/aiKnowledge'
import {
  useAiCategories, useAiPersonas, useAiNurture, useDocChunks, useDocMutations, useKnowledgeDocs,
  useKnowledgeQa, useQaMutations, useRoleMutations, useAiRoles, useCategoryMutations, useGeneratePersona,
  usePersonaMutations, useSaveNurture, useTakeoverActions, useTakeoverQueue
} from '@/api/aiKnowledge'

type Tab = 'kb' | 'docs' | 'persona' | 'nurture' | 'queue'

/**
 * B28 `/ai` 工作区：知识库三栏 + 文档管线 + 人设 + 养号 + 接管台。
 *
 * 数据全走 `@/api/aiKnowledge`（唯一出口，端点接 A16 knowledge/message 判定）。
 * 派生 QA 的**预览**在渲染层用 `@shared/aiKnowledge` 的 deriveQaPreview 算，**确认后**才调
 * createDerived 落库——刻意不在后端自动落（spec §8）。
 */
export default function AiWorkspacePage(): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('kb')
  const tabs: { key: Tab; labelKey: string; icon: typeof Bot }[] = [
    { key: 'kb', labelKey: 'ai.tab.kb', icon: Bot },
    { key: 'docs', labelKey: 'ai.tab.docs', icon: FileText },
    { key: 'persona', labelKey: 'ai.tab.persona', icon: UserCog },
    { key: 'nurture', labelKey: 'ai.tab.nurture', icon: Gauge },
    { key: 'queue', labelKey: 'ai.tab.queue', icon: Inbox }
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="border-b border-border/60 px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Bot className="size-5 text-primary" />
          {t('ai.title')}
        </h1>
        <nav className="mt-3 flex flex-wrap gap-1">
          {tabs.map(({ key, labelKey, icon: Icon }) => (
            <Button key={key} size="sm" variant={tab === key ? 'default' : 'ghost'} onClick={() => setTab(key)} data-testid={`ai-tab-${key}`}>
              <Icon className="size-4" />
              {t(labelKey)}
            </Button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {tab === 'kb' && <KbTab />}
        {tab === 'docs' && <DocsTab />}
        {tab === 'persona' && <PersonaTab />}
        {tab === 'nurture' && <NurtureTab />}
        {tab === 'queue' && <QueueTab />}
      </div>
    </div>
  )
}

/* ---------------- 知识库三栏（QA / 角色 / 分类） ---------------- */

function KbTab(): React.JSX.Element {
  const { t } = useTranslation()
  const roles = useAiRoles()
  const cats = useAiCategories()
  const qa = useKnowledgeQa()
  const qaM = useQaMutations()
  const roleM = useRoleMutations()
  const catM = useCategoryMutations()
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const [roleName, setRoleName] = useState('')
  const [catName, setCatName] = useState('')

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader><CardTitle>{t('ai.qa.title')}</CardTitle><CardDescription>{t('ai.qa.desc')}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim() && a.trim()) { qaM.create.mutate({ question: q, answer: a }); setQ(''); setA('') } }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ai.qa.question')} data-testid="qa-q" />
            <Input value={a} onChange={(e) => setA(e.target.value)} placeholder={t('ai.qa.answer')} data-testid="qa-a" />
            <Button type="submit" size="sm" disabled={qaM.create.isPending}>{t('ai.qa.add')}</Button>
          </form>
          <ul className="flex flex-col divide-y divide-border/50 text-sm">
            {(qa.data ?? []).map((x) => (
              <li key={x.id} className="flex items-start gap-2 py-2" data-testid="qa-row">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{x.question}</span>
                  <span className="block truncate text-xs text-muted-foreground">{x.answer}</span>
                </span>
                {x.source === 'derived' && <Badge variant="outline">{t('ai.qa.derived')}</Badge>}
                <Button variant="ghost" size="sm" onClick={() => qaM.remove.mutate(x.id)}>{t('ai.delete')}</Button>
              </li>
            ))}
            {(qa.data ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('ai.empty')}</li>}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('ai.role.title')}</CardTitle><CardDescription>{t('ai.role.desc')}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (roleName.trim()) { roleM.create.mutate({ name: roleName }); setRoleName('') } }}>
            <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder={t('ai.role.name')} data-testid="role-name" />
            <Button type="submit" size="sm" disabled={roleM.create.isPending}>{t('ai.add')}</Button>
          </form>
          <ul className="flex flex-col divide-y divide-border/50 text-sm">
            {(roles.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <Button variant="ghost" size="sm" onClick={() => roleM.remove.mutate(r.id)}>{t('ai.delete')}</Button>
              </li>
            ))}
            {(roles.data ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('ai.empty')}</li>}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('ai.category.title')}</CardTitle><CardDescription>{t('ai.category.desc')}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (catName.trim()) { catM.create.mutate({ name: catName }); setCatName('') } }}>
            <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder={t('ai.category.name')} data-testid="cat-name" />
            <Button type="submit" size="sm" disabled={catM.create.isPending}>{t('ai.add')}</Button>
          </form>
          <ul className="flex flex-col divide-y divide-border/50 text-sm">
            {(cats.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <Button variant="ghost" size="sm" onClick={() => catM.remove.mutate(c.id)}>{t('ai.delete')}</Button>
              </li>
            ))}
            {(cats.data ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('ai.empty')}</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

/* ---------------- 文档管线 ---------------- */

function DocsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const docs = useKnowledgeDocs()
  const docM = useDocMutations()
  const qaM = useQaMutations()
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [selDoc, setSelDoc] = useState<number | null>(null)
  const chunks = useDocChunks(selDoc)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>{t('ai.docs.title')}</CardTitle><CardDescription>{t('ai.docs.desc')}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && content.trim()) { docM.create.mutate({ name, content }); setName(''); setContent('') } }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ai.docs.name')} data-testid="doc-name" />
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('ai.docs.content')} rows={5}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" data-testid="doc-content" />
            <Button type="submit" size="sm" disabled={docM.create.isPending}>{t('ai.docs.upload')}</Button>
          </form>
          <ul className="flex flex-col divide-y divide-border/50 text-sm">
            {(docs.data ?? []).map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-2">
                <button type="button" className={cn('min-w-0 flex-1 truncate text-left', selDoc === d.id && 'font-semibold text-primary')} onClick={() => setSelDoc(d.id)}>
                  {d.name}
                </button>
                <Badge variant="outline">{d.status}</Badge>
                <span className="text-xs text-muted-foreground">{d.chunkCount} {t('ai.docs.chunks')}</span>
                <Button variant="ghost" size="sm" onClick={() => docM.remove.mutate(d.id)}>{t('ai.delete')}</Button>
              </li>
            ))}
            {(docs.data ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('ai.empty')}</li>}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('ai.docs.chunkPreview')}</CardTitle><CardDescription>{t('ai.docs.chunkDesc')}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {selDoc == null ? (
            <p className="text-xs text-muted-foreground">{t('ai.docs.pickDoc')}</p>
          ) : (chunks.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('ai.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(chunks.data ?? []).map((c) => {
                const cands = deriveQaPreview(c.content)
                return (
                  <li key={c.id} className="rounded-lg border border-border/50 p-3 text-sm" data-testid="chunk-row">
                    <p className="mb-1 text-xs text-muted-foreground">#{c.seq} · {c.charCount} {t('ai.docs.chars')}{c.derived ? ` · ${t('ai.qa.derived')}` : ''}</p>
                    <p className="mb-2 whitespace-pre-wrap break-words text-xs">{c.content}</p>
                    {cands.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('ai.docs.noCandidate')}</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-medium">{t('ai.docs.candidates')}</p>
                        {cands.map((cd) => (
                          <div key={cd.question} className="flex items-start gap-2 rounded bg-muted/50 p-2">
                            <span className="min-w-0 flex-1 text-xs">
                              <span className="block font-medium">{cd.question}</span>
                              <span className="block text-muted-foreground">{cd.answer}</span>
                            </span>
                            <Button size="sm" variant="secondary" data-testid="derive-btn"
                              onClick={() => qaM.createDerived.mutate({ chunkId: c.id, question: cd.question, answer: cd.answer })}>
                              {t('ai.docs.derive')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ---------------- 人设 ---------------- */

function PersonaTab(): React.JSX.Element {
  const { t } = useTranslation()
  const personas = useAiPersonas()
  const personaM = usePersonaMutations()
  const generate = useGeneratePersona()
  const [tone, setTone] = useState('friendly')
  const draft = generate.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('ai.persona.title')}</CardTitle>
        <CardDescription>{t('ai.persona.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('ai.persona.tone')}
            <Input value={tone} onChange={(e) => setTone(e.target.value)} className="w-40" data-testid="persona-tone" />
          </label>
          <Button size="sm" onClick={() => generate.mutate(tone)} disabled={generate.isPending} data-testid="persona-generate">
            {t('ai.persona.generate')}
          </Button>
        </div>
        {draft && (
          <div className="rounded-lg border border-border/50 p-3 text-sm" data-testid="persona-draft">
            <p className="mb-1 text-xs text-muted-foreground">{t('ai.persona.draftHint')}</p>
            <p className="font-medium">{draft.name} <Badge variant="outline" className="ml-1">{draft.template}</Badge></p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{draft.prompt}</p>
            <Button size="sm" className="mt-2" data-testid="persona-save-draft"
              onClick={() => { personaM.create.mutate({ name: draft.name, tone: draft.tone, prompt: draft.prompt, template: draft.template }); generate.reset() }}>
              {t('ai.persona.saveDraft')}
            </Button>
          </div>
        )}
        <ul className="flex flex-col divide-y divide-border/50 text-sm">
          {(personas.data ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                {p.tone && <span className="block text-xs text-muted-foreground">{t('ai.persona.toneLabel')}: {p.tone}</span>}
              </span>
              <Button variant="ghost" size="sm" onClick={() => personaM.remove.mutate(p.id)}>{t('ai.delete')}</Button>
            </li>
          ))}
          {(personas.data ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('ai.empty')}</li>}
        </ul>
        <p className="text-xs text-muted-foreground">{t('ai.persona.hint', { templates: Object.keys({ friendly: 1, pro: 1, concise: 1 }).join(' / ') })}</p>
      </CardContent>
    </Card>
  )
}

/* ---------------- 养号设置 ---------------- */

function NurtureTab(): React.JSX.Element {
  const { t } = useTranslation()
  const { data, isPending } = useAiNurture()
  const save = useSaveNurture()
  const [daily, setDaily] = useState<string>('')
  const [ratio, setRatio] = useState<string>('')
  const [rec, setRec] = useState<string>('')

  if (isPending) return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
  const cur = data ?? { dailyLimit: 0, activeRatio: 50, quietHours: null, recommend: 'balanced' }
  return (
    <Card className="max-w-xl">
      <CardHeader><CardTitle>{t('ai.nurture.title')}</CardTitle><CardDescription>{t('ai.nurture.desc')}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          {t('ai.nurture.dailyLimit')}
          <Input type="number" className="w-28" value={daily === '' ? String(cur.dailyLimit) : daily}
            onChange={(e) => setDaily(e.target.value)} data-testid="nurture-daily" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          {t('ai.nurture.activeRatio')}
          <Input type="number" className="w-28" value={ratio === '' ? String(cur.activeRatio) : ratio}
            onChange={(e) => setRatio(e.target.value)} data-testid="nurture-ratio" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          {t('ai.nurture.recommend')}
          <select className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm" value={rec === '' ? cur.recommend : rec}
            onChange={(e) => setRec(e.target.value)} data-testid="nurture-recommend">
            {['conservative', 'balanced', 'aggressive'].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <Button size="sm" className="self-start" data-testid="nurture-save" disabled={save.isPending}
          onClick={() => save.mutate({ dailyLimit: Number(daily === '' ? cur.dailyLimit : daily), activeRatio: Number(ratio === '' ? cur.activeRatio : ratio), recommend: rec === '' ? cur.recommend : rec })}>
          {t('ai.save')}
        </Button>
      </CardContent>
    </Card>
  )
}

/* ---------------- 接管台 ---------------- */

function QueueTab(): React.JSX.Element {
  const { t } = useTranslation()
  const queue = useTakeoverQueue()
  const act = useTakeoverActions()
  return (
    <Card>
      <CardHeader><CardTitle>{t('ai.queue.title')}</CardTitle><CardDescription>{t('ai.queue.desc')}</CardDescription></CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border/50 text-sm" data-testid="queue-list">
          {(queue.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.title ?? c.chatKey}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.transferReason ?? '—'}{c.waitTakeoverAt ? ` · ${dayjs(c.waitTakeoverAt).format('MM-DD HH:mm')}` : ''}
                </span>
              </span>
              <Button size="sm" onClick={() => act.takeover.mutate(c.id)} disabled={act.takeover.isPending}>{t('ai.queue.takeover')}</Button>
              <Button size="sm" variant="ghost" onClick={() => act.resumeAi.mutate(c.id)}>{t('ai.queue.resume')}</Button>
            </li>
          ))}
          {(queue.data ?? []).length === 0 && <li className="py-2 text-xs text-muted-foreground">{t('ai.queue.empty')}</li>}
        </ul>
      </CardContent>
    </Card>
  )
}
