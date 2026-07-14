/**
 * Eval harness: drives `ultimatrix interact -t <target>` as a scripted "human"
 * and records, per turn:
 *   - the LLM (Hex) response text
 *   - which worker-trigger tools fired (spawnWorker / spawnSwarm / executeDirect /
 *     runPrimitive / runCampaign)  → signals autonomy / "master" behavior
 *   - whether the agent called askUser  → signals "buddy / mutual" behaviour
 *   - tool call count per turn
 *
 * Ground truth is the forensic NDJSON log (workspace target dir). Stdout `→ tool`
 * lines are a secondary signal.
 *
 * KEY INTERACTION DETAIL (verified in src/tools/interaction-tools.ts):
 *   `askUser` / `askUserConfirm` read from the SAME readline as the REPL. So when
 *   the agent calls askUser, the next stdin line is consumed as the ANSWER, NOT as
 *   a new turn. Therefore we feed a scripted answer immediately after each human
 *   line so the REPL never blocks. If the agent asks a question we didn't script,
 *   the harness supplies a default "y" / "done" answer.
 *
 * Usage:
 *   npx tsx scripts/eval-interact.ts --scenario scripts/eval-scenarios.json [--target <url>] [--out <dir>]
 */

import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const WORKSPACE = resolve(process.cwd())

interface Turn {
  human: string
  expect: 'conversational' | 'hunting'
  expectWorkers?: boolean
  expectAskUser?: boolean
  /** Answer to feed if the agent interrupts with askUser during this turn. */
  answer?: string
  note?: string
}

interface Scenario {
  name: string
  target: string
  turns: Turn[]
}

interface TurnResult {
  index: number
  human: string
  expect: string
  expectWorkers: boolean
  expectAskUser: boolean
  agentText: string
  workerTriggers: string[]
  askUserCalls: number
  toolCalls: number
  workerMatch: boolean | null
  askUserMatch: boolean | null
  conversationalCorrect: boolean
  flags: string[]
}

const WORKER_TOOLS = ['spawnWorker', 'spawnSwarm', 'executeDirect', 'runPrimitive', 'runCampaign']

function parseArgs(argv: string[]): { scenario?: string; target?: string; out?: string } {
  const out: any = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--target') out.target = argv[++i]
    else if (a === '--scenario') out.scenario = argv[++i]
    else if (a === '--out') out.out = argv[++i]
  }
  return out
}

function resolveForensic(target: string): string {
  const safe = target.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return resolve(WORKSPACE, 'output', safe, 'forensic.ndjson')
}

/**
 * Run the interact REPL as a stateful "human".
 *
 * The REPL reads from a readline that is NOT listening until it prints its `> `
 * prompt. So we cannot dump all stdin at spawn time (it gets dropped / misread).
 * Instead we feed reactively:
 *   - when a `> ` prompt appears and we still have unsent human turns, send the
 *     next human line.
 *   - when the agent calls askUser (we see `→ askUser` or the HITL banner), send
 *     the scripted answer for the current turn (default "done"). This is the
 *     "mutual / buddy" interaction we are evaluating.
 *   - after the last human turn completes and the REPL prints its next `> `, we
 *     close stdin so the REPL exits cleanly.
 *
 * We also surface a per-turn raw capture so the report can quote exact LLM text.
 */
function runInteractive(scenario: Scenario): Promise<{
  stdout: string
  perTurnRaw: string[]
}> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('node', ['dist/index.js', 'interact', '-t', scenario.target], {
      cwd: WORKSPACE,
      env: { ...process.env, HEADLESS: 'true' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    const input = proc.stdin

    let sentHuman = 0
    // per-turn raw capture: everything printed between consecutive `> ` prompts.
    const perTurnRaw: string[] = []
    let turnBuf = ''
    let inTurn = false

    const PROMPT_RE = /(^|\n)> /

    const sendHumanLine = () => {
      if (sentHuman >= scenario.turns.length) return
      const turn = scenario.turns[sentHuman]
      input.write(turn.human + '\n')
      sentHuman++
      inTurn = true
      turnBuf = ''
    }

    const sendAnswer = () => {
      // Answer the askUser interrupt for the most recently sent human turn.
      const turn = scenario.turns[sentHuman - 1]
      input.write((turn?.answer ?? 'done') + '\n')
    }

    const maybeFeed = (text: string) => {
      // Detect a fresh `> ` prompt.
      if (PROMPT_RE.test(text)) {
        if (inTurn) {
          // The agent finished the previous turn; capture it.
          perTurnRaw.push(turnBuf)
          turnBuf = ''
          inTurn = false
        }
        if (sentHuman < scenario.turns.length) {
          sendHumanLine()
        } else {
          // All turns sent and this is the final prompt → end the session.
          input.end()
        }
        return
      }

      // While a turn is active, accumulate text and watch for askUser interrupts.
      if (inTurn) {
        turnBuf += text
        if (/→\s*askUser|HITL\]|need your help/i.test(text)) {
          // The agent is blocked on human input → send the scripted answer.
          sendAnswer()
        }
      }
    }

    proc.stdout.on('data', (d) => {
      const s = d.toString()
      stdout += s
      maybeFeed(s)
    })
    proc.stderr.on('data', (d) => {
      const s = '[stderr] ' + d.toString()
      stdout += s
      maybeFeed(s)
    })

    let finished = false
    proc.on('close', () => {
      if (finished) return
      finished = true
      if (inTurn && turnBuf) perTurnRaw.push(turnBuf)
      resolvePromise({ stdout, perTurnRaw })
    })
    proc.on('error', (e) => reject(e))

    // Safety: force-close after a generous wall-clock budget (per-turn LLM calls
    // on nemotron-3-super can be slow).
    setTimeout(() => {
      if (!finished) {
        finished = true
        try { input.end() } catch { /* ignore */ }
        if (inTurn && turnBuf) perTurnRaw.push(turnBuf)
        resolvePromise({ stdout, perTurnRaw })
      }
    }, 900_000)
  })
}

/**
 * Parse per-turn records from the stateful feeder's perTurnRaw capture.
 * perTurnRaw[i] is the exact text the REPL printed during turn i (everything
 * between the prompt that started the turn and the prompt that ended it).
 * terminal:false means the human line is NOT echoed, so the whole chunk is the
 * agent response + tool markers. We extract:
 *   - worker tool triggers (→ spawnWorker / spawnSwarm / executeDirect / runPrimitive / runCampaign)
 *   - askUser calls (→ askUser / HITL banner)
 *   - tool call count (→ <tool>)
 *   - agent text (everything except the `→ tool` dim lines and log prefixes)
 */
function parseTurns(perTurnRaw: string[]): { text: string; workers: string[]; askUser: number; toolCalls: number }[] {
  const results: { text: string; workers: string[]; askUser: number; toolCalls: number }[] = []
  for (const seg of perTurnRaw) {
    const workers: string[] = []
    for (const w of WORKER_TOOLS) {
      const re = new RegExp(`→\\s*${w}`, 'gi')
      const m = seg.match(re)
      if (m) workers.push(...Array(m.length).fill(w))
    }
    const askUser = (seg.match(/→\s*askUser/gi) || []).length
    const toolCalls = (seg.match(/→\s*\S+/g) || []).length

    // Agent text = strip the dim `  → tool` lines and log-prefixed lines.
    const text = seg
      .split('\n')
      .filter((l) => !/^\s*→\s/.test(l) && !/^(INFO|WARN|ERROR|DEBUG)\s+\[/.test(l))
      .join('\n')
      .trim()

    results.push({ text, workers, askUser, toolCalls })
  }
  return results
}

function loadForensic(path: string): any[] {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf-8')
  const out: any[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* ignore malformed */ }
  }
  return out
}

function classify(scenario: Scenario, parsed: ReturnType<typeof parseTurns>): TurnResult[] {
  const results: TurnResult[] = []
  scenario.turns.forEach((turn, i) => {
    const p = parsed[i] || { text: '', workers: [], askUser: 0, toolCalls: 0 }
    const workerTriggers = Array.from(new Set(p.workers))
    const hasWorkers = p.workers.length > 0
    const expectWorkers = turn.expectWorkers ?? (turn.expect === 'hunting')
    const workerMatch = hasWorkers === expectWorkers
    const askUserExpected = turn.expectAskUser ?? false
    const askUserMatch = p.askUser > 0 === askUserExpected

    const conversationalCorrect: boolean =
      turn.expect === 'conversational'
        ? !hasWorkers
        : (hasWorkers || p.askUser > 0)

    const flags: string[] = []
    if (turn.expect === 'conversational' && hasWorkers) {
      flags.push('AUTO_PILOT_LEAK: conversational turn triggered workers (master/slave)')
    }
    if (turn.expect === 'hunting' && !hasWorkers && p.askUser === 0) {
      flags.push('PASSIVE: hunting turn did neither work nor ask (idle)')
    }
    if (p.askUser > 0) {
      flags.push('MUTUAL: agent asked the human a question (buddy signal)')
    }

    results.push({
      index: i,
      human: turn.human,
      expect: turn.expect,
      expectWorkers,
      expectAskUser: askUserExpected,
      agentText: p.text.slice(0, 2500),
      workerTriggers,
      askUserCalls: p.askUser,
      toolCalls: p.toolCalls,
      workerMatch,
      askUserMatch,
      conversationalCorrect,
      flags,
    })
  })
  return results
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const scenarioPath = args.scenario || resolve(WORKSPACE, 'scripts', 'eval-scenarios.json')
  if (!existsSync(scenarioPath)) {
    console.error('Scenario file not found: ' + scenarioPath)
    process.exit(1)
  }
  const scenario: Scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'))
  if (args.target) scenario.target = args.target

  const outDir = args.out || resolve(WORKSPACE, 'evals', 'interact-' + Date.now())
  mkdirSync(outDir, { recursive: true })

  runInteractive(scenario).then(({ stdout, perTurnRaw }) => {
    writeFileSync(resolve(outDir, 'raw-stdout.txt'), stdout)
    if (perTurnRaw.length) writeFileSync(resolve(outDir, 'per-turn-raw.json'), JSON.stringify(perTurnRaw, null, 2))
    const parsed = parseTurns(perTurnRaw)
    const forensic = loadForensic(resolveForensic(scenario.target))
    const results = classify(scenario, parsed)

    const report = {
      scenario: scenario.name,
      target: scenario.target,
      timestamp: new Date().toISOString(),
      forensicPath: resolveForensic(scenario.target),
      forensicEventCount: forensic.length,
      turns: results,
      summary: {
        total: results.length,
        conversationalLeaks: results.filter((r) => r.flags.some((f) => f.startsWith('AUTO_PILOT_LEAK'))).length,
        mutualTurns: results.filter((r) => r.askUserCalls > 0).length,
        turnsWithWorkers: results.filter((r) => r.workerTriggers.length > 0).length,
        workerExpectMatches: results.filter((r) => r.workerMatch).length,
        askUserExpectMatches: results.filter((r) => r.askUserMatch).length,
      },
    }
    writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))

    console.log('\n=== EVAL REPORT: ' + scenario.name + ' ===')
    console.log('Target: ' + scenario.target)
    console.log('Forensic events: ' + forensic.length)
    console.log('Turns: ' + results.length)
    console.log('  Conversational "autopilot leaks" (master/slave): ' + report.summary.conversationalLeaks)
    console.log('  Turns where agent asked the human (mutual/buddy): ' + report.summary.mutualTurns)
    console.log('  Turns that triggered workers: ' + report.summary.turnsWithWorkers)
    console.log('  Worker-expectation matches: ' + report.summary.workerExpectMatches + '/' + results.length)
    console.log('  AskUser-expectation matches: ' + report.summary.askUserExpectMatches + '/' + results.length)
    console.log('')
    results.forEach((r) => {
      console.log(`--- Turn ${r.index + 1}: "${r.human}" (expect=${r.expect})`)
      if (r.workerTriggers.length) console.log('    workers: ' + r.workerTriggers.join(', '))
      if (r.askUserCalls) console.log('    askUser calls: ' + r.askUserCalls)
      console.log('    toolCalls: ' + r.toolCalls)
      if (r.flags.length) console.log('    flags: ' + r.flags.join('; '))
      console.log('    agentText (head): ' + r.agentText.slice(0, 280).replace(/\n/g, ' '))
    })
    console.log('\nReport written to: ' + resolve(outDir, 'report.json'))
    process.exit(0)
  }).catch((err) => {
    console.error('Eval failed:', err)
    process.exit(1)
  })
}

main()
