/**
 * Decisive diagnostic for B10: does a council member's agent.generate() hang?
 *
 * Runs one council member (strategist) the same way council/factory.ts does,
 * calls agent.generate() with a hard 60s Promise.race timeout, and writes the
 * result/error to a file SYNCHRONOUSLY (fs.writeFileSync) so it survives a
 * hang/kill — bypassing pino (async) and piped-stdout buffering.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { readFileSync, existsSync } from 'node:fs'

const OUT = resolve(process.cwd(), 'e2e-runs/diag-council-generate.txt')
mkdirSync(resolve(process.cwd(), 'e2e-runs'), { recursive: true })
function syncLog(s: string) {
  writeFileSync(OUT, s + '\n', { flag: 'a' })
}

syncLog('=== diag start ' + new Date().toISOString() + ' ===')

async function main() {
  // Load config + providers the same way the app does.
  const { loadConfig } = await import('../src/config')
  const config = loadConfig()
  syncLog('config loaded: engine=' + config.engine + ' provider=' + config.provider + ' model=' + config.model)

  const { createAgent } = await import('../src/mastra')
  const { personaFor } = await import('../src/council/personas')

  // Minimal deps the factory passes (browser/skillRegistry/workerPool may be
  // needed by createAgent for Stagehand tools — we pass undefined and see what happens).
  const skill = {
    id: 'council-strategist',
    name: 'Council strategist',
    tier: 'balanced',
    description: personaFor('strategist').slice(0, 80),
    toolRefs: [],
    triggers: [],
    tags: [],
    instructions: personaFor('strategist'),
  } as any

  const agent = createAgent(config, {
    skills: [skill],
    extraTools: {},
  } as any)
  syncLog('agent created')

  const prompt = 'Reply with a single JSON object: {"intent":"propose","proposal":{"action":"test","skillId":"xss","impact":"low","complexity":"low","reasoning":"diag"}}'
  syncLog('calling agent.generate() with 60s timeout...')

  const gen = agent.generate(prompt)
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_60s')), 60000))
  const result = await Promise.race([gen, timeout]) as any
  syncLog('GENERATE OK — text length=' + (result?.text?.length ?? 0))
  syncLog('text[:500]=' + String(result?.text ?? '').slice(0, 500))
}

main().then(() => {
  syncLog('=== diag OK ===')
  process.exit(0)
}).catch((err) => {
  syncLog('DIAG ERROR: ' + (err?.message ?? String(err)))
  syncLog('stack: ' + (err?.stack ?? '').split('\n').slice(0, 5).join(' | '))
  process.exit(1)
})
