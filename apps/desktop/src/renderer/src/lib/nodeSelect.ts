/** 与 api/translation 的 ServerDelayVO 结构一致；这里自带形状，本任务因此不依赖那个模块。 */
export interface NodeDelay {
  name: string
  delay: number | null
}

export interface PickResult {
  server: string
  skipped: { name: string; reason: string }[]
}

/** R5: `hk` only serves the Google line. */
export function isNodeCompatible(name: string, channel: string): boolean {
  return name !== 'hk' || channel === '1'
}

/**
 * R6: candidates are nodes with a finite delay that are compatible with the channel;
 * the smallest wins, and a current node that is already smallest stays put (hysteresis).
 */
export function pickBestNode(delays: NodeDelay[], currentServer: string, channel: string): PickResult {
  const skipped: { name: string; reason: string }[] = []
  const candidates: { name: string; delay: number }[] = []

  for (const node of delays) {
    if (node.delay === null) {
      skipped.push({ name: node.name, reason: '不可达' })
      continue
    }
    if (!isNodeCompatible(node.name, channel)) {
      skipped.push({ name: node.name, reason: '仅支持 Google 线路' })
      continue
    }
    candidates.push({ name: node.name, delay: node.delay })
  }

  if (candidates.length === 0) {
    return { server: currentServer || 'sg', skipped }
  }
  const best = candidates.reduce((min, node) => (node.delay < min.delay ? node : min))
  const current = candidates.find((node) => node.name === currentServer)
  if (current && current.delay <= best.delay) {
    return { server: current.name, skipped }
  }
  return { server: best.name, skipped }
}
