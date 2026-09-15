import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('compatibility boundaries', () => {
  it('keeps public Web and CLI entrypoints free of engagement-sensitive compatibility getters', async () => {
    const files = [
      'src/cli/index.ts',
      'src/cli/solve.ts',
      'src/web/engine.ts',
      'src/web/session-registry.ts',
      'src/web/persisted-graph.ts',
      'src/app/api/chat-history/route.ts',
      'src/app/api/browser/route.ts',
      'src/app/api/status/route.ts',
    ]
    const sources = await Promise.all(files.map(file => readFile(join(process.cwd(), file), 'utf8')))
    for (const source of sources) expect(source).not.toMatch(/\bgetGlobal[A-Z]/)
  })

  it('requires explicit extension registries and graph-bound result stores', async () => {
    const [extensions, tools, results] = await Promise.all([
      readFile(join(process.cwd(), 'src/extensions/index.ts'), 'utf8'),
      readFile(join(process.cwd(), 'src/extensions/tool-tools.ts'), 'utf8'),
      readFile(join(process.cwd(), 'src/graph/tool-result-store.ts'), 'utf8'),
    ])
    expect(extensions).not.toContain('getGlobalToolRegistry')
    expect(tools).not.toContain('getGlobalToolRegistry')
    expect(results).not.toContain('let _instance')
  })

  it('keeps provider limits and pending finding evidence engagement-owned', async () => {
    const [limiters, quota, findings] = await Promise.all([
      readFile(join(process.cwd(), 'src/models/limiter-factory.ts'), 'utf8'),
      readFile(join(process.cwd(), 'src/models/quota-tracker.ts'), 'utf8'),
      readFile(join(process.cwd(), 'src/tools/control-tools.ts'), 'utf8'),
    ])
    expect(limiters).toContain('getEngagementServices()')
    expect(limiters).toContain('outside engagement context')
    expect(limiters).not.toContain('legacyLimiterCache')
    expect(quota).toContain('outside engagement context')
    expect(quota).not.toContain('_globalQuotaTracker')
    expect(findings).toContain('getEngagementServices()')
    expect(findings).toContain('outside engagement context')
    expect(findings).not.toContain('legacyFindingState')
    expect(findings).not.toContain('const evidenceBuffer = new Map')
    expect(findings).not.toContain('let _evidenceGate')
  })
})
