import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, KeyRound, LoaderCircle, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useClearCredential, useImportCredential, type PlatformAccount } from '@/stores/accounts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: PlatformAccount
}

type Mode = 'paste' | 'file'

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return ''
}

export default function ImportCredentialDialog({ open, onOpenChange, account }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const importMutate = useImportCredential()
  const clearMutate = useClearCredential()
  const [mode, setMode] = useState<Mode>('paste')
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'imported' | 'cleared' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const busy = importMutate.isPending || clearMutate.isPending

  const reset = (): void => {
    setRaw('')
    setFileName(null)
    setError(null)
    setDone(null)
    setMode('paste')
  }

  const onOpenChangeSafe = (next: boolean): void => {
    if (!next) reset()
    onOpenChange(next)
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setRaw(String(reader.result ?? ''))
      setFileName(file.name)
      setError(null)
      setDone(null)
    }
    reader.readAsText(file)
    // 允许重复选择同一文件：清空 value 让下次 change 仍触发。
    e.target.value = ''
  }

  const validate = (): string | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      const obj = JSON.parse(trimmed)
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj) || Object.keys(obj).length === 0) {
        return t('account.import.invalidFormat')
      }
      return JSON.stringify(obj)
    } catch {
      return t('account.import.invalidFormat')
    }
  }

  const submitImport = async (): Promise<void> => {
    const credential = validate()
    if (!credential) {
      setError(t('account.import.invalidFormat'))
      return
    }
    setError(null)
    setDone(null)
    try {
      await importMutate.mutateAsync({ id: account.id, credential })
      setDone('imported')
      setRaw('')
      setFileName(null)
    } catch (e) {
      setError(t('account.import.importFailed', { msg: errorMessage(e) }))
    }
  }

  const submitClear = async (): Promise<void> => {
    setError(null)
    setDone(null)
    try {
      await clearMutate.mutateAsync(account.id)
      setDone('cleared')
    } catch (e) {
      setError(t('account.import.clearFailed', { msg: errorMessage(e) }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeSafe}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {t('account.import.title')}
          </DialogTitle>
          <DialogDescription>{t('account.import.desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">{t('account.import.statusLabel')}</span>
            <span className={account.hasCredential ? 'font-medium text-emerald-600' : 'text-muted-foreground'}>
              {account.hasCredential ? t('account.import.imported') : t('account.import.notImported')}
            </span>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'paste' ? 'secondary' : 'ghost'}
              onClick={() => setMode('paste')}
            >
              {t('account.import.pasteOption')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'file' ? 'secondary' : 'ghost'}
              onClick={() => setMode('file')}
            >
              {t('account.import.fileOption')}
            </Button>
          </div>

          {mode === 'paste' ? (
            <textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                setError(null)
                setDone(null)
              }}
              placeholder={t('account.import.pastePlaceholder')}
              spellCheck={false}
              className="h-40 w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
            />
          ) : (
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={onFile}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="size-4" />
                {t('account.import.fileButton')}
              </Button>
              {fileName && (
                <p className="text-xs text-muted-foreground">{t('account.import.fileLoaded', { name: fileName })}</p>
              )}
              {raw && (
                <textarea
                  value={raw}
                  onChange={(e) => {
                    setRaw(e.target.value)
                    setError(null)
                    setDone(null)
                  }}
                  spellCheck={false}
                  className="h-32 w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
                />
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t('account.import.willAutoLogin')}</p>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {done === 'imported' && <p className="text-xs text-emerald-600">{t('account.import.importedTip')}</p>}
          {done === 'cleared' && <p className="text-xs text-muted-foreground">{t('account.import.clearedTip')}</p>}
        </div>

        <DialogFooter className="gap-2">
          {account.hasCredential && (
            <Button variant="ghost" className="gap-1.5 text-destructive" onClick={submitClear} disabled={busy}>
              {clearMutate.isPending && <LoaderCircle className="size-3.5 animate-spin" />}
              <Trash2 className="size-3.5" />
              {t('account.import.clearButton')}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChangeSafe(false)}>
            {t('common.close')}
          </Button>
          <Button onClick={submitImport} disabled={busy || !raw.trim()}>
            {importMutate.isPending && <LoaderCircle className="size-3.5 animate-spin" />}
            {t('account.import.importButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
