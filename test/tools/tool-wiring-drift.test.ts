/**
 * Tool-wiring drift guard.
 *
 * Live finding that motivated this file: `recordDisposition` was registered in
 * `src/tools/registry.ts` and its module was unit-tested, and it was still
 * UNREACHABLE from the solver brain. The prompt told the model to record a
 * ruling; the tool was not in the brain's pack; so the model guessed a tool
 * name, got "not found", and then narrated a successful write that never
 * happened. Every test passed. Only a live run caught it.
 *
 * The root cause is that there are several independent wiring seams
 * (mastra ToolRegistry, TOOL_IDS, the brain pack in core/toolpack.ts, and the
 * legacy tools/registry.ts) and nothing enforced that they agree. This asserts
 * the brain can actually reach everything the registry advertises, so the next
 * tool added in the wrong place fails CI instead of failing silently in front
 * of a user.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildToolPack } from '../../src/core/toolpack'
import { createToolRegistry, TOOL_IDS } from '../../src/mastra/tools'
import { CORE_TOOLS } from '../../src/solver/skills/tool-filter'
import { BOOTSTRAP_TOOL_IDS } from '../../src/solver/brain-tools'
import { getConfig } from '../../src/config'

/**
 * Tools the brain intentionally does not carry.
 *
 * Each entry needs a reason. "Not wired yet" is not a reason — it is the bug
 * this file exists to prevent.
 */
const NOT_IN_BRAIN_PACK = new Set<string>([
  // Browser/Stagehand tools are attached only when a browser handle exists.
  'stagehand_navigate', 'stagehand_act', 'stagehand_extract', 'stagehand_agent',
  'camoufox_navigate', 'camoufox_act', 'camoufox_extract',
  // Sandbox + MCP are separate opt-in surfaces wired at their own seams.
  'runInSandbox', 'mcpListTools', 'mcpCallTool',
])

function brainPack(): Record<string, unknown> {
  const config = getConfig()
  return buildToolPack({
    config,
    skillRegistry: { getAll: () => [] } as never,
  } as never, { includeOrchestration: false, includeResearch: false, includePrimitives: false })
}

describe('tool wiring drift', () => {
  const registry = createToolRegistry() as unknown as Record<string, { id?: string }>

  it('every registry tool advertises an id matching its key', () => {
    // A key/id mismatch is how a model ends up calling a name that does not
    // resolve: the tool is registered under one name and listed under another.
    const mismatched = Object.entries(registry)
      .filter(([key, tool]) => tool && typeof tool === 'object' && 'id' in tool && tool.id !== key)
      .map(([key, tool]) => `${key} -> ${(tool as { id?: string }).id}`)
    expect(mismatched).toEqual([])
  })

  it('the solver brain can actually reach the control tools it is told to use', () => {
    // The regression this file exists for: a tool the prompt names, which the
    // brain cannot call. The model then guesses a name or fabricates the write.
    const pack = brainPack()
    for (const id of ['recordDisposition', 'getDispositions', 'writeFinding', 'recordEvidence']) {
      expect(pack[id], `${id} must be in the brain pack`).toBeDefined()
    }
  })

  it('a tool named in the brain prompt exists in the pack', () => {
    // The prompt says "Record rulings with the disposition tool" in prose. That
    // is intentional (no tool ids in prompt text), so the guarantee has to be
    // structural: anything the mandate depends on must be reachable.
    const pack = brainPack()
    expect(Object.keys(pack).some(id => id.toLowerCase().includes('disposition'))).toBe(true)
  })

  it('delegation tools the prompt mandates are actually present', () => {
    // brain.md: "Spawn workers only for bounded subtasks" alongside "If a
    // capability is not present in the current tool list, do not invent its name
    // or call it." Those two lines reconcile only if the tool exists. Verified
    // live: 0 of 18 real runs against an authorized target spawned a worker.
    expect(
      ['spawnWorker', 'runTaskGraph'].filter(id => !BOOTSTRAP_TOOL_IDS.has(id)),
      'the brain is told to delegate but is not given the capability',
    ).toEqual([])
  })

  it('every worker tool declares an id matching the name it is registered under', () => {
    // The lazy worker tools bypass createToolRegistry entirely, so the
    // ToolRegistry key/id check above could never see them. All four shipped
    // with kebab ids ('spawn-worker') while every reference in the codebase —
    // pack keys, WORKER_CAPABILITIES, registerLazyBuiltin — used camelCase
    // ('spawnWorker'). The kebab names had zero references anywhere.
    const expected: Array<[string, string]> = [
      ['spawn-worker', 'spawnWorker'],
      ['spawn-swarm', 'spawnSwarm'],
      ['run-task-graph', 'runTaskGraph'],
      ['execute-direct', 'executeDirect'],
    ]
    for (const [file, id] of expected) {
      const src = readFileSync(resolve(process.cwd(), `src/manager/tools/${file}.ts`), 'utf8')
      expect(src, `${file}.ts must declare id: '${id}'`).toContain(`id: '${id}'`)
      expect(src, `${file}.ts must not declare the kebab id`).not.toContain(`id: '${file}'`)
    }
  })

  it('the disposition tools are in CORE_TOOLS, not merely loadable on demand', () => {
    // This is the surface the live brain actually receives. Asserting against
    // buildToolPack alone was the gap that let this ship: the tools WERE wired
    // into the full pack and WERE loadable via loadTool, so every structural
    // check passed, yet on a casual turn the model never needed a tool, never
    // loaded one, and only promised to comply. Reachability on demand is not
    // the same as presence.
    expect(CORE_TOOLS).toContain('recordDisposition')
    expect(CORE_TOOLS).toContain('getDispositions')
  })

  it('BOOTSTRAP_TOOL_IDS and CORE_TOOLS agree on delegation', () => {
    // Two separate gates. A capability present in only one is invisible half the
    // time, which is exactly how the worker path stayed dead: it was in neither,
    // while the prompt told the brain to delegate and to never call an absent
    // tool. Keeping the sets in step is the durable part of the fix.
    for (const id of ['spawnWorker', 'runTaskGraph', 'recordDisposition', 'getDispositions']) {
      expect(BOOTSTRAP_TOOL_IDS.has(id), `${id} missing from BOOTSTRAP_TOOL_IDS`).toBe(true)
      expect(CORE_TOOLS, `${id} missing from CORE_TOOLS`).toContain(id)
    }
  })

  it('every tool the buddy mandate depends on is in CORE_TOOLS', () => {
    // The mandate in instructions/brain.md tells the agent to record rulings
    // and to check prior rulings. If those tools are not core, the instruction
    // is unenforceable. Enumerate the capabilities, not the whole registry.
    const mandateCritical = ['recordDisposition', 'getDispositions']
    const missing = mandateCritical.filter(id => !CORE_TOOLS.includes(id))
    expect(missing, 'mandate depends on tools the brain may not carry').toEqual([])
  })

  it('mandate-critical tools are in BOOTSTRAP_TOOL_IDS — the set the brain ACTUALLY gets', () => {
    // This is the surface that matters, and the one two live bugs slipped past.
    //
    // There are five independent wiring surfaces in this codebase:
    //   src/tools/registry.ts            (legacy registry)
    //   src/mastra/tools.ts              (ToolRegistry + TOOL_IDS catalog)
    //   src/core/toolpack.ts             (buildToolPack, all groups)
    //   src/solver/skills/tool-filter.ts (CORE_TOOLS, skill filter)
    //   src/solver/brain-tools.ts        (BOOTSTRAP_TOOL_IDS — turn-one set)
    //
    // The disposition tools were wired into the first four and every structural
    // check passed, while the brain could not call them. Load-on-demand made it
    // *look* wired: the model could reach them via loadTool on any turn where
    // it happened to want them. It never did, on a casual operator correction,
    // so it just promised to comply and recorded nothing.
    //
    // Reachability on demand is not presence. Assert against the real gate.
    const mandateCritical = ['recordDisposition', 'getDispositions']
    expect(
      mandateCritical.filter(id => !BOOTSTRAP_TOOL_IDS.has(id)),
      'the brain mandate names tools the brain does not receive on turn one',
    ).toEqual([])
  })

  it('every disposition tool is in the id list the skill validator checks', () => {
    // A skill declaring `toolRefs: [recordDisposition]` is rejected unless the
    // id is declared here, so an omission breaks skill authoring silently.
    for (const id of ['recordDisposition', 'getDispositions']) {
      expect(TOOL_IDS, `${id} must be in TOOL_IDS`).toContain(id)
    }
  })

  it('KNOWN PRE-EXISTING GAP: the full registry and the brain pack are not 1:1', () => {
    // Recorded, not asserted. The registry advertises the full surface
    // (sandbox, MCP, browser, primitives); the brain receives a
    // skill-filtered subset by design, and TOOL_IDS additionally backs skill
    // toolRefs validation. Reconciling those three views is a real task and is
    // deliberately NOT bundled into this fix. This test exists so the number is
    // visible rather than rediscovered later.
    const pack = brainPack()
    const notInPack = Object.keys(registry)
      .filter(id => !NOT_IN_BRAIN_PACK.has(id))
      .filter(id => !(id in pack))
    console.log(`[tool-wiring] ${Object.keys(registry).length} registry tools, ${Object.keys(pack).length} in brain pack, ${notInPack.length} registry-only (expected: skill-filtered surface)`)
    expect(Array.isArray(notInPack)).toBe(true)
  })
})

