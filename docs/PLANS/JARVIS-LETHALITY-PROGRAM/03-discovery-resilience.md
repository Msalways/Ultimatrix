# 03. Discovery Resilience (Phase C)

## Goal

Make discovery coverage honest and multi-surface: a frontier that actually drains, endpoint records that don't lie, revived dead discovery code, and typed hypothesis persistence — so coverage stats and campaign matrices reflect reality.

## Current State (audit findings, all verified with file:line)

- **Frontier is decorative.** `runSpiderRuntime` enqueues the target but nothing dequeues (`src/spider/runtime.ts:552`); stream end falls through to `stopReason ??= 'frontier_exhausted'` (:612) even with hundreds of queued URLs. `shouldStopByLimits` judges max_depth from frontier contents, not traversal (:452-456).
- **Stale detection counts only tool-result chunks** (:596-603): a text-only model burns the whole budget without registering staleness.
- **Baseline grounding conflates pages with endpoints**: every `<a href>` becomes a GET Endpoint node (:660-670), inflating endpoint counts that drive campaign matrices and the "already crawled" heuristic (lifecycle.ts:547). Nav/footer/social links pollute.
- **Dead designed seams**: `src/capture/js-miner.ts` (`mineJsEndpoints`) has zero production callers; `shadowApiDiscovery` is registered for the brain but absent from the spider agent toolpack (agent.ts:28-61).
- **Hypotheses persisted as Fact nodes** despite `intentsWritten` naming (har-bridge.ts:198-205) — Intent node type unused in this pipeline; INTENT-edge relation queries find nothing.
- **Silent evidence loss**: bodies >1MB dropped with no truncation marker (cdp-network-capture.ts:76); CDP builder ignores `redirectResponse` so 3xx hops vanish (har-parser.ts:676-693); timings always `{}`.
- **Anti-bot module violates standing constraint #3**: VENDOR_PATTERNS regex-on-title/body + frozen selector lists + iframe substring checks (anti-bot.ts:40-148,197); `[data-sitekey]` false-positives on any embedded widget.
- Fallback HAR capture launches a *separate anonymous* browser (har-capture.ts:11-16) — no session cookies, doubles target load.

## Gaps Addressed

Coverage statistics, campaign planning, and re-test continuity are built on inflated/lying data; designed discovery surfaces are unwired; evidence philosophy (truncation must be structurally flagged) is violated in capture.

## In Scope

1. **Honest frontier**: dequeue actually drives traversal limits and stopReasons; `frontier_exhausted` only when queue truly empty; per-URL depth tracked on dequeue.
2. **Stale accounting**: record progress on every model round (text or tool), not only tool-results.
3. **Endpoint hygiene**: nav links recorded as Page references / discovered-links facts, NOT Endpoint nodes; Endpoint nodes reserved for actionable request surfaces (forms, XHR/API calls, param-bearing paths). Migration note: graph consumers reading totalEndpoints must tolerate the drop.
4. **Revive js-miner**: feed captured script/HTML bodies from the capture layer to `mineJsEndpoints`; candidate routes land as proposed endpoints through the existing proposed-scope/approval path.
5. **Wire shadowApiDiscovery into the spider toolpack** + auto-run once at crawl completion (it composes httpRequest → scope/robots/rate-limit/evidence inherited).
6. **Typed hypotheses**: har-bridge writes Intent nodes (NodeType.INTENT + PRODUCED edges) instead of Facts; rename counter honestly.
7. **Evidence fidelity**: >1MB bodies stored truncated WITH structural `wasTruncated` marker (mirror CompressionResult contract); merge `redirectResponse` hops into proper chained entries; populate timings where the platform provides them.
8. **Structured challenge signals**: replace VENDOR_PATTERNS regexes with typed detection — status codes (403/503 + server headers), `cf-mitigated` header, response-shape fields. No title/body regexes, no selector lists.
9. **Fallback capture honesty**: when the standalone-browser fallback fires, label its HAR source as 'anonymous-fallback' in workflow state (consumers can distinguish session capture from cold-capture).

## Out of Scope

- Full HTTP-first frontier drainer (deferred; revisit after Camoufox proves out — spec 02 task list keeps this decision documented).
- New discovery surfaces beyond js-miner/shadow wiring.
- Changing spider event schema (typed events stay).

## Public Types / Interfaces

```typescript
// src/spider/runtime.ts
interface FrontierEntry { url: string; depth: number; discoveredVia: string }
dequeue(): FrontierEntry | null          // NEW — real traversal driver

// src/capture/har-parser.ts (builder)
entry.extra = { wasTruncated?: boolean, redirectChain?: string[] }   // NEW optional block

// src/browser/anti-bot.ts
interface ChallengeSignal { kind: 'status'|'header'|'shape', detail: string }
detectChallenge(page): { challenged: boolean, signals: ChallengeSignal[] }  // typed, no regex
```

## Data Flow

Dequeue drives both LLM-browser crawl AND future non-browser passes; discovered links enqueue with depth. js-miner output enters as proposed endpoints (approval flow from Slice 03 governs out-of-origin proposals). Shadow discovery runs post-crawl against same scope boundary. Hypothesis Intents join the relation graph → queryable via queryRelations (INTENT edges finally populated).

## Failure Modes

- Endpoint-count drop breaks downstream heuristics → audit lifecycle.ts:547 "already crawled" check and campaign planner inputs; update thresholds deliberately, not silently.
- js-miner floods proposed queue → cap candidates per crawl (config), dedupe by normalized key.
- Redirect-chain merging double-counts requests → chain under one entry with `redirectChain` list, matching HAR semantics.
- Challenge-signal false negatives vs regex era → keep human-solve wait path; log unmatched challenge shapes as evidence for iteration.

## Tests

- Frontier: enqueue/dequeue/depth/stopReason matrix incl. "stream ended early" → honest reason.
- Stale: text-only rounds trigger stale threshold.
- Link→Page vs form/XHR→Endpoint classification fixtures.
- js-miner: captured body → proposed endpoints (deduped, capped, approval-gated).
- har-bridge: hypotheses produce INTENT nodes + PRODUCED edges (relation query finds them).
- Builder: truncation marker present at >1MB; redirect chain preserved.
- anti-bot: typed signals on fixture responses; no regexes in module (source scan test like other no-vocab guards).

## Acceptance Criteria

- [ ] stopReasons truthful across early-exit, limit, stale, error cases (eval-style case added).
- [ ] Endpoint totals reflect actionable surfaces only; campaign matrices consume cleaned input.
- [ ] js-miner + shadow discovery live in the crawl path with approval gating intact.
- [ ] Zero regex/substring detection in anti-bot module (guard test green).

## Dependencies

Spec 02 task 8 shares challenge-detection-at-launch work — coordinate. Otherwise independent.
