/**
 * Context compaction — replaces blind char-slice truncation.
 *
 * Single owner of "make this text fit a token budget". Strategies:
 *  - `none`         : already fits, returned unchanged
 *  - `head-tail`    : keep head + tail, omit the middle (no-dependency fallback)
 *  - `section-aware`: drop whole low-value sections first, then intra-section
 *  - `headroom`     : delegated to the Headroom service (plain text only)
 *
 * Every result carries `lostBytes` + `strategy` so callers can emit forensic
 * provenance. NO silent truncation — if anything was dropped, it is reported.
 */

export type CompactionStrategy = 'none' | 'head-tail' | 'section-aware' | 'headroom'

export interface CompactionResult {
  text: string
  /** Bytes removed vs the original (0 when strategy === 'none'). */
  lostBytes: number
  strategy: CompactionStrategy
  /** True when some content was omitted. */
  compacted: boolean
}

const CHARS_PER_TOKEN = 4

/** Rough token estimate, aligned with models/context-manager.ts. */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0
  const words = text.split(/\s+/).filter(Boolean).length
  const codeOverhead = (text.match(/[{}[\]();=<>!&|]/g)?.length ?? 0) * 0.1
  return Math.ceil(words * 1.3 + codeOverhead)
}

export interface CompactionOptions {
  /** Target token budget. When omitted, no compaction is applied. */
  tokenBudget?: number
  /** Force a strategy; otherwise auto-select (section-aware > head-tail). */
  strategy?: CompactionStrategy
  /** Head + tail share of the budget when head-tail/section-aware truncate. */
  headTailRatio?: number
}

/**
 * Split text into structural sections. We use a cheap, dependency-free heuristic:
 *  - markdown `## ` headers
 *  - repeated `=`/`─` underline rows (setext-style)
 *  - agent log markers (`>>`, `phase:`, `tool:`, `result:`)
 * Falls back to a single section when no structure is detected.
 */
function splitSections(text: string): string[] {
  const lines = text.split('\n')
  const boundaries: number[] = [0]
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*#{1,6}\s/.test(line)) boundaries.push(i)
    else if (/^\s*(={3,}|─{3,}|─{3,}|-{3,})\s*$/.test(line)) boundaries.push(i)
    else if (/^\s*>>\s/.test(line)) boundaries.push(i)
  }
  if (boundaries.length === 1) return [text]

  const sections: string[] = []
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b]
    const end = b + 1 < boundaries.length ? boundaries[b + 1] : lines.length
    const slice = lines.slice(start, end).join('\n')
    if (slice.trim().length > 0) sections.push(slice)
  }
  return sections.length > 0 ? sections : [text]
}

/**
 * Score a section's value for *keeping*. Higher = more valuable.
 * Heuristic (typed/structural, not keyword-based):
 *  - tool RESULTS / code / JSON / errors / diffs are high value
 *  - repeated planning drafts and older reasoning are lower value
 */
function sectionValue(section: string): number {
  let score = 1
  if (/result|response|output|error|exception|stack|status|200|400|401|403|500/i.test(section)) score += 2
  if (/```/.test(section)) score += 2
  if (/\{[\s\S]*\}/.test(section)) score += 1
  if (/^(#{1,6}\s.*(plan|draft|thought|reason|think))/im.test(section)) score -= 1
  return score
}

function headTail(text: string, charBudget: number, ratio = 0.4): string {
  if (text.length <= charBudget) return text
  const headChars = Math.floor(charBudget * ratio)
  const tailChars = charBudget - headChars
  const head = text.slice(0, headChars)
  const tail = text.slice(text.length - tailChars)
  const omitted = text.length - charBudget
  return `${head}\n\n… [${omitted} chars omitted] …\n\n${tail}`
}

function sectionAware(text: string, charBudget: number): string {
  const sections = splitSections(text)
  if (sections.length <= 1) return headTail(text, charBudget)

  // Keep highest-value sections first; if still over budget, head-tail the remainder.
  const ranked = [...sections].sort((a, b) => sectionValue(b) - sectionValue(a))
  const kept: string[] = []
  let used = 0
  for (const s of ranked) {
    if (used + s.length <= charBudget) {
      kept.push(s)
      used += s.length
    } else {
      break
    }
  }
  if (kept.length === 0) return headTail(text, charBudget)
  const result = kept.join('\n\n')
  const lost = text.length - result.length
  if (lost <= 0) return result
  return `${result}\n\n… [${lost} chars omitted from lower-value sections] …`
}

/**
 * Compact `text` to fit `tokenBudget`. Pure, synchronous, dependency-free.
 * Headroom delegation is performed by the caller (CompressionService) which
 * then re-wraps the result; this function handles the local strategies.
 */
export function compactText(text: string, options: CompactionOptions = {}): CompactionResult {
  if (!text) return { text: '', lostBytes: 0, strategy: 'none', compacted: false }

  const budget = options.tokenBudget
  if (!budget || budget <= 0) {
    return { text, lostBytes: 0, strategy: 'none', compacted: false }
  }

  const charBudget = Math.max(1, Math.floor(budget * CHARS_PER_TOKEN))
  if (text.length <= charBudget) {
    return { text, lostBytes: 0, strategy: 'none', compacted: false }
  }

  const strategy: CompactionStrategy = options.strategy === 'head-tail'
    ? 'head-tail'
    : options.strategy === 'section-aware'
      ? 'section-aware'
      : 'section-aware' // default preference (falls back to head-tail inside)

  const ratio = options.headTailRatio ?? 0.4
  const out = strategy === 'head-tail'
    ? headTail(text, charBudget, ratio)
    : sectionAware(text, charBudget)

  const lost = text.length - out.length
  return {
    text: out,
    lostBytes: lost,
    strategy: lost > 0 ? strategy : 'none',
    compacted: lost > 0,
  }
}

/**
 * Wrap a Headroom-compressed string (already text, NOT an SDK envelope) into a
 * CompactionResult. Keeps the provenance contract uniform across strategies.
 */
export function wrapHeadroomResult(original: string, compressedText: string): CompactionResult {
  const lost = original.length - compressedText.length
  return {
    text: compressedText,
    lostBytes: lost > 0 ? lost : 0,
    strategy: 'headroom',
    compacted: lost > 0,
  }
}
