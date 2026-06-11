import { describe, it, expect } from 'vitest'
import { InteractionType } from './interaction'
import type { Interaction, TestCase, Assertion, Session } from './interaction'

describe('InteractionType enum', () => {
  it('has all expected values', () => {
    expect(InteractionType.GOTO).toBe('goto')
    expect(InteractionType.CLICK).toBe('click')
    expect(InteractionType.FILL).toBe('fill')
    expect(InteractionType.ASSERT).toBe('assert')
    expect(InteractionType.EXTRACT).toBe('extract')
    expect(InteractionType.ACT).toBe('act')
    expect(InteractionType.DELEGATE).toBe('delegate')
    expect(InteractionType.EVALUATE).toBe('evaluate')
    expect(InteractionType.SNAPSHOT).toBe('snapshot')
  })

  it('has 9 distinct values', () => {
    const values = Object.values(InteractionType)
    expect(values).toHaveLength(9)
    expect(new Set(values).size).toBe(9)
  })
})

describe('Interaction interface', () => {
  it('shapes are valid with required fields', () => {
    const interaction: Interaction = {
      id: 'test-id',
      type: InteractionType.GOTO,
      timestamp: 123456789,
      sessionId: 'session-1',
      description: 'test interaction',
    }
    expect(interaction.id).toBe('test-id')
    expect(interaction.type).toBe('goto')
  })

  it('shapes are valid with all fields', () => {
    const interaction: Interaction = {
      id: 'i-1',
      type: InteractionType.FILL,
      timestamp: Date.now(),
      sessionId: 's-1',
      parentId: 'p-1',
      description: 'fill input',
      url: 'http://example.com',
      selector: '#email',
      value: 'test@test.com',
      naturalLanguage: 'type email',
      metadata: { source: 'test' },
    }
    expect(interaction.selector).toBe('#email')
    expect(interaction.metadata?.source).toBe('test')
  })
})

describe('Assertion interface', () => {
  it('shapes correctly', () => {
    const assertion: Assertion = {
      id: 'a-1',
      interactionId: 'i-1',
      type: 'visible',
      selector: '#btn',
      expected: 'true',
      passed: true,
    }
    expect(assertion.type).toBe('visible')
  })
})

describe('TestCase interface', () => {
  it('shapes correctly', () => {
    const tc: TestCase = {
      id: 'tc-1',
      name: 'test case',
      type: 'happy',
      description: 'a test',
      interactions: [],
      assertions: [],
      tags: ['smoke'],
      endpoint: '/api',
      method: 'POST',
    }
    expect(tc.type).toBe('happy')
    expect(tc.tags).toContain('smoke')
  })
})

describe('Session interface', () => {
  it('shapes correctly', () => {
    const session: Session = {
      id: 's-1',
      name: 'my session',
      targetUrl: 'http://example.com',
      startedAt: Date.now(),
      interactions: [],
      testCases: [],
    }
    expect(session.targetUrl).toBe('http://example.com')
  })
})
