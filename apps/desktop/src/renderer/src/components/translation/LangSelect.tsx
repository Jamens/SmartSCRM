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
  return (
    <Select
      value={allowAuto && value === '' ? AUTO_SOURCE : value}
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
      </SelectContent>
    </Select>
  )
}
