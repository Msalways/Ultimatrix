/**
 * Output Guard — Centralized validation for LLM text output.
 *
 * Detects garbled/corrupted model output (multilingual noise, repeated n-grams,
 * incoherent text) before it reaches the terminal. All model text passes through
 * this layer. Adding a new heuristic = adding a function here, zero changes to callers.
 */

export interface OutputGuardResult {
  ok: boolean
  text: string
  reason?: string
  wasTruncated: boolean
}

export interface OutputGuardConfig {
  /** Max bytes for a single text chunk before truncation. Default: 50000. */
  maxChunkBytes?: number
  /** Max ratio of non-ASCII characters (0-1). Above this = garbage. Default: 0.40. */
  maxNonAsciiRatio?: number
  /** Number of distinct Unicode scripts allowed before flagging. Default: 3. */
  maxScriptCount?: number
  /** Max times a substring can repeat before flagging. Default: 10. */
  maxNgramRepeats?: number
  /** N-gram size for repeat detection. Default: 8. */
  ngramSize?: number
}

const DEFAULT_CONFIG: Required<OutputGuardConfig> = {
  maxChunkBytes: 50_000,
  maxNonAsciiRatio: 0.40,
  maxScriptCount: 3,
  maxNgramRepeats: 10,
  ngramSize: 8,
}

/**
 * Unicode script detection via range scanning.
 * Returns the set of distinct scripts found in the text.
 */
function detectScripts(text: string): Set<string> {
  const scripts = new Set<string>()
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code < 0x0020) continue // skip control chars
    if (code >= 0x0041 && code <= 0x005A || code >= 0x0061 && code <= 0x007A) { scripts.add('latin'); continue }
    if (code >= 0x0400 && code <= 0x04FF) { scripts.add('cyrillic'); continue }
    if (code >= 0x0600 && code <= 0x06FF) { scripts.add('arabic'); continue }
    if (code >= 0x0900 && code <= 0x097F) { scripts.add('devanagari'); continue }
    if (code >= 0x0E00 && code <= 0x0E7F) { scripts.add('thai'); continue }
    if (code >= 0x3040 && code <= 0x309F) { scripts.add('hiragana'); continue }
    if (code >= 0x30A0 && code <= 0x30FF) { scripts.add('katakana'); continue }
    if (code >= 0x4E00 && code <= 0x9FFF) { scripts.add('cjk'); continue }
    if (code >= 0x5900 && code <= 0x5FFF) { scripts.add('hebrew'); continue }
    if (code >= 0xAC00 && code <= 0xD7AF) { scripts.add('hangul'); continue }
    if (code >= 0x1F300 && code <= 0x1FAFF) { scripts.add('emoji'); continue }
    // Latin Extended, common punctuation, digits — don't add a script
    if (code >= 0x00C0 && code <= 0x024F) { scripts.add('latin-ext'); continue }
  }
  return scripts
}

/**
 * Count non-ASCII characters and compute ratio.
 */
function nonAsciiRatio(text: string): number {
  if (text.length === 0) return 0
  let nonAscii = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) > 127) nonAscii++
  }
  return nonAscii / text.length
}

/**
 * Detect repeated n-grams. Returns the max repeat count of any single n-gram.
 */
function maxNgramRepeat(text: string, ngramSize: number): { maxRepeats: number; dominant: string } {
  if (text.length < ngramSize) return { maxRepeats: 0, dominant: '' }

  const counts = new Map<string, number>()
  for (let i = 0; i <= text.length - ngramSize; i++) {
    const gram = text.slice(i, i + ngramSize)
    counts.set(gram, (counts.get(gram) || 0) + 1)
  }

  let maxRepeats = 0
  let dominant = ''
  for (const [gram, count] of counts) {
    if (count > maxRepeats) {
      maxRepeats = count
      dominant = gram
    }
  }
  return { maxRepeats, dominant }
}

/**
 * Detect garbage output using configurable heuristics.
 * Each heuristic returns { isGarbage, reason } — first hit wins.
 */
function detectGarbage(
  text: string,
  config: Required<OutputGuardConfig>,
): { isGarbage: boolean; reason?: string } {
  if (text.length === 0) return { isGarbage: false }

  // Heuristic 1: Script mixing — too many distinct scripts = incoherent
  const scripts = detectScripts(text)
  if (scripts.size > config.maxScriptCount) {
    return {
      isGarbage: true,
      reason: `script_mixing: ${scripts.size} scripts detected (${Array.from(scripts).join(', ')})`,
    }
  }

  // Heuristic 2: Non-ASCII ratio — too many exotic characters = garbage
  const ratio = nonAsciiRatio(text)
  if (ratio > config.maxNonAsciiRatio) {
    return {
      isGarbage: true,
      reason: `non_ascii_ratio: ${(ratio * 100).toFixed(1)}% non-ASCII characters`,
    }
  }

  // Heuristic 3: Repeated n-grams — same pattern repeated = stuck model
  const { maxRepeats, dominant } = maxNgramRepeat(text, config.ngramSize)
  if (maxRepeats > config.maxNgramRepeats) {
    return {
      isGarbage: true,
      reason: `repeated_ngram: "${dominant.slice(0, 20)}" repeated ${maxRepeats} times`,
    }
  }

  return { isGarbage: false }
}

/**
 * Validate a chunk of model output text.
 *
 * Returns { ok: true, text } if the text is clean or was truncated to fit.
 * Returns { ok: false, reason, text } if the text is garbage (text is the
 * original — caller should not print it).
 */
export function validateOutput(
  text: string,
  config?: OutputGuardConfig,
): OutputGuardResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Empty is always fine
  if (!text || text.length === 0) {
    return { ok: true, text, wasTruncated: false }
  }

  // Truncate if over max bytes
  let clean = text
  let wasTruncated = false
  const byteLen = Buffer.byteLength(text, 'utf-8')
  if (byteLen > cfg.maxChunkBytes) {
    // Truncate at character boundary (safe for multi-byte)
    let charCount = 0
    let byteCount = 0
    for (const ch of text) {
      const chBytes = Buffer.byteLength(ch, 'utf-8')
      if (byteCount + chBytes > cfg.maxChunkBytes) break
      byteCount += chBytes
      charCount++
    }
    clean = text.slice(0, charCount)
    wasTruncated = true
  }

  // Run garbage detection
  const { isGarbage, reason } = detectGarbage(clean, cfg)
  if (isGarbage) {
    return { ok: false, text: clean, reason, wasTruncated }
  }

  return { ok: true, text: clean, wasTruncated }
}

/**
 * Accumulate-chunk validator for streaming.
 * Tracks garbage across chunks and aborts after sustained garbage.
 */
export class StreamGuard {
  private garbageCount = 0
  private totalChunks = 0
  private config: Required<OutputGuardConfig>
  /** Number of consecutive garbage chunks before aborting. Default: 5. */
  private abortThreshold: number

  constructor(config?: OutputGuardConfig & { abortThreshold?: number }) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.abortThreshold = config?.abortThreshold ?? 5
  }

  /**
   * Validate a streaming chunk. Returns the validation result.
   * If garbage is detected, increments garbageCount.
   * If clean, resets garbageCount to 0.
   * Returns shouldAbort = true when garbage is sustained.
   */
  validateChunk(text: string): OutputGuardResult & { shouldAbort: boolean } {
    this.totalChunks++
    const result = validateOutput(text, this.config)

    if (!result.ok) {
      this.garbageCount++
      return { ...result, shouldAbort: this.garbageCount >= this.abortThreshold }
    }

    // Clean chunk resets the counter
    this.garbageCount = 0
    return { ...result, shouldAbort: false }
  }

  getGarbageCount(): number { return this.garbageCount }
  getTotalChunks(): number { return this.totalChunks }

  reset(): void {
    this.garbageCount = 0
    this.totalChunks = 0
  }
}
