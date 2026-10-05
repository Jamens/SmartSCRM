import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  useCheckSensitiveWord,
  useCreateSensitiveWord,
  useDeleteSensitiveWord,
  useSensitiveWords,
  useToggleSensitiveWord
} from '@/api/sensitiveWords'

/**
 * A8 敏感词风控 —— 设置页里的一节（本地词库 + 命中试检）。
 *
 * 这里只做**词库维护 + 手动试检**；发送/入站链真正调用 `POST /check` 做提示/拦截是
 * 各业务功能接入时的事（与 A10 的投递触发点同构：能力先落地，调用方后接）。
 */
export default function SensitiveWordsCard(): React.JSX.Element {
  const { t } = useTranslation()
  const { data: words = [], isPending } = useSensitiveWords()
  const create = useCreateSensitiveWord()
  const toggle = useToggleSensitiveWord()
  const remove = useDeleteSensitiveWord()
  const check = useCheckSensitiveWord()

  const [word, setWord] = useState('')
  const [category, setCategory] = useState('')
  const [probe, setProbe] = useState('')

  const addWord = (e: FormEvent): void => {
    e.preventDefault()
    const w = word.trim()
    if (!w) return
    create.mutate({ word: w, category: category.trim() || null }, {
      onSuccess: () => {
        setWord('')
        setCategory('')
      }
    })
  }

  const runCheck = (): void => {
    if (probe.trim()) check.mutate(probe)
  }

  return (
    <Card data-testid="sensitive-words-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-primary" />
          {t('settings.sensitiveWords')}
        </CardTitle>
        <CardDescription>{t('settings.sensitiveWordsDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={addWord} className="flex flex-wrap items-center gap-2">
          <Input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={t('settings.sensitiveWordPlaceholder')}
            className="w-48"
            data-testid="sw-word-input"
          />
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t('settings.sensitiveWordCategoryPlaceholder')}
            className="w-40"
            data-testid="sw-category-input"
          />
          <Button type="submit" size="sm" disabled={create.isPending || !word.trim()}>
            <Plus className="size-4" />
            {t('settings.sensitiveWordAdd')}
          </Button>
        </form>

        {isPending ? (
          <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
        ) : words.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="sw-empty">
            {t('settings.sensitiveWordsEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/50 rounded-lg border border-border/50">
            {words.map((w) => (
              <li key={w.id} className="flex items-center gap-3 px-3 py-2" data-testid="sw-row">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{w.word}</span>
                {w.category && (
                  <Badge variant="secondary" className="shrink-0">
                    {w.category}
                  </Badge>
                )}
                <Switch
                  aria-label={w.word}
                  checked={w.enabled}
                  onCheckedChange={(v) => toggle.mutate({ id: w.id, enabled: v === true })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('settings.sensitiveWordDelete')}
                  onClick={() => remove.mutate(w.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-border/50 p-3">
          <p className="mb-2 text-xs font-medium text-foreground">{t('settings.sensitiveWordCheck')}</p>
          <div className="flex items-center gap-2">
            <Input
              value={probe}
              onChange={(e) => setProbe(e.target.value)}
              placeholder={t('settings.sensitiveWordCheckPlaceholder')}
              className="flex-1"
              data-testid="sw-probe-input"
            />
            <Button variant="secondary" size="sm" onClick={runCheck} disabled={check.isPending || !probe.trim()}>
              {t('settings.sensitiveWordRunCheck')}
            </Button>
          </div>
          {check.data ? (
            check.data.length > 0 ? (
              <p className="mt-2 text-xs text-destructive" data-testid="sw-check-hit">
                {t('settings.sensitiveWordHit', { words: check.data.join('、') })}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="sw-check-clean">
                {t('settings.sensitiveWordNoHit')}
              </p>
            )
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
