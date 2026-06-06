# Block 9: Fix spawn-agent creation and orchestrator info-flow

## Problem

The user reported two related complaints after running v4 in production:

1. "We are not properly creating spawn agents" — sub-agents that try to spawn
   sub-sub-agents are silently dropped with a fake success result. The
   sub-agent's LLM believes it succeeded and burns its turn budget on noops.

2. "Those informations are not properly passed to orchestrator" — when a
   sub-agent finishes, the meta-orchestrator's next turn sees only a tiny
   summary string ("sub-agent done: vulnerable, 1 findings"). No finding
   data, no per-turn reasoning, no per-tool request/response data.

## Code-level findings (from `src/agents/` read)

### Bug 1: Silent `spawnAgent` swallow with fake success
`src/agents/sub-agent.ts:184-199` — when a sub-agent calls `spawnAgent`, the
code pushes an "ignored" observation and returns `result.ok = true` with a
fake "success" string. The sub-agent LLM sees success and will try again.

### Bug 2: Sub-agent findings carry no detail back to meta-orchestrator
- `sub-agent.ts:69, 162-166, 254-267` — sub-agent collects `findings` and
  `observations`, returns them on `SubAgentRun`.
- `agent-loop.ts:188-220` — meta-orchestrator puts `subRun.findings` into
  `allFindings` and `subRun.observations` into the meta turn's
  `observations` field. Good.
- `agent-trace.ts:114-149 summarizeTrace` — when the meta-orchestrator's
  NEXT turn runs, it sees only `Findings: <count>`, `Outcome: <word>`,
  and first 10 × 200 chars of observations. No finding payloads, no
  per-turn thoughts, no per-tool data.
- `agent-loop.ts:209-212` — the `result.value` for the meta turn is
  the tiny "sub-agent done" string.
- `SubAgentRun.findings` is typed `Array<Record<string, unknown>>` —
  loosely typed, can't be introspected downstream.

### Bug 3: Sub-agent LLM auto-observations silently drop large results
`sub-agent.ts:225-233` — only records observations when `value.length < 300`.
`compareResponses` and `parseResponse` return large objects, get dropped.

## Fix

### 1. `src/agents/sub-agent.ts`

- Add `depth?: number` (default 0) and `allowSpawn?: boolean` (default
  `depth < 2`) to `SubAgentOptions`.
- When `allowSpawn === false`, filter `spawnAgent` out of the sub-agent's
  allowed tool set at the schema layer so the LLM never asks for it.
  When `allowSpawn === true`, support real recursive `spawnAgent` calls
  (call `runSubAgent` with `depth: opts.depth + 1`, attach the sub-sub
  result to the parent's trace via `subSubAgents`).
- Drop the 300-char observation gate. Always record. Cap each
  observation at 800 chars with `(truncated N chars)` suffix.
  Distinguish string vs object values: objects get a structured
  `{<shape summary>, excerpt: <500 chars>}`.
- Type `findings: AppModelFinding[]` instead of
  `Array<Record<string, unknown>>`.

### 2. `src/agents/agent-loop.ts`

- Pass `depth: 0` when calling `runSubAgent` from the meta-orchestrator
  path.
- `result.value` for sub-agent turn becomes a structured object:
  `{ outcome, findingsCount, turnsCount, observationsCount, durationMs,
     subSubAgents, note }`.

### 3. `src/agents/agent-trace.ts`

- `SubAgentRun.findings` → `AppModelFinding[]`.
- `SubAgentRun` gains `parentId?: string` and `subSubAgents: SubAgentRun[]`
  so the trace is a proper tree.
- `summarizeTrace` recurses into `subSubAgents`. For each sub-agent emit
  three subsections: `### Findings` (all findings, one line each),
  `### Reasoning trace` (per-turn thoughts + tool + result), and
  `### Observations` (first 30 × 300 chars).
- Default cap raised from 4000 to 8000 chars with `…(truncated N chars)`.
- `TraceBuilder.addFinding(finding: AppModelFinding)` — typed signature,
  internal storage stays `Record<string, unknown>` for serialization.

### 4. Tests

`tests/agents/sub-agent.test.ts` (new) + extend `tests/agents/agent-trace.test.ts`.

~14-15 new tests:

- Sub-agent at depth 0 with `allowSpawn: true` can spawn a sub-sub-agent;
  sub-sub-agent runs and its findings propagate up.
- Sub-agent at depth 2 gets `allowSpawn: false`; `spawnAgent` is filtered
  from its tool set.
- Sub-agent at depth 2 calling `spawnAgent` gets `result.ok === false`
  with "max recursion depth reached" error.
- Sub-agent calling tool not in its set gets `result.ok === false`.
- Sub-agent `compareResponses` with 2KB diff produces a structured
  observation.
- Sub-agent `findEndpointsInResponse` with 5 endpoints produces a
  structured observation.
- Sub-agent `writeFinding` accepted → outcome `vulnerable`, break,
  finding in return.
- Sub-agent `writeFinding` rejected → outcome unchanged, observation
  recorded.
- `summarizeTrace` with 2 sub-agents + 3 findings each: all 6 findings
  appear, not just counts.
- `summarizeTrace` with 1 sub-agent + 1 sub-sub-agent: full tree, both
  `subSubAgents[]` and `findings` shown.
- `summarizeTrace` truncates at 8000 chars with marker.
- `summarizeTrace` includes per-turn reasoning.
- Meta-orchestrator with 2 parallel sub-agents: all findings in
  `result.findings`, all traces in `result.trace.subAgents`.
- `result.value` for sub-agent turn is the structured object.
- Recursion depth cap: sub-sub-sub-agent (depth 3) is filtered out,
  never runs.

### 5. Verification

- `npx vitest run` — expect 855 + ~14 = ~869 pass, 8 skipped
- `npx tsc --noEmit` — 0 errors
- `npx tsup` — clean build

## Out of scope

- Not changing 21 primitives, 9 specialists, LLM prompts, or `composer.ts`
- Not adding a context-budget eviction policy
- Not touching TUI/HuntCore/diff/zip layers
- No "real-time observer" complexity (that's Block 11, killed)
- No `__name` shim work (that's Block 9 in the post-v4 plan, but this
  block is the spawn-orchestrator fix; we'll keep block numbers distinct
  in the memory block)

## Estimates

- **LOC**: ~350 net (3 file edits + 1 new test file + extensions)
- **Tests**: 855 → ~869 (+14)
- **Effort**: ~3 hours coding + 30 min verification
- **Risk**: low — recursive spawn is gated by depth, no behavior change
  for depth ≤ 1 flows

## Commit message

`feat(block-9): real recursive sub-agents + proper orchestrator info-flow`
