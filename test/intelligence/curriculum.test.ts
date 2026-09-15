import { describe, it, expect } from 'vitest'
import { analyzeEngagement, type CurriculumReport } from '../../src/intelligence/curriculum'

describe('Curriculum', () => {
  it('produces a report from engagement data', () => {
    const report = analyzeEngagement({
      targetOrigin: 'example.com',
      outcomes: [
        { technique: 'SQLi', accepted: true },
        { technique: 'SQLi', accepted: true },
        { technique: 'XSS', accepted: false },
      ],
      mistakes: [
        { toolName: 'httpRequest', errorPattern: 'rate limited', occurrences: 3 },
      ],
      preferences: [
        { technique: 'SQLi', outcome: 'success' },
      ],
    })

    expect(report.targetOrigin).toBe('example.com')
    expect(report.lessons.length).toBeGreaterThan(0)
    expect(report.techniqueRankings.length).toBe(2) // SQLi and XSS
  })

  it('ranks techniques by success rate', () => {
    const report = analyzeEngagement({
      targetOrigin: 'example.com',
      outcomes: [
        { technique: 'SQLi', accepted: true },
        { technique: 'SQLi', accepted: true },
        { technique: 'SQLi', accepted: true },
        { technique: 'XSS', accepted: false },
        { technique: 'XSS', accepted: false },
      ],
      mistakes: [],
      preferences: [],
    })

    // SQLi should rank first (100% acceptance)
    expect(report.techniqueRankings[0].technique).toBe('SQLi')
    expect(report.techniqueRankings[0].recommendation).toBe('boost')
    // XSS should be deprioritized (0% acceptance)
    expect(report.techniqueRankings[1].recommendation).toBe('deprioritize')
    expect(report.topFailures).toContain('XSS')
  })

  it('includes mistake lessons for repeated errors', () => {
    const report = analyzeEngagement({
      targetOrigin: 'example.com',
      outcomes: [],
      mistakes: [
        { toolName: 'httpRequest', errorPattern: 'timeout', occurrences: 5 },
        { toolName: 'queryGraph', errorPattern: 'parse error', occurrences: 1 }, // Only 1 occurrence
      ],
      preferences: [],
    })

    // Should only include mistake with 2+ occurrences
    const mistakeLessons = report.lessons.filter(l => l.source === 'mistakes')
    expect(mistakeLessons).toHaveLength(1)
    expect(mistakeLessons[0].technique).toBe('httpRequest')
  })

  it('handles empty data', () => {
    const report = analyzeEngagement({
      targetOrigin: 'example.com',
      outcomes: [],
      mistakes: [],
      preferences: [],
    })

    expect(report.lessons).toHaveLength(0)
    expect(report.techniqueRankings).toHaveLength(0)
    expect(report.topFailures).toHaveLength(0)
  })
})
