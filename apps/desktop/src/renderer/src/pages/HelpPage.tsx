import { useTranslation } from 'react-i18next'
import { Download, HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

interface FaqItem {
  q: string
  a: string
}

/**
 * A11 帮助文档与 FAQ —— 独立内容页（不是设置项）。
 *
 * FAQ 正文走 i18n（8 语）；「下载模板」在渲染层就地生成一个 CSV 模板（Blob + a[download]），
 * 不经后端、也不落盘到应用目录——它只是个给人填的空白表，交给用户自己存。
 */
export default function HelpPage(): React.JSX.Element {
  const { t } = useTranslation()

  const faqs: FaqItem[] = [
    { q: t('help.faq1Q'), a: t('help.faq1A') },
    { q: t('help.faq2Q'), a: t('help.faq2A') },
    { q: t('help.faq3Q'), a: t('help.faq3A') }
  ]

  const downloadTemplate = (): void => {
    const header = '问题,答案\n'
    const rows = faqs.map((f) => `"${f.q.replace(/"/g, '""')}","${f.a.replace(/"/g, '""')}"`).join('\n')
    const blob = new Blob(['\uFEFF' + header + rows + '\n'], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'scrm-faq-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <HelpCircle className="size-5 text-primary" />
          {t('help.title')}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">{t('help.desc')}</p>

        <Separator className="my-5" />

        <div className="flex flex-col gap-5">
          {faqs.map((f, i) => (
            <div key={f.q}>
              <p className="text-sm font-medium text-foreground">{f.q}</p>
              <p className="mt-1 text-sm text-muted-foreground">{f.a}</p>
              {i < faqs.length - 1 && <Separator className="mt-5" />}
            </div>
          ))}
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>{t('help.downloadTemplate')}</CardTitle>
            <CardDescription>{t('help.downloadTemplateDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" onClick={downloadTemplate} data-testid="help-download">
              <Download className="size-4" />
              {t('help.downloadTemplate')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
