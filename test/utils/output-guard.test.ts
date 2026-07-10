import { describe, it, expect } from 'vitest'
import { validateOutput, StreamGuard } from '../../src/utils/output-guard'

describe('validateOutput', () => {
  it('passes empty text', () => {
    const r = validateOutput('')
    expect(r.ok).toBe(true)
    expect(r.text).toBe('')
    expect(r.wasTruncated).toBe(false)
  })

  it('passes normal English text', () => {
    const r = validateOutput('The endpoint returned a 200 with session cookie. Testing for SQL injection now.')
    expect(r.ok).toBe(true)
    expect(r.wasTruncated).toBe(false)
  })

  it('passes text with code blocks', () => {
    const r = validateOutput('```json\n{"status": "ok", "user": "admin"}\n```\nFound endpoint /api/users with GET method.')
    expect(r.ok).toBe(true)
  })

  it('passes text with reasonable non-ASCII (URLs, accented chars)', () => {
    const r = validateOutput('The endpoint /café returns 200. José found an IDOR on /api/users/42.')
    expect(r.ok).toBe(true)
  })

  it('rejects multilingual garbage (5+ scripts)', () => {
    const garbage = 'Employee 拿到 Territory دفع Bp है यह क्या هذ47648 ठीक है बहुत छोटा है कोड में त्रुटि है फिर से लिखो 地址 テスト 한국어'
    const r = validateOutput(garbage)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('script_mixing')
  })

  it('rejects high non-ASCII ratio text', () => {
    // Build text with >40% non-ASCII
    const garbage = ''.padEnd(30, 'ع') + 'abc'
    const r = validateOutput(garbage)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('non_ascii_ratio')
  })

  it('rejects repeated n-gram pattern', () => {
    const repeated = 'Employee'.repeat(15)
    const r = validateOutput(repeated)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('repeated_ngram')
  })

  it('truncates oversized text', () => {
    // Build a long string where every 8-char window is unique (no repeated ngrams)
    // Use a counter padded to 8 chars + random hex to ensure uniqueness
    const parts: string[] = []
    for (let i = 0; i < 20_000; i++) {
      parts.push(i.toString(16).padStart(8, '0'))
    }
    const big = parts.join('')
    const r = validateOutput(big, { maxChunkBytes: 50_000 })
    expect(r.ok).toBe(true)
    expect(r.wasTruncated).toBe(true)
    expect(Buffer.byteLength(r.text, 'utf-8')).toBeLessThanOrEqual(50_000)
  })

  it('handles multi-byte truncation correctly', () => {
    // Varied ASCII + multi-byte chars, long enough to trigger truncation
    const base = 'The quick brown fox jumps over the lazy dog. '
    const text = base.repeat(2_000) + '你好世界'.repeat(2_000)
    const r = validateOutput(text, { maxChunkBytes: 50_000 })
    expect(r.wasTruncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(text.length)
  })

  it('allows configuring thresholds', () => {
    // With strict config: 2 scripts is too many
    const r = validateOutput('Hello世界', { maxScriptCount: 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('script_mixing')
  })

  it('allows configuring ngram threshold', () => {
    // 8-char pattern repeated 3 times = 24 chars, each 8-char ngram repeats 3 times
    const text = 'abcdefgh'.repeat(3)
    const r = validateOutput(text, { maxNgramRepeats: 2 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('repeated_ngram')
  })
})

describe('StreamGuard', () => {
  it('tracks garbage chunks and aborts after threshold', () => {
    const guard = new StreamGuard({ abortThreshold: 3 })

    // Clean chunk
    const r1 = guard.validateChunk('Testing endpoint for SQL injection...')
    expect(r1.ok).toBe(true)
    expect(r1.shouldAbort).toBe(false)
    expect(guard.getGarbageCount()).toBe(0)

    // Garbage chunks
    const r2 = guard.validateChunk('Employee 拿到 Territory دفع Bp है यह کے لیے 他給 दिया क्या')
    expect(r2.ok).toBe(false)
    expect(r2.shouldAbort).toBe(false) // only 1 garbage chunk
    expect(guard.getGarbageCount()).toBe(1)

    const r3 = guard.validateChunk('/address テスト 한국어 عربى हिंदी ไทย 히브리 地址')
    expect(r3.ok).toBe(false)
    expect(r3.shouldAbort).toBe(false) // 2 garbage chunks
    expect(guard.getGarbageCount()).toBe(2)

    const r4 = guard.validateChunk('अरबी हिंदी ไทย 히브리 地址 テスト 한국어 عربى')
    expect(r4.ok).toBe(false)
    expect(r4.shouldAbort).toBe(true) // 3 garbage chunks → abort
    expect(guard.getGarbageCount()).toBe(3)
  })

  it('resets garbage count on clean chunk', () => {
    const guard = new StreamGuard({ abortThreshold: 3 })

    guard.validateChunk('Employee 拿到 Territory دفع Bp है') // garbage 1
    guard.validateChunk('/address テスト 한국어 عربى') // garbage 2
    guard.validateChunk('Normal text here.') // clean → resets
    expect(guard.getGarbageCount()).toBe(0)

    guard.validateChunk('Another clean chunk.') // clean
    expect(guard.getGarbageCount()).toBe(0)
  })

  it('reset() clears all state', () => {
    const guard = new StreamGuard()
    guard.validateChunk('Employee 拿到 Territory دفع Bp है')
    guard.validateChunk('Normal text')
    expect(guard.getTotalChunks()).toBe(2)
    guard.reset()
    expect(guard.getTotalChunks()).toBe(0)
    expect(guard.getGarbageCount()).toBe(0)
  })

  it('tracks total chunks', () => {
    const guard = new StreamGuard()
    guard.validateChunk('hello')
    guard.validateChunk('world')
    guard.validateChunk('test')
    expect(guard.getTotalChunks()).toBe(3)
  })
})
