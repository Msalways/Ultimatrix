/**
 * B10 isolation diagnostic: run debateOnce() with STUB members (no browser, no
 * network) and sync-file logging. Proves whether the orchestrator logic itself
 * hangs, or whether the hang is in the real LLM/browser `respond` path.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(process.cwd(), 'e2e-runs/diag-debateonce.txt')
mkdirSync(resolve(process.cwd(), 'e2e-runs'), { recursive: true })
function syncLog(s: string) {
  writeFileSync(OUT, s + '\n', { flag: 'a' })
}
syncLog('=== debateOnce stub diag ' + new Date().toISOString() + ' ===')

async function main() {
  const { debateOnce } = await import('../src/council/orchestrator')
  const { ConversationBus } = await import('../src/council/bus')
  const { SharedBlackboard } = await import('../src/council/blackboard-shared')
  const { defaultCouncilConfig } = await import('../src/council/personas')

  const bus = new ConversationBus()
  const blackboard = new SharedBlackboard()

  // Stub members: return structured proposals immediately, no LLM.
  const stubMember = (role: string) => ({
    role,
    id: `stub-${role}`,
    tier: 'balanced' as const,
    respond: async () => ({
      text: 'stub',
      intent: 'propose' as const,
      proposal: {
        action: `test-${role}`,
        skillId: 'xss',
        endpointId: 'https://public-firing-range.appspot.com/',
        complexity: 'low' as const,
        impact: 'low' as const,
        reasoning: 'stub',
      },
    }),
  })

  const members = [
    stubMember('strategist'),
    stubMember('operator'),
    stubMember('skeptic'),
    stubMember('analyst'),
    { role: 'human', id: 'stub-human', tier: 'balanced' as const, respond: async () => ({ text: '', intent: 'propose' as const }) },
  ]

  const config = defaultCouncilConfig()
  syncLog('config loaded, calling debateOnce with 90s timeout...')

  const race = Promise.race([
    debateOnce({
      members: members as any,
      bus,
      blackboard,
      goal: 'test goal',
      config,
      execute: async () => 'executed-stub',
      humanApprove: async () => true,
      onPhase: (phase: string, round: number, text?: string) => syncLog(`  onPhase: ${phase} r${round} ${text ?? ''}`),
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('DIAG_TIMEOUT_90s')), 90000)),
  ])

  const result = (await race) as any
  syncLog('DEBATEONCE OK')
  syncLog('  complete=' + result.complete)
  syncLog('  proposedTasks=' + JSON.stringify(result.proposedTasks))
  syncLog('  summary=' + (result.summary ?? '').slice(0, 300))
}

main().then(() => {
  syncLog('=== diag OK ===')
  process.exit(0)
}).catch((err) => {
  syncLog('DIAG ERROR: ' + (err?.message ?? String(err)))
  syncLog('stack: ' + (err?.stack ?? '').split('\n').slice(0, 6).join(' | '))
  process.exit(1)
})
