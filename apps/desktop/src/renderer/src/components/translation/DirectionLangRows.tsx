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
import {
  langWarnings,
  sourceLanguagesFor,
  targetLanguagesFor,
  TRANSLATION_CHANNELS
} from '@/lib/langData'

/** 标题列宽：带开关时多让出 64px + 8px 给那颗 Switch，两种形态共用同一个 52px 标题列。 */
const GRID_WITH_SWITCH = 'grid-cols-[52px_64px_minmax(0,1fr)_14px_minmax(0,1fr)]'
const GRID_NO_SWITCH = 'grid-cols-[52px_minmax(0,1fr)_14px_minmax(0,1fr)]'

/** 警示挂在各自那一列的下拉底下，所以整行改成顶端对齐；标题/开关/箭头靠 `CELL` 与下拉同一基线。 */
const CELL = 'flex h-8 items-center'

/** 语种落在本线路候选之外时的警示。文案由 `langWarnings` 出（三处宿主共用），这里只负责挂在哪一格。 */
export function LangWarning({ side, text }: { side: string; text: string }): React.JSX.Element {
  return (
    <p className="text-[11px] leading-tight text-amber-600" data-p7-lang-warning={side}>
      {text}
    </p>
  )
}

/**
 * 语向的一行（收 / 发各一行）。从 `CustomerDirectionDialog` 原位提出，两个弹层共用一份控件——
 * 会话档那一行**没有开关**（spec §6：那里的开关位既不在后端设闸也不在页内生效，
 * 给了就是一颗按了没反应的按钮；值由 §3.3 的整份复制从生效行带过去）。
 * 不给开关时那一整列不渲染：语种下拉因此比带开关时左移一格（64px + 8px 的列宽），
 * 所以**同一个弹层里两种形态不要混用**——对齐的单位是弹层，不是弹层之间。
 * 两个下拉各自底下挂一条语种警示（文案来自 `langWarnings`，与翻译中心同一份）：警示挂在产生它的那一列，
 * 文案自己点名是"源语言"还是"目标语"——横跨两列的一整行读起来永远像在指左边的源语言。
 */
type LangRowProps = {
  title: string
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  channel: string
} & (
  | { enabled: boolean; onEnabled: (v: boolean) => void }
  // `?: never`：只给两个字段里的一个是类型错误，而不是"静默少一列"。
  | { enabled?: never; onEnabled?: never }
)

export function LangRow(props: LangRowProps): React.JSX.Element {
  const { title, from, to, onFrom, onTo, channel } = props
  const sw = props.enabled !== undefined ? props : null
  const warnings = langWarnings(from, to, channel)
  const warnFor = (side: 'from' | 'to'): string | undefined =>
    warnings.find((w) => w.side === side)?.text
  const fromWarn = warnFor('from')
  const toWarn = warnFor('to')
  return (
    <div className={`grid ${sw ? GRID_WITH_SWITCH : GRID_NO_SWITCH} items-start gap-2`}>
      <span className={`${CELL} text-xs text-muted-foreground`}>{title}</span>
      {sw && (
        <div className={CELL}>
          <Switch checked={sw.enabled} onCheckedChange={(v) => sw.onEnabled(v === true)} />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <LangSelect value={from} allowAuto options={sourceLanguagesFor(channel)} onChange={onFrom} />
        {fromWarn && <LangWarning side="from" text={fromWarn} />}
      </div>
      <span className={`${CELL} justify-center text-xs text-muted-foreground`}>→</span>
      <div className="flex flex-col gap-1">
        <LangSelect value={to} options={targetLanguagesFor(channel)} onChange={onTo} />
        {toWarn && <LangWarning side="to" text={toWarn} />}
      </div>
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
