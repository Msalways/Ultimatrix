import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public resume wiring', () => {
  it('routes CLI resume through lifecycle setup and durable task recovery', async () => {
    const [cli, session, setup] = await Promise.all([
      readFile(join(process.cwd(), 'src/cli/index.ts'), 'utf8'),
      readFile(join(process.cwd(), 'src/session.ts'), 'utf8'),
      readFile(join(process.cwd(), 'src/runtime/lazy-services.ts'), 'utf8'),
    ])

    expect(cli).toContain("case 'resume':")
    expect(cli).toContain('await main(target)')
    expect(session).toContain("config.engine === 'legacy'")
    expect(setup).toContain('await taskCoordinator.recoverInterrupted()')
  })

  it('keeps the CI command JSON-only and versioned', async () => {
    const cli = await readFile(join(process.cwd(), 'src/cli/index.ts'), 'utf8')
    expect(cli).toContain("case 'ci':")
    expect(cli).toContain('buildCiAssessmentResult')
    expect(cli).toContain('JSON.stringify(result)')
    expect(cli).toContain('ciExitCode(result, failOn)')
  })
})
