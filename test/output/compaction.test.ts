import { describe, it, expect } from 'vitest'
import { compactText, wrapHeadroomResult, estimateTokens } from '../../src/output/compaction'

const lorem = (n: number) => 'word '.repeat(n)

describe('compactText', () => {
  it('returns unchanged text when no budget given', () => {
    const t = 'hello world'
    const r = compactText(t)
    expect(r.text).toBe(t)
    expect(r.strategy).toBe('none')
    expect(r.compacted).toBe(false)
    expect(r.lostBytes).toBe(0)
  })

  it('returns unchanged text when within budget', () => {
    const t = 'a '.repeat(100)
    const r = compactText(t, { tokenBudget: 10_000 })
    expect(r.text).toBe(t)
    expect(r.strategy).toBe('none')
    expect(r.lostBytes).toBe(0)
  })

  it('head-tail keeps head and tail, omits middle', () => {
    const head = 'HEADMARKER '.repeat(20)
    const middle = 'MIDDLEFILL '.repeat(500)
    const tail = 'TAILMARKER '.repeat(20)
    const t = head + middle + tail
    const r = compactText(t, { tokenBudget: 200, strategy: 'head-tail' })
    expect(r.compacted).toBe(true)
    expect(r.strategy).toBe('head-tail')
    expect(r.text.startsWith('HEADMARKER')).toBe(true)
    expect(r.text.includes('TAILMARKER')).toBe(true)
    // A substantial chunk of the middle must be omitted (not all retained).
    const middleOccurrences = (r.text.match(/MIDDLEFILL/g) || []).length
    expect(middleOccurrences).toBeLessThan(500)
    expect(r.lostBytes).toBeGreaterThan(0)
    expect(r.text).toMatch(/omitted/)
  })

  it('section-aware drops low-value sections before slicing', () => {
    const keep = '## Result\n' + lorem(300)
    const drop = '## Plan draft\n' + lorem(800)
    const t = keep + '\n\n' + drop
    const r = compactText(t, { tokenBudget: 200, strategy: 'section-aware' })
    expect(r.compacted).toBe(true)
    expect(r.text.includes('Result')).toBe(true)
    expect(r.lostBytes).toBeGreaterThan(0)
  })

  it('section-aware falls back to head-tail when single section', () => {
    const t = 'INTRO '.repeat(20) + lorem(600) + 'END '.repeat(20)
    const r = compactText(t, { tokenBudget: 200, strategy: 'section-aware' })
    expect(r.compacted).toBe(true)
    expect(r.text.startsWith('INTRO')).toBe(true)
    expect(r.text.includes('END')).toBe(true)
  })

  it('default strategy prefers section-aware', () => {
    const t = '## Result\n' + lorem(300) + '\n\n## Plan\n' + lorem(800)
    const r = compactText(t, { tokenBudget: 200 })
    expect(r.compacted).toBe(true)
    expect(r.text.includes('Result')).toBe(true)
  })

  it('estimateTokens is positive for non-empty text', () => {
    expect(estimateTokens('one two three')).toBeGreaterThan(0)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('wrapHeadroomResult', () => {
  it('reports lost bytes and headroom strategy', () => {
    const original = 'x'.repeat(1000)
    const compressed = 'x'.repeat(400)
    const r = wrapHeadroomResult(original, compressed)
    expect(r.strategy).toBe('headroom')
    expect(r.lostBytes).toBe(600)
    expect(r.compacted).toBe(true)
    expect(r.text).toBe(compressed)
  })

  it('no loss when equal', () => {
    const r = wrapHeadroomResult('abc', 'abc')
    expect(r.lostBytes).toBe(0)
    expect(r.compacted).toBe(false)
  })
})
