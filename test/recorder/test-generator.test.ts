import { describe, it, expect } from 'vitest'
import { generateTestCases } from '../../src/recorder/test-generator'
import { InteractionType } from '../../src/recorder/interaction'
import type { Interaction } from '../../src/recorder/interaction'

function makeInteraction(overrides: Partial<Interaction> & { type: InteractionType }): Interaction {
  return {
    id: 'test-id-123',
    timestamp: Date.now(),
    sessionId: 's-1',
    description: 'test interaction',
    ...overrides,
  }
}

describe('generateTestCases', () => {
  describe('GOTO', () => {
    it('produces a happy test', () => {
      const interaction = makeInteraction({
        type: InteractionType.GOTO,
        url: 'https://example.com',
      })
      const cases = generateTestCases(interaction)
      expect(cases).toHaveLength(1)

      const tc = cases[0]
      expect(tc.type).toBe('happy')
      expect(tc.name).toContain('navigate')
      expect(tc.tags).toContain('navigation')
      expect(tc.endpoint).toBe('https://example.com')
      expect(tc.method).toBe('GET')
      expect(tc.interactions).toEqual([interaction])
    })
  })

  describe('CLICK', () => {
    it('produces a happy test', () => {
      const interaction = makeInteraction({
        type: InteractionType.CLICK,
        selector: '#submit-btn',
      })
      const cases = generateTestCases(interaction)
      expect(cases).toHaveLength(1)

      const tc = cases[0]
      expect(tc.type).toBe('happy')
      expect(tc.name).toContain('click')
      expect(tc.tags).toContain('click')
      expect(tc.assertions).toEqual([])
    })
  })

  describe('FILL', () => {
    it('produces 5 tests: happy, sad, edge, and 2 security', () => {
      const interaction = makeInteraction({
        type: InteractionType.FILL,
        selector: '#email',
        value: 'user@test.com',
      })
      const cases = generateTestCases(interaction)
      expect(cases).toHaveLength(5)

      const types = cases.map(c => c.type)
      expect(types.filter(t => t === 'happy')).toHaveLength(1)
      expect(types.filter(t => t === 'sad')).toHaveLength(1)
      expect(types.filter(t => t === 'edge')).toHaveLength(1)
      expect(types.filter(t => t === 'security')).toHaveLength(2)
    })

    it('happy test preserves original value', () => {
      const interaction = makeInteraction({
        type: InteractionType.FILL,
        selector: '#email',
        value: 'user@test.com',
      })
      const cases = generateTestCases(interaction)
      const happy = cases.find(c => c.type === 'happy')!
      expect(happy.interactions[0].value).toBe('user@test.com')
    })

    it('sad test uses empty string', () => {
      const interaction = makeInteraction({
        type: InteractionType.FILL,
        selector: '#email',
        value: 'user@test.com',
      })
      const cases = generateTestCases(interaction)
      const sad = cases.find(c => c.type === 'sad')!
      expect(sad.interactions[0].value).toBe('')
    })

    it('edge test uses 5000 char string', () => {
      const interaction = makeInteraction({
        type: InteractionType.FILL,
        selector: '#email',
        value: 'user@test.com',
      })
      const cases = generateTestCases(interaction)
      const edge = cases.find(c => c.type === 'edge')!
      expect(edge.interactions[0].value).toHaveLength(5000)
      expect(edge.tags).toContain('overflow')
    })

    it('security test 1 uses XSS payload', () => {
      const interaction = makeInteraction({
        type: InteractionType.FILL,
        selector: '#email',
        value: 'user@test.com',
      })
      const cases = generateTestCases(interaction)
      const xss = cases.find(c => c.tags.includes('xss'))!
      expect(xss.interactions[0].value).toBe('<script>alert(1)</script>')
    })

    it('security test 2 uses SQLi payload', () => {
      const interaction = makeInteraction({
        type: InteractionType.FILL,
        selector: '#email',
        value: 'user@test.com',
      })
      const cases = generateTestCases(interaction)
      const sqli = cases.find(c => c.tags.includes('sqli'))!
      expect(sqli.interactions[0].value).toBe("' OR 1=1--")
    })
  })

  describe('ACT', () => {
    it('produces a happy test', () => {
      const interaction = makeInteraction({
        type: InteractionType.ACT,
        naturalLanguage: 'click login button',
      })
      const cases = generateTestCases(interaction)
      expect(cases).toHaveLength(1)

      const tc = cases[0]
      expect(tc.type).toBe('happy')
      expect(tc.name).toContain('click login button')
      expect(tc.tags).toContain('act')
    })
  })

  describe('EXTRACT', () => {
    it('produces a happy test', () => {
      const interaction = makeInteraction({
        type: InteractionType.EXTRACT,
        description: 'extract page title',
      })
      const cases = generateTestCases(interaction)
      expect(cases).toHaveLength(1)

      const tc = cases[0]
      expect(tc.type).toBe('happy')
      expect(tc.name).toContain('extract')
      expect(tc.tags).toContain('extract')
    })
  })

  describe('unhandled types', () => {
    it('ASSERT returns no test cases', () => {
      const interaction = makeInteraction({ type: InteractionType.ASSERT, selector: '#btn' })
      const cases = generateTestCases(interaction)
      expect(cases).toHaveLength(0)
    })

    it('EVALUATE returns no test cases', () => {
      const interaction = makeInteraction({ type: InteractionType.EVALUATE })
      const cases = generateTestCases(interaction)
      expect(cases).toHaveLength(0)
    })

    it('SNAPSHOT returns no test cases', () => {
      const interaction = makeInteraction({ type: InteractionType.SNAPSHOT })
      const cases = generateTestCases(interaction)
      expect(cases).toHaveLength(0)
    })

    it('DELEGATE returns no test cases', () => {
      const interaction = makeInteraction({ type: InteractionType.DELEGATE })
      const cases = generateTestCases(interaction)
      expect(cases).toHaveLength(0)
    })
  })
})
