// src/renderer/src/components/translation/DirectionLangRows.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { LangSelect } from '@/components/translation/LangSelect'
import { sourceLanguagesFor, targetLanguagesFor, TRANSLATION_CHANNELS } from '@/lib/langData'

/** 标题列宽：带开关时多让出 64px + 8px 给那颗 Switch，两种形态共用同一个 52px 标题列。 */
const GRID_WITH_SWITCH = 'grid-cols-[52px_64px_minmax(0,1fr)_14px_minmax(0,1fr)]'
const GRID_NO_SWITCH = 'grid-cols-[52px_minmax(0,1fr)_14px_minmax(0,1fr)]'

/**
 * 语向的一行（收 / 发各一行）。从 `CustomerDirectionDialog` 原位提出，两个弹层共用一份控件——
 * 会话档那一行**没有开关**（spec §6：那里的开关位既不在后端设闸也不在页内生效，
 * 给了就是一颗按了没反应的按钮；值由 §3.3 的整份复制从生效行带过去）。
 * `enabled` 缺省时那一整列不渲染，其余部分（标题、两个语种下拉）与带开关时逐字段同形，
 * 所以两个弹层里"收信"那一行的语种位置不会错位一格。
 */
export function LangRow({
  title,
  enabled,
  onEnabled,
  from,
  to,
  onFrom,
  onTo,
  channel
}: {
  title: string
  enabled?: boolean
  onEnabled?: (v: boolean) => void
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  channel: string
}): React.JSX.Element {
  const hasSwitch = enabled !== undefined && onEnabled !== undefined
  return (
    <div className={`grid ${hasSwitch ? GRID_WITH_SWITCH : GRID_NO_SWITCH} items-center gap-2`}>
      <span className="text-xs text-muted-foreground">{title}</span>
      {hasSwitch && (
        <div>
          <Switch checked={enabled} onCheckedChange={(v) => onEnabled(v === true)} />
        </div>
      )}
      <LangSelect value={from} allowAuto options={sourceLanguagesFor(channel)} onChange={onFrom} />
      <span className="text-center text-xs text-muted-foreground">→</span>
      <LangSelect value={to} options={targetLanguagesFor(channel)} onChange={onTo} />
    </div>
  )
}

/**
 * 线路那一行。它属于**整档**而不是收/发某一侧（一个 `channel` 同时决定两侧可选语种），
 * 所以是弹层的第三格而不是 `LangRow` 的一部分。
 * 灰显规则留在翻译中心：那里同时管密钥，缺哪家的 key 一目了然；这个弹层只负责把值写进那一档，
 * 选了一条没配密钥的线路由后端如实降级（`TranslateVO.degraded` / `degradeReason`），不在此处拦。
 */
export function ChannelRow({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className={`grid ${GRID_NO_SWITCH} items-center gap-2`}>
      <span className="text-xs text-muted-foreground">线路</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-full text-xs" data-p7-channel="">
          <SelectValue placeholder="未配置" />
        </SelectTrigger>
        <SelectContent>
          {TRANSLATION_CHANNELS.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
