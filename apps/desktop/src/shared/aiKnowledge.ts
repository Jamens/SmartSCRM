/**
 * B28 知识库的纯逻辑（渲染层与驱动共用，配 node --test）。
 *
 * 放 shared 的理由与 `perf`/`update` 同源：真正需要"只有一份"且必须可单测的是
 * **"一个分片能派生出什么候选 QA"** 这个启发式——它既要在设置页做预览，也会被驱动断言。
 * 文档切分(knowledge_chunk)由后端负责并落库；这里只从**已切好的分片**派生候选。
 *
 * 设计要点（spec §8）：**派生 QA 不自动落库**。本函数只产候选，人工在界面确认后才 POST
 * /knowledge-qa（source=derived）。所以"明显不合格返回空数组交人工"是刻意设计，不是兜底。
 */

export interface QaCandidate {
  question: string
  answer: string
}

/** 单块最短有效长度：问题或答案短于此视为不合格（噪声/标题行），跳过。 */
const MIN_LEN = 4

/**
 * 一个分片 → 候选 QA 列表。规则（启发式，宁缺毋滥）：
 * - 按**空行**把分片切成若干块，一块一条候选；
 * - 每块**首行作问、其余行作答**（拼接为空行）；
 * - 问题或答案短于 {@link MIN_LEN}、或形如"标题/小标题"（无问号等疑问特征且过短）→ 丢弃；
 * - 全部不合格时返回**空数组**交人工。
 */
export function deriveQaPreview(chunkContent: string | null | undefined): QaCandidate[] {
  if (chunkContent == null) return []
  const blocks = String(chunkContent)
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\r/g, '').trim())
    .filter((b) => b.length > 0)
  const out: QaCandidate[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    if (lines.length < 2) continue // 只有一行，既当不了问也没有答
    const question = lines[0]
    const answer = lines.slice(1).join('\n')
    if (question.length < MIN_LEN || answer.length < MIN_LEN) continue
    out.push({ question, answer })
  }
  return out
}
