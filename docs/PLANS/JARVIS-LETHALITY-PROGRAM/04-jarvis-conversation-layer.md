# 04. Jarvis Conversation Layer (Phase D)

## Goal

Deliver the "Jarvis buddy" experience: a named, persistent, proactive conversational security partner over the existing REPL/web surfaces, with first-class skill management (add/import/upload with validation) and knowledge that flows back into every turn.

## Current State

- **No assistant identity**: brain-instructions.ts:5 says "single assistant"; council members have names ("The Architect") but the brain does not. Banner is product-level only (lifecycle.ts:734).
- **Conversation exists but is reactive-only**: terminal REPL loop (lifecycle.ts:714-778) with slash commands; session threads resume across sessions (lifecycle.ts:204-222); web `/api/solve` is one-goal-per-POST SSE (route.ts:67-113) though server-side thread continuity already exists (engine.ts:381-443); chat-history is display-only (300 messages, not LLM context).
- **Skill management is config-file-only**: `configureSkillSources(dirs)` (loader.ts:63) has exactly one caller — `applyConfigExtensions` at extensions/index.ts:25. Extra dirs namespace as `user/<id>` (loader.ts:215). `skillsDirs` edits in web settings require restart (config-store.ts:22 RESTART_FIELDS). Read-only `GET /api/skills`; no import route.
- **refs/ subdirectories** supported and surfaced via `loadSkillReference` (loader.ts:151-173, skill-tools.ts).
- **Validation drift-guards exist** for toolRefs (test/skills/tool-wiring-drift.test.ts vs TOOL_IDS) and primitives (primitive-wiring.test.ts) — import-time validation can reuse this exact logic.

## Gaps Addressed

The product answers when asked; it never opens with state, suggests next moves, remembers persona across sessions, or lets the user/agent grow its own knowledge base at runtime.

## In Scope

### 1. Persona & voice
- Config `assistant: { name?: string, tone?: 'concise-wit' | 'plain' }`, default name `jarvis`.
- Persona prose in `getBrainInstructions()` composing: identity, voice contract (proactive briefing opener, evidence-first claims, propose-then-consent for risky actions per buddy-not-master rule, wit allowed in framing never in findings), session-recap behavior on resume.
- Session resume (lifecycle.ts:210) becomes a conversational recap generated from graph-diff-since-last-session + `src/intelligence/session-resume.ts` continuity data.

### 2. Briefing / debrief loop (deterministic, relation-native)
- **Briefing**: built from typed queries only — target summary, coverage gaps (`getUntestedWorkarounds` family), untested workflows, pending approvals, captured-request count (CapturedRequestStore), top-3 suggested moves ranked by existing orchestration diagnosis signals. Rendered at REPL start + on demand via `/brief`. Same digest feeds the runtime envelope (spec 01) — one builder, two renderings (prose for human, refs for model).
- **Debrief**: solver already snapshots graph deltas per turn (solver.ts:601-616); surface as a closing prose line (findings landed, endpoints added, attack paths found).

### 3. Skill management (first-class)
- **CLI**: `ultimatrix skills add <path|git-url>` → fetch/copy into external skills dir (`skillsDirs[0]` or `workspace/skills-user/`) → validate → hot-reload index (`resetSharedSkillIndex()` — no restart).
- **Runtime tool** `manageSkills` (brain tool): list-imported / add (from pasted markdown or path) / remove / reload. Lets the agent ingest user-supplied skills mid-conversation.
- **Web**: `POST /api/skills` (file upload or pasted markdown) + skills panel listing bundled vs imported with source labels.
- **Import-time validation gate** (structural lesson from the P0 stripped-skills audit):
  - frontmatter completeness; folder-name == `name`
  - BOM strip before parse (known gotcha)
  - `toolRefs ⊆ TOOL_IDS` (reuse drift-guard logic)
  - `primitives ⊆ primitive registry` (reuse wiring-guard logic)
  - non-empty fenced blocks required — a payload-stripped skill is rejected at the door
  - fail-closed rejection with precise error list; nothing partial lands
- **Curated packs**: documented importer flow for agentskills.io-standard libraries (Apache-2.0 MITRE-mapped security collections) — same SKILL.md standard, land as `user/<id>`.
- Remove restart requirement: web engine + CLI re-invoke `configureSkillSources` + reset shared index on change.

### 4. Surfaces & parity
- Terminal stays primary and native/plain-text (Ink TUI remains retired by decision).
- Web chat gains briefing card + debrief line + skills panel; SSE already carries all needed event types.

## Out of Scope

- Voice/audio interfaces; any Stark-universe naming beyond the configurable default.
- Skill marketplace/registry service (local + git sources only).
- Autonomous skill *authoring* by the agent (only ingestion of user-provided content).
- Changing council personas or HITL approval semantics.

## Public Types / Interfaces

```typescript
// config
assistant?: { name?: string; tone?: 'concise-wit' | 'plain' }

// src/tools/skill-manage-tools.ts (NEW)
manageSkills: createTool<{ action:'list'|'add'|'remove'|'reload', source?, id? }, ...>

// src/app/api/skills/route.ts
POST /api/skills { name, markdown } | multipart file   // validated import

// CLI
ultimatrix skills add <path|git-url>
ultimatrix skills list

// src/runtime/briefing.ts (NEW)
buildBriefing(services): { prose: string, refsForModel: string[] }
```

## Data Flow

User adds skill (any surface) → validator gate → lands in external dir → shared index reset → immediately discoverable to brain/workers/council (single index guarantee already holds). Briefing builder reads graph/workflow/capture stores directly (no LLM) → prose rendered locally; refs block appended to enriched goal. Debrief derives from solver's existing per-turn delta snapshot.

## Failure Modes

- Imported skill contains prompt injection → treated as untrusted content like any target data (existing rule); validation is structural, content is sandboxed by existing instruction-hierarchy rules.
- Git import pulls arbitrary repo code → skills are markdown-only; importer refuses non-.md files except refs/*.md and rejects symlinks/path traversal.
- Hot-reload races an in-flight turn → resetSharedSkillIndex already rebuilds atomically; document that mid-turn toolsets resolve at prepareStep.
- Persona bloats prompt → persona section ≤150 words, inside spec-01 word cap.
- Web import DoS → size caps (e.g., 256KB/skill), rate-limit route.

## Tests

- Validator gate: each rejection path (bad frontmatter, name mismatch, unknown toolRef, unknown primitive, empty fences, oversized) with precise errors; happy path lands + reloads.
- manageSkills tool: add/list/remove/reload round-trip against temp dir.
- POST /api/skills: valid import 201, invalid 400 with error list, traversal refused.
- Briefing: fixture graph → expected prose sections + model refs; zero network calls (pure store reads).
- Debrief: delta snapshot → single-line summary containing finding title.
- Persona: instructions contain configured name; still zero TOOL_IDS matches.
- Resume recap: second session on same thread produces recap referencing prior findings.

## Acceptance Criteria

- [ ] Fresh REPL opens with named briefing including suggested moves without user asking.
- [ ] User pastes a skill in conversation → agent imports it via manageSkills → it appears in searchSkills within the same session.
- [ ] A deliberately stripped/poisoned skill file is rejected by the import gate with actionable errors.
- [ ] agentskills.io-format third-party skill imports and is selectable by the registry.
- [ ] Web UI shows imported skills without process restart.
- [ ] Full suite green; evals unchanged-green.

## Dependencies

Spec 01 (envelope/builder shared with briefing). Nothing else blocking.
