import { describe, it, expect } from 'vitest'
import { generateSpecCode } from '../../src/recorder/codegen'
import { InteractionType } from '../../src/recorder/interaction'
import type { TestCase, Interaction } from '../../src/recorder/interaction'

function interaction(overrides: Partial<Interaction> & { type: InteractionType }): Interaction {
  return {
    id: 'i-1',
    timestamp: Date.now(),
    sessionId: 's-1',
    description: 'test step',
    ...overrides,
  }
}

function testCase(overrides: Partial<TestCase> & { interactions: Interaction[] }): TestCase {
  return {
    id: 'tc-1',
    name: 'test case',
    type: 'happy',
    description: 'a test',
    assertions: [],
    tags: [],
    ...overrides,
  }
}

describe('generateSpecCode', () => {
  it('includes playwright import', () => {
    const code = generateSpecCode([])
    expect(code).toContain("import { test, expect } from '@playwright/test'")
  })

  it('includes spec name comment when provided', () => {
    const code = generateSpecCode([], 'MySpec')
    expect(code).toContain('// Spec: MySpec')
  })

  it('handles empty array with just import line', () => {
    const code = generateSpecCode([])
    expect(code).toContain('@playwright/test')
    expect(code.trim().length).toBeGreaterThan(0)
  })

  it('generates test block for each test case', () => {
    const cases = [
      testCase({ name: 'test A', interactions: [] }),
      testCase({ name: 'test B', interactions: [] }),
    ]
    const code = generateSpecCode(cases)
    expect(code).toContain("test('test A'")
    expect(code).toContain("test('test B'")
  })

  it('includes goto interaction code', () => {
    const tc = testCase({
      name: 'goto test',
      interactions: [interaction({ type: InteractionType.GOTO, url: 'https://example.com', description: 'go to page' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain("await page.goto('https://example.com')")
    expect(code).toContain("await page.waitForLoadState('networkidle')")
  })

  it('includes click interaction code', () => {
    const tc = testCase({
      name: 'click test',
      interactions: [interaction({ type: InteractionType.CLICK, selector: '#btn', description: 'click button' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain("await page.click('#btn')")
  })

  it('includes fill interaction code', () => {
    const tc = testCase({
      name: 'fill test',
      interactions: [interaction({ type: InteractionType.FILL, selector: '#email', value: 'a@b.com', description: 'fill email' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain("await page.fill('#email', 'a@b.com')")
  })

  it('includes fill with empty string', () => {
    const tc = testCase({
      name: 'fill empty',
      interactions: [interaction({ type: InteractionType.FILL, selector: '#email', value: '', description: 'fill empty' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain("await page.fill('#email', '')")
  })

  it('includes snapshot interaction code', () => {
    const tc = testCase({
      name: 'snapshot test',
      interactions: [interaction({ type: InteractionType.SNAPSHOT, id: 'snap-1', description: 'take screenshot' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain("await page.screenshot({ path: 'screenshots/snap-1.png' })")
  })

  it('includes evaluate interaction code', () => {
    const tc = testCase({
      name: 'eval test',
      interactions: [interaction({ type: InteractionType.EVALUATE, description: 'eval js' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain('await page.evaluate')
  })

  it('includes extract interaction code', () => {
    const tc = testCase({
      name: 'extract test',
      interactions: [interaction({ type: InteractionType.EXTRACT, description: 'get text' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain("await page.textContent('body')")
  })

  it('includes assert interaction code with selector', () => {
    const tc = testCase({
      name: 'assert test',
      interactions: [interaction({ type: InteractionType.ASSERT, selector: '#btn', description: 'check visible' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain('toBeVisible()')
    expect(code).toContain("page.locator('#btn')")
  })

  it('includes assertion expectations', () => {
    const tc = testCase({
      name: 'with assertion',
      interactions: [interaction({ type: InteractionType.GOTO, url: 'https://x.com', description: 'go' })],
      assertions: [{ id: 'a-1', interactionId: 'i-1', type: 'text', selector: '.title', expected: 'Hello' }],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain("toHaveText('Hello')")
  })

  it('includes API_CALL interaction code', () => {
    const tc = testCase({
      name: 'api test',
      interactions: [interaction({ type: InteractionType.API_CALL, url: 'https://api.example.com/login', description: 'POST /login', metadata: { method: 'POST' } })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain("await page.request.post('https://api.example.com/login')")
    expect(code).toContain('expect(response.ok()).toBeTruthy()')
  })

  it('includes API_CALL with body', () => {
    const tc = testCase({
      name: 'api post with body',
      interactions: [interaction({ type: InteractionType.API_CALL, url: 'https://api.example.com/data', description: 'POST /data', metadata: { method: 'POST', body: { key: 'val' } } })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain('await page.request.post')
    expect(code).toContain('{"key":"val"}')
  })

  it('escapes single quotes in values', () => {
    const tc = testCase({
      name: "escape's",
      interactions: [interaction({ type: InteractionType.FILL, selector: '#inp', value: "it's a test", description: 'fill' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain("it\\'s a test")
  })

  it('adds URL assertion for GOTO interactions', () => {
    const tc = testCase({
      name: 'url check',
      interactions: [interaction({ type: InteractionType.GOTO, url: 'https://example.com/path', description: 'go' })],
    })
    const code = generateSpecCode([tc])
    expect(code).toContain('toHaveURL')
    expect(code).toContain('example.com')
  })

  it('produces valid syntax - each test block closes with })', () => {
    const cases = [
      testCase({ name: 'tc1', interactions: [] }),
      testCase({ name: 'tc2', interactions: [] }),
    ]
    const code = generateSpecCode(cases)
    const lines = code.split('\n')
    const closingBraces = lines.filter(l => l.trim() === '})')
    expect(closingBraces).toHaveLength(2)
  })
})
