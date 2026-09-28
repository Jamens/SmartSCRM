// src/renderer/src/components/translation/LangSelect.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { languageName } from '@/lib/langData'

/** radix 的 SelectItem 不接受空串 value，用 `auto` 作哨兵并在边界换回 `''`。 */
export const AUTO_SOURCE = 'auto'

export function LangSelect({
  value,
  options,
  allowAuto,
  onChange
}: {
  value: string
  options: { code: string; zh: string }[]
  allowAuto?: boolean
  onChange: (v: string) => void
}): React.JSX.Element {
  const shown = allowAuto && value === '' ? AUTO_SOURCE : value
  // 下拉收窄后，库里存的历史值（换线路前挑的、或在别的线路上存的）会落在清单外。
  // 不补这一项，Radix 找不到匹配的 item，触发器就退成占位符——界面在说"没选"，实际选了个不支持的。
  const unsupported = shown !== '' && shown !== AUTO_SOURCE && !options.some((o) => o.code === shown)
  return (
    <Select
      value={shown}
      onValueChange={(v) => onChange(v === AUTO_SOURCE ? '' : v)}
    >
      <SelectTrigger className="h-8 w-full text-xs">
        <SelectValue placeholder="自动检测" />
      </SelectTrigger>
      <SelectContent>
        {allowAuto && <SelectItem value={AUTO_SOURCE}>自动检测</SelectItem>}
        {options.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            {languageName(lang.code)}
          </SelectItem>
        ))}
        {unsupported && (
          <SelectItem value={shown} data-p7-unsupported="">
            {languageName(shown)} · 该线路不支持
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}
