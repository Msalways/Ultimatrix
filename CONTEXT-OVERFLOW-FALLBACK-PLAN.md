# Context Overflow Fallback + Model Config Plan

## Problem Statement

When the LLM provider returns HTTP 400 (`context_length_exceeded`), the system throws and the turn dies. The user must manually intervene. This plan adds:

1. **Message-level compaction** — operates on the actual `messages[]` array sent to the provider
2. **Reactive overflow recovery** — catch 400, compact, retry (max 2 attempts)
3. **Proactive pre-send check** — estimate full message array tokens before sending

## Design Principles

- **No hardcoded model names in logic** — `modelCapabilities` config is the only source of truth
- **No substring/regex error detection** — classify overflow from structured data (HTTP status + our own pre-send estimate), not error message text
- **No bandaids** — each component has a single responsibility, no fallback chains that paper over design gaps
- **No redundant config sections** — `modelCapabilities` already has `contextWindow` + `maxOutputTokens`; just add `reservedMargin` as an optional field

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    Config (YAML)                                  │
│  modelCapabilities:          # ALREADY EXISTS — no new section   │
│    <provider/model>:                                              │
│      contextWindow: <number>                                      │
│      maxOutputTokens: <number>                                    │
│      reservedMargin: <number>  # NEW optional field, default 1024│
│      strengths: [...]                                             │
│      supportsStreaming: true                                       │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│  ContextWindowRegistry                                            │
│  resolve(modelId) → { contextWindow, maxOutputTokens, margin }   │
│                                                                   │
│  Resolution order:                                                │
│  1. config.modelCapabilities[modelId]       (user-configured)     │
│  2. null                                    (unknown → reactive)  │
│                                                                   │
│  No hardcoded fallback map. Unknown = null → reactive handles it. │
└───────────────────────────┬──────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌────────────────────────┐
│ Proactive       │ │ Reactive        │ │ Forensic               │
│ (pre-send)      │ │ (catch + retry) │ │ (every compaction)     │
│                 │ │                 │ │                        │
│ estimateTokens  │ │ catch 400 →     │ │ compact-event logged   │
│ on full msgs[]  │ │ classify via    │ │ with strategy +        │
│ If > contextW:  │ │ estimate + HTTP │ │ tokens saved +         │
│ compact pre-send│ │ status (typed)  │ │ model ID               │
└─────────────────┘ └─────────────────┘ └────────────────────────┘
                            │
                   ┌────────▼────────┐
                   │ MessageCompactor │
                   │                 │
                   │ Progressive     │
                   │ compaction of   │
                   │ messages[]:     │
                   │ L1: tool results│
                   │ L2: old turns   │
                   │ L3: goal/context│
                   └─────────────────┘
```

---

## Task Breakdown

### Phase 1: ContextWindowRegistry (config-driven model limits)

- [x] **T1.1** Add `reservedMargin?: number` to `ModelCapability` in `src/config.ts`
  - Optional field, default 1024 tokens (safety buffer)
  - No new config section — `modelCapabilities` already has `contextWindow` + `maxOutputTokens`

- [x] **T1.2** Create `src/models/context-window-registry.ts`
  - `ContextWindowEntry` interface: `{ contextWindow: number, maxOutputTokens: number, reservedMargin: number }`
  - `ContextWindowRegistry` class with `resolve(modelId)`, `getContextWindow(modelId)`, `fitsInContext(modelId, inputTokens, outputTokens)`
  - Resolution: `config.modelCapabilities[modelId]` → `null`
  - No hardcoded model names. No default fallback map. Unknown model = `null` (reactive path handles it)
  - `reservedMargin` reads from `ModelCapability.reservedMargin ?? 1024`

- [x] **T1.3** Create `test/models/context-window-registry.test.ts`
  - Config-driven resolution from modelCapabilities
  - Unknown model returns null (not a fallback number)
  - `fitsInContext()` correctly compares with margin
  - Empty config → all models unknown → null
  - `reservedMargin` default 1024 applied when not specified
  - `reservedMargin` from config used when specified

### Phase 2: MessageCompactor (progressive messages[] compaction)

- [x] **T2.1** Create `src/models/message-compactor.ts`
  - `CompactionPass` interface: `{ strategy: string, label: string, compactedTokens: number }`
  - `CompactionResult` interface: `{ messages: any[], passes: CompactionPass[], totalTokensSaved: number, originalEstimate: number, finalEstimate: number }`
  - `compactMessages(messages, tokenBudget, options?)` function
  - Uses existing `compactText()` from `output/compaction.ts` for text reduction (no new compaction logic)
  - `estimateTokens()` uses the same heuristic as `context-manager.ts` (words * 1.3 + code overhead)

- [x] **T2.2** Implement L1: Tool result compaction
  - Find messages with `role === 'tool'` where content length exceeds threshold
  - Apply `compactText()` with `strategy: 'section-aware'` to compress
  - System/user/assistant messages untouched
  - Forensic: `{ strategy: 'tool-results', label: 'L1', compactedTokens }`

- [x] **T2.3** Implement L2: Old turn summarization
  - Sliding window: keep last `keepRecent` turn pairs (default: 4) intact
  - Older turns: collapse into a single summary message: `"Previous context: [summary of N turns]"`
  - Summary uses `compactText()` with `strategy: 'head-tail'` on the concatenated old turns
  - Forensic: `{ strategy: 'old-turns', label: 'L2', compactedTokens }`

- [x] **T2.4** Implement L3: Goal/context compaction
  - Identify the most recent `role: 'user'` message (the enriched goal)
  - Apply `compactText()` with `strategy: 'section-aware'` to compress
  - Keep the message structure intact, only reduce content length
  - Forensic: `{ strategy: 'goal-context', label: 'L3', compactedTokens }`

- [x] **T2.5** Progressive execution logic
  - Try L1 first → check if under budget → if yes, stop
  - If still over budget → try L2 → check → stop if under
  - If still over budget → try L3 → check → stop if under
  - `maxPasses` option (default: 3) prevents infinite compaction
  - If all passes done and still over budget → return result with `finalEstimate` (caller decides)

- [x] **T2.6** Create `test/models/message-compactor.test.ts`
  - L1: Tool results get compacted, system/user messages untouched
  - L2: Old turns summarized, recent turns preserved
  - L3: Goal compressed, core content retained
  - Progressive: L1 insufficient → escalates to L2
  - Empty/short messages pass through unchanged
  - Forensic provenance tracked in `passes[]`
  - `maxPasses` limit enforced
  - All messages are role === 'system' → no compaction (nothing to compact)

### Phase 3: OverflowHandler (reactive catch + retry)

- [x] **T3.1** Create `src/models/overflow-handler.ts`
  - `classifyOverflow(err, estimatedTokens, contextWindow)` function
  - Returns `{ isOverflow: boolean, reason: string }` — typed, not substring-based
  - Detection logic: `err.status === 400` AND `estimatedTokens > contextWindow - reservedMargin`
  - If `contextWindow` is null (unknown model): `err.status === 400` alone triggers compaction attempt
  - No message text parsing. No `err.message.includes(...)`. No regex.

- [x] **T3.2** `withOverflowRecovery(originalCall, args, modelId, registry, config)` function
  - Wraps a `doStream`/`doGenerate` call
  - Pre-send: estimate total tokens in `args.messages` using `estimateTokens()`
  - If pre-send estimate > contextWindow: compact messages before sending
  - If provider returns 400 + classifyOverflow = true: compact + retry (max 2 compaction retries)
  - If retry also fails: throw original error (don't mask non-overflow 400s)
  - Log every compaction event to forensic log with strategy, tokens saved, model ID

- [x] **T3.3** Create `test/models/overflow-handler.test.ts`
  - classifyOverflow: HTTP 400 + estimated > contextWindow → overflow
  - classifyOverflow: HTTP 400 + estimated < contextWindow → not overflow (different 400)
  - classifyOverflow: HTTP 429 → not overflow (rate limit, handled elsewhere)
  - classifyOverflow: HTTP 500 → not overflow
  - Recovery: overflow → compact → retry → success
  - Recovery: overflow → compact → retry → still overflow → throw
  - Max 2 compaction retries enforced
  - Unknown model (null registry) → HTTP 400 → attempt compaction anyway
  - Forensic event logged on every compaction

### Phase 4: Middleware Wiring

- [x] **T4.1** Modify `src/models/middleware.ts` — integrate overflow recovery
  - In the `doStream`/`doGenerate` proxy handler, after message sanitization:
    1. Resolve `ContextWindowRegistry` from config
    2. Call `withOverflowRecovery(originalCall, args, modelId, registry, config)`
  - The existing rate-limit retry loop stays unchanged
  - Overflow recovery wraps the ENTIRE retry loop (outer layer)
  - Flow: `sanitize → overflow-check → rate-limit-retry → originalCall`

- [x] **T4.2** Update `src/models/context-manager.ts` — use registry as primary lookup
  - Add optional `registry?: ContextWindowRegistry` to constructor
  - `getContextWindow(modelId)`: registry → null (no hardcoded fallback)
  - `truncateToFit()`: use registry for budget calculation when available
  - Backward-compatible: existing callers without registry continue to work

- [x] **T4.3** Update `src/solver/solver.ts` — use registry in pre-flight check
  - Lines 580-644: replace `caps && caps[params.model]` with registry lookup
  - Create `ContextWindowRegistry(params.config)` and pass to `ContextBudgetManager`
  - When registry returns null for unknown model: skip pre-flight check, rely on reactive path

- [x] **T4.4** Verify `test/models/middleware.test.ts` still passes
  - Existing tests use mock models — they should continue to work
  - Add new test: overflow recovery triggered on HTTP 400 when estimate exceeds context
  - Add new test: overflow recovery NOT triggered on HTTP 400 when estimate is within context

### Phase 5: Deprecate Hardcoded Context Map

- [x] **T5.1** Mark `CONTEXT_WINDOW_MAP` in `src/config.ts` as `@deprecated`
  - Add JSDoc: `@deprecated Use config.modelCapabilities instead. Will be removed in v9.`
  - Keep the map for backward compatibility — existing users without `modelCapabilities` still get legacy behavior
  - Add runtime warning: when `CONTEXT_WINDOW_MAP` is used as fallback, log a deprecation notice

- [x] **T5.2** Update `computeLastMessages()` in `src/config.ts`
  - Use `ContextWindowRegistry` when available, fall back to `CONTEXT_WINDOW_MAP` only when registry is null
  - Same deprecation warning

- [x] **T5.3** Update `CONFIG_EXAMPLES.md` with `reservedMargin` documentation
  - Show `reservedMargin` as optional field in `modelCapabilities`
  - Explain that `CONTEXT_WINDOW_MAP` is deprecated

---

## Anti-Bandaid Checklist

| Check | Status |
|-------|--------|
| No hardcoded model names in logic | PASS — `modelCapabilities` is config-driven; code references `modelId` strings from config |
| No substring/regex error detection | PASS — overflow classified via `err.status === 400` + pre-send token estimate |
| No fallback map that goes stale | PASS — `CONTEXT_WINDOW_MAP` deprecated, `modelCapabilities` config is source of truth |
| No blind truncation | PASS — compaction uses `compactText()` with section-aware strategy, forensic provenance |
| No infinite retry loops | PASS — max 2 compaction retries, max 3 rate-limit retries (existing) |
| No assumptions about model capabilities | PASS — unknown model → null → reactive path handles it |
| No redundant config sections | PASS — `reservedMargin` added to existing `ModelCapability`, no new `contextWindows` section |
| Platform-native interception | PASS — middleware Proxy intercepts `doStream`/`doGenerate` (the actual transport layer) |
| Typed forensic tracking | PASS — every compaction event logged with strategy, tokens saved, model ID |

## Files Summary

### New Files (3 source + 3 test)
| File | Purpose |
|------|---------|
| `src/models/context-window-registry.ts` | Config-driven model context window lookup |
| `src/models/message-compactor.ts` | Progressive compaction of messages[] array |
| `src/models/overflow-handler.ts` | Overflow detection + recovery wrapper |
| `test/models/context-window-registry.test.ts` | Registry unit tests |
| `test/models/message-compactor.test.ts` | Compactor unit tests |
| `test/models/overflow-handler.test.ts` | Overflow handler unit tests |

### Modified Files (4)
| File | Change |
|------|--------|
| `src/config.ts` | Add `reservedMargin?: number` to `ModelCapability` |
| `src/models/middleware.ts` | Integrate overflow recovery wrapper |
| `src/models/context-manager.ts` | Use registry as primary lookup |
| `src/solver/solver.ts` | Use registry in pre-flight context check |

### Deprecated (not deleted)
| File | Change |
|------|--------|
| `src/config.ts` `CONTEXT_WINDOW_MAP` | Mark `@deprecated`, keep for backward compat |

## User Config Example

```yaml
provider: groq
model: llama3-8b-8192

# Existing modelCapabilities — add reservedMargin as optional field
modelCapabilities:
  groq/llama3-8b-8192:
    contextWindow: 8192
    maxOutputTokens: 2048
    reservedMargin: 512        # optional, default 1024 — safety buffer
    strengths: [speed]
    supportsStreaming: true
    supportsStructuredOutput: false
  groq/llama-3.3-70b-versatile:
    contextWindow: 131072
    maxOutputTokens: 8192
    strengths: [general]
    supportsStreaming: true
    supportsStructuredOutput: true
  openai/gpt-4o:
    contextWindow: 128000
    maxOutputTokens: 16384
    strengths: [reasoning, coding]
    supportsStreaming: true
    supportsStructuredOutput: true
  anthropic/claude-3-5-sonnet:
    contextWindow: 200000
    maxOutputTokens: 8192
    strengths: [reasoning, analysis]
    supportsStreaming: true
    supportsStructuredOutput: true
  google/gemini-2.5-pro:
    contextWindow: 1048576
    maxOutputTokens: 65536
    strengths: [long-context]
    supportsStreaming: true
    supportsStructuredOutput: true
```

## Execution Order

1. T1.1 → T1.2 → T1.3 (Registry — standalone, no deps)
2. T2.1 → T2.2 → T2.3 → T2.4 → T2.5 → T2.6 (Compactor — standalone, uses existing `compactText()`)
3. T3.1 → T3.2 → T3.3 (Overflow handler — depends on 1+2)
4. T4.1 → T4.2 → T4.3 → T4.4 (Wiring — depends on 3)
5. T5.1 → T5.2 → T5.3 (Deprecation — depends on 4)

## Verification

After all phases:
- `npm test` — full suite passes (existing + new tests)
- `npm run build:cli` — clean build
- `npm run lint` — no new errors
- Manual test: configure a small context window model, send oversized prompt, verify compaction + retry works
