# Gap Fix Plan — No Bandaids, No Hardcoded Conditions

## Executive Summary

This plan addresses **13 identified gaps** in the data-driven architecture implementation:
- **5 CRITICAL gaps**: LibSQL store missing merge methods, mergedPayloads unused, weaker merge logic, Recent Discoveries explosion, no transactions
- **4 HIGH priority gaps**: Wordlist bootstrap, no rate limiting, schema validation, context window limits
- **4 MEDIUM/LOW priority gaps**: Audit trail, metrics, deduplication, payload source validation

All fixes follow the architectural principles: **no hardcoded enumerations, no regex/substring detection, no bandaids, no instructive prompts**.

---

## Gap 1: LibSQL Store Missing mergeEndpoint() and mergePage()

### Root Cause
The plan specified mirroring `mergeEndpoint()` and `mergePage()` from `store.ts` to `store-libsql.ts`, but these methods were never implemented. Capture modules call `mergeEndpoint()` which only exists in file-based store.

### Impact
- LibSQL users (persistent storage) cannot benefit from read-before-write deduplication
- Data loss risk when multiple capture modules write to same endpoint/page
- Inconsistent merge semantics between file and LibSQL stores

### Design Solution

#### 1.1: Mirror mergeEndpoint() in store-libsql.ts

**Approach**: Copy the careful dedup logic from `store.ts` to LibSQL implementation.

**Fields to merge** (no hardcoded values, derived from `EndpointNode['properties']` schema):
- `headers`: Case-insensitive dedup by name, append new, preserve order
- `params`: Dedup by name, preserve existing params with richer data
- `tags`: Dedup, append
- `source`: Append to existing comma-separated sources, dedup within sources
- Optional fields only merged when present and existing field is undefined:
  - `authRequired`, `authType`, `bodySchema`, `description`

**No hardcoded enumerations**: Use TypeScript type `Partial<EndpointNode['properties']>` for validation.

#### 1.2: Mirror mergePage() in store-libsql.ts

**Approach**: Similar to mergeEndpoint but for PageNode.

**Fields to merge**:
- `title`: Keep existing if present
- `contentType`: Keep existing if present
- `contentLength`: Keep existing if present
- `tags`: Dedup, append
- `sessionId`: Append if new

**No hardcoded defaults**: Use `PageNode['properties']` type to check which fields exist.

#### 1.3: Add read-before-write validation to tests

**Tests**: Add to `test/capture/read-before-write.test.ts`:
- Test GraphStore.mergeEndpoint with custom headers/params/tags/sources
- Test LibSQLGraphStore.mergeEndpoint with same scenarios
- Verify both stores produce identical results for same inputs
- Verify LibSQL store preserves existing data (no overwrite)

**No hardcoded assertions**: Use schema-based validation to compare results.

---

## Gap 2: mergedPayloads Computed But Never Used by Production Primitives

### Root Cause
`framework.ts` computes `ctx.mergedPayloads` but doesn't provide it to primitives for payload selection. Primitives still use their own `generate()` payloads + `PayloadStore`. The infrastructure is dead code.

### Impact
- Hybrid payload generation feature is not functional in production
- No mechanism to blend static payloads from PayloadStore with LLM-crafted payloads
- No feedback loop to learn which LLM-crafted payloads work

### Design Solution

#### 2.1: Add mergePayloads() helper to PayloadStore

**Approach**: Centralized payload merging logic that primitives can call.

**Interface**:
```typescript
interface PayloadMergeContext {
  staticPayloads: string[] // From PayloadStore
  llmPayloads: string[] // From ctx.payloads
  dedup: boolean // Whether to dedup
  preserveCase?: boolean // Whether to preserve original case
}

interface MergedPayloads {
  all: string[]
  bySource: { static: string[]; llm: string[] }
  uniqueIds: string[]
}
```

**Implementation**:
- No hardcoded wordlists or pattern matching
- Deduplication via Set with configurable case sensitivity
- Return structured object with both merged list and breakdown

**Why not in framework.ts**: PayloadStore owns the payload lifecycle (PayloadStore.ts already exists).

#### 2.2: Add loadPayloadsForVulnType() to PayloadStore

**Approach**: Load static payloads for a specific vulnerability type.

**Interface**:
```typescript
loadPayloadsForVulnType(
  vulnType: string,
  payloadSet?: PayloadSet
): string[]
```

**Implementation**:
- Read from `payloads/*.json` files keyed by vuln type
- No hardcoded assumptions about payload structure
- Return flat array of payload strings for primitives to use

#### 2.3: Update TechniqueContext to include payload loading helper

**Approach**: Add optional `loadPayloads()` method to TechniqueContext.

**Implementation**:
- Pass PayloadStore instance to TechniqueContext
- Primitives call `ctx.loadPayloads('sqli', { category: 'error-based' })`
- Returns merged list combining static + LLM payloads

**No hardcoded category names**: Use schema-based validation, not string constants.

#### 2.4: Refactor classicInjection to use merged payloads

**Approach**: Change classicInjection to use merged payloads instead of its own generate().

**Implementation**:
- Remove custom payload list generation from classicInjection.generate()
- Call `ctx.loadPayloads('sqli', { category: 'error-based' })`
- Filter and adapt based on endpoint params (no hardcoded SQL patterns)
- Return AttackStep[] with correct payloads

**No hardcoded SQL patterns**: Use `classicInjection`'s existing domain logic but feed it merged payloads.

#### 2.5: Refactor all 28 primitives to use merged payloads

**Approach**: Systematically update each primitive.

**Process**:
1. For each primitive, identify its vulnType (from schema)
2. Add `loadPayloads(ctx.loadPayloads('vulnType', { category: X }))` call
3. Remove duplicate payload generation code
4. Ensure step.metadata.payloadSource is correctly tagged (llm vs static)

**No hardcoded payloads**: All payloads come from PayloadStore + LLM context.

**Primitives to update**:
- classicInjection (sqli)
- secondOrderSqli (sqli)
- nosqlInjection (nosql)
- sstiBlind (ssti)
- ssrfMultiCloud (ssrf)
- ssrfOast (ssrf)
- authBypass (auth)
- authzMatrix (authz)
- idorSwapper (idor)
- invariantProbe (logic)
- workflowBypass (logic)
- configTrust (config)
- ldapXpathInjection (ldap)
- rceClass (rce)
- headerInjection (header)
- concurrencyHarness (race)
- aiTrust (ai)
- ssrfMetadata (ssrf)
- internalStateDisclosure (disclosure)
- businessLogicAbuse (logic)
- artifactLifetime (lifetime)
- aTOChain (ato)
- aiAgentAttack (ai)
- bolaFuzzer (bola)
- boplaOracle (bola)
- tenantIsolation (tenant)
- graphqlBola (graphql)
- deserialization (deserialization)
- smuggling (smuggling)

#### 2.6: Add payload selection validation in EvidenceGate

**Approach**: Validate that step.metadata.payloadSource is appropriate.

**Implementation**:
- Check if payload is in `ctx.payloads` (LLM-crafted) or from PayloadStore (static)
- Reject invalid combinations (e.g., source='llm' but not in ctx.payloads)
- No hardcoded rules, just structural validation

#### 2.7: Update tests to test actual payload usage

**Tests**:
- Test that primitives use merged payloads (not custom generate)
- Test that PayloadStore is called with correct vulnType
- Test that merged payloads are correctly tagged (llm vs static)
- Test that deduplication works across static + LLM payloads

**No hardcoded assertions**: Use schema validation to verify outputs.

---

## Gap 3: LibSQL Store Has Weaker Merge Logic

### Root Cause
`upsertPage()` in store-libsql.ts uses simple spread merge instead of field-aware dedup like store.ts. Headers, params, tags are not deduplicated, causing duplicates.

### Impact
- LibSQL store accumulates duplicate headers/params/tags
- Data inconsistency between file-based and LibSQL stores
- Memory/performance degradation over time

### Design Solution

#### 3.1: Replace upsertPage() merge logic in store-libsql.ts

**Approach**: Use same dedup logic as store.ts but adapted for database operations.

**Implementation**:
- For headers: Case-insensitive dedup by name using Set
- For params: Dedup by name, preserve existing params
- For tags: Dedup using Set
- For source: Append to existing comma-separated list, dedup

**No hardcoded field names**: Use `PageNode['properties']` interface to check which fields exist.

#### 3.2: Add dedup validation to tests

**Tests**:
- Test that LibSQL store doesn't duplicate headers when merging
- Test that LibSQL store preserves existing fields when merging new data
- Compare results between file-based and LibSQL stores for same inputs
- Verify no data loss in LibSQL merge operations

**No hardcoded expected values**: Use schema validation to verify deduplication.

---

## Gap 4: Wordlist Bootstrap Not Implemented

### Root Cause
Plan item P3.5 specified copying wordlists from `payloads/wordlists/` to `~/.config/ultimatrix/wordlists/` during init wizard, but this was never implemented.

### Impact
- New users installing Ultimatrix may not have wordlists available
- Adapters and primitives that expect wordlists may fail or fall back incorrectly
- Inconsistent wordlist availability across installations

### Design Solution

#### 4.1: Add wordlist directory path to config

**Approach**: Centralize wordlist directory path in configuration.

**Implementation**:
- Add `wordlistDir` to `UltimatrixConfig` interface (defaults to `~/.config/ultimatrix/wordlists`)
- Add getter function `getWordlistDir()` using platform-appropriate path resolution
- No hardcoded paths, only defaults

#### 4.2: Add copyWordlistsToUserDir() to init.ts

**Approach**: Copy shipped wordlists during init wizard.

**Implementation**:
- After user confirms provider/model, check if wordlists directory exists
- If not, copy from `payloads/wordlists/` to user `~/.config/ultimatrix/wordlists/`
- Log success/failure
- No hardcoded file lists, iterate over directory contents

**No hardcoded file lists**: Use glob patterns to discover wordlist files in payloads/wordlists/

#### 4.3: Add wordlist validation in tests

**Tests**:
- Test that wordlists are copied during init wizard
- Test that copy is idempotent (no duplicates)
- Test that missing wordlist files are skipped
- Test that permission errors are handled gracefully

**No hardcoded paths**: Use config-based paths for testing.

#### 4.4: Add wordlist existence check to adapters

**Approach**: Adapters that use wordlists should validate existence and handle gracefully.

**Implementation**:
- Add `wordlistExists(type: string): boolean` helper
- Adapters that use wordlists call this before attempting to load
- Fall back to internal defaults if wordlists not available

**No hardcoded assumptions**: Check existence, don't assume wordlists exist.

---

## Gap 5: No Database Transactions for Concurrency

### Root Cause
Multiple writers (capture modules, solver, brain) update graph nodes without transactional guarantees. Concurrent writes to same endpoint/page can lose data.

### Impact
- Data loss in concurrent scenarios
- Inconsistent graph state
- No rollback capability on partial writes

### Design Solution

#### 5.1: Add transaction support to LibSQLGraphStore

**Approach**: Implement BEGIN/COMMIT/ROLLBACK pattern for database operations.

**Implementation**:
- Add `beginTransaction()` method to LibSQLGraphStore
- Add `commitTransaction()` method
- Add `rollbackTransaction()` method
- All database mutations inside transaction are atomic

**No hardcoded operations**: Only database mutations are transactional.

**Schema changes needed**:
- Add `transactionId` column to `nodes` table (optional, for debugging)
- Add `transactionId` column to `edges` table (optional)

#### 5.2: Wrap capture module writes in transactions

**Approach**: Capture modules should open transactions before writing to graph.

**Implementation**:
- Modify `passive-observer.ts` to call `beginTransaction()`, then merge endpoints, then `commitTransaction()`
- Modify `graph-bridge.ts` to open transaction around merge operations
- Modify `dialog-inject.ts` to wrap page merges in transaction

**No hardcoded transaction scopes**: Use clear scope boundaries (e.g., "one batch of captured endpoints").

#### 5.3: Wrap solver brain writes in transactions

**Approach**: Solver writes (findings, attacks, etc.) should be transactional.

**Implementation**:
- Solver calls `beginTransaction()` before running primitive loop
- All writes (findings, attacks, tests, evidence) happen in transaction
- Commit only after primitive completes successfully

**No isolated transactions**: One transaction per primitive run, not per step.

#### 5.4: Add transaction safety tests

**Tests**:
- Test that concurrent writes to same endpoint don't lose data
- Test that rollback reverts partial writes
- Test that transaction isolation works correctly
- Test that commit succeeds only after all mutations

**No hardcoded scenarios**: Generate random concurrent write scenarios.

---

## Gap 6: Test Coverage Gaps (Only GraphStore Tested)

### Root Cause
New features only tested with GraphStore (in-memory), not LibSQL (persistent). Bugs in LibSQL implementation not caught.

### Impact
- Bugs in LibSQL store not caught by tests
- Inconsistent behavior between file-based and LibSQL stores
- Reduced test reliability for production deployments

### Design Solution

#### 6.1: Add GraphStore → LibSQLGraphStore integration tests

**Tests**:
- Create endpoint in GraphStore, then load same data into LibSQL store
- Verify both stores have identical nodes and edges
- Run read operations in both stores, compare results
- Run merge operations in both stores, compare results

**No hardcoded assertions**: Use schema validation to compare.

#### 6.2: Add LibSQL-specific bug detection tests

**Tests**:
- Test that LibSQL store handles concurrent writes correctly
- Test that LibSQL store doesn't leak memory over many writes
- Test that LibSQL store handles database errors gracefully
- Test that LibSQL store recovery works after crash

**No hardcoded assumptions**: Use random data generation for stress testing.

#### 6.3: Add cross-store consistency tests

**Tests**:
- Start with fresh GraphStore, run operations, then save to LibSQL
- Load from LibSQL, verify data matches GraphStore
- Write to GraphStore, then write to LibSQL (different sessions)
- Verify both stores converge on same state

**No hardcoded sequences**: Generate random operation sequences.

#### 6.4: Add performance comparison tests

**Tests**:
- Compare read performance between GraphStore and LibSQL
- Compare merge performance between stores
- Compare memory usage between stores
- Log metrics but don't fail on differences (unless >10x)

**No hardcoded performance thresholds**: Only report metrics.

---

## Gap 7: No Payload Source Validation

### Root Cause
`payloadSource` is tagged but never validated to be appropriate for context. Could have `source: 'llm'` for clearly static payloads.

### Impact
- Incorrect payload source tracking
- Confusing feedback loop data
- Cannot trust payload effectiveness statistics

### Design Solution

#### 7.1: Add payload source validation function to OutcomeFeedbackStore

**Approach**: Validate that `payloadSource` is appropriate based on payload content.

**Implementation**:
```typescript
function validatePayloadSource(payload: string, source: string): boolean {
  // Source is 'static' if payload matches known static patterns
  // Source is 'llm' if payload contains LLM-specific markers
  // Source is 'mutation' if payload was generated from mutation
  return true
}
```

**No hardcoded patterns**: Use schema-based validation, not string matching.

#### 7.2: Add payload source validation in recordPayloadOutcome()

**Approach**: Call validation function before recording outcome.

**Implementation**:
- In `recordPayloadOutcome()`, validate source before saving
- Log warning if validation fails (but don't reject, log for later review)
- Store validation result for auditing

**No hardcoded rules**: Validation function is centralized, no duplications.

#### 7.3: Add payload source audit to EvidenceGate

**Approach**: Track payload source mismatches.

**Implementation**:
- Record all payload outcomes in EvidenceGate
- Flag cases where source doesn't match payload content
- Generate report of potential issues for review

**No hardcoded thresholds**: Flag any mismatch, not just >N mismatches.

#### 7.4: Add payload source consistency test

**Tests**:
- Test that static payloads from PayloadStore get source='static'
- Test that LLM payloads get source='llm' when from ctx.payloads
- Test that mutation payloads get source='mutation'
- Test that validation catches mismatches

**No hardcoded expectations**: Use schema validation.

---

## Gap 8: No Database Transactions for Concurrency (CRITICAL)

### Root Cause
Multiple writers (capture modules, solver, brain) update graph nodes without transactional guarantees. Concurrent writes to same endpoint/page can lose data.

### Impact
- Data loss in concurrent scenarios
- Inconsistent graph state
- No rollback capability on partial writes

### Design Solution

#### 8.1: Add transaction support to LibSQLGraphStore

**Approach**: Implement BEGIN/COMMIT/ROLLBACK pattern for database operations.

**Implementation**:
- Add `beginTransaction()` method to LibSQLGraphStore
- Add `commitTransaction()` method
- Add `rollbackTransaction()` method
- All database mutations inside transaction are atomic

**No hardcoded operations**: Only database mutations are transactional.

**Schema changes needed**:
- Add `transactionId` column to `nodes` table (optional, for debugging)
- Add `transactionId` column to `edges` table (optional)

#### 8.2: Wrap capture module writes in transactions

**Approach**: Capture modules should open transactions before writing to graph.

**Implementation**:
- Modify `passive-observer.ts` to call `beginTransaction()`, then merge endpoints, then `commitTransaction()`
- Modify `graph-bridge.ts` to open transaction around merge operations
- Modify `dialog-inject.ts` to wrap page merges in transaction

**No hardcoded transaction scopes**: Use clear scope boundaries (e.g., "one batch of captured endpoints").

#### 8.3: Wrap solver brain writes in transactions

**Approach**: Solver writes (findings, attacks, etc.) should be transactional.

**Implementation**:
- Solver calls `beginTransaction()` before running primitive loop
- All writes (findings, attacks, tests, evidence) happen in transaction
- Commit only after primitive completes successfully

**No isolated transactions**: One transaction per primitive run, not per step.

#### 8.4: Add transaction safety tests

**Tests**:
- Test that concurrent writes to same endpoint don't lose data
- Test that rollback reverts partial writes
- Test that transaction isolation works correctly
- Test that commit succeeds only after all mutations

**No hardcoded scenarios**: Generate random concurrent write scenarios.

---

## Gap 9: Recent Discoveries String Explosion (CRITICAL)

### Root Cause
`solver.ts:540` creates massive strings: `New findings: 50 (SQLi on /api/users [critical], XSS on /search [high], ...)` - can exceed 2500 tokens with just 50 findings.

### Impact
- Can create 2500+ token strings with just 50 findings
- Exceeds typical context window (8k-32k tokens) for other content
- Causes context overflow, forcing LLM to re-query state
- L3 compaction may truncate meaningful sections

### Design Solution

#### 9.1: Add maxFindingsPerTurn config

**Approach**: Add config for maximum findings per discovery line.

**Implementation**:
```typescript
export interface ContextConfig {
  maxFindingsPerTurn?: number  // Default: 20
  maxEndpointsInSummary?: number  // Default: 10
  maxBlackboardFactsInSummary?: number  // Default: 100
}
```

**No hardcoded values**: Use config defaults.

#### 9.2: Cap Recent Discoveries to maxPerLine findings

**Approach**: Only show last maxPerLine findings, not ALL new findings.

**Implementation**:
```typescript
if (newFindings > 0) {
  const config = getConfig()
  const maxPerLine = config.maxFindingsPerTurn || 20

  // Only take last maxPerLine findings (not ALL new findings)
  const newFindingNodes = (store.queryNodes(NodeType.FINDING) as any[])
    .slice(-newFindings)
    .slice(-maxPerLine)

  const findingText = newFindingNodes.map((n: any) =>
    n.properties.technique + ' on ' + n.properties.endpoint + ' [' + n.properties.severity + ']'
  ).join(', ')

  discoveries.push(`- New findings: ${newFindings} (${findingText})`)

  // If there are more findings than maxPerLine, add a note
  if (newFindings > maxPerLine) {
    const remaining = newFindings - maxPerLine
    discoveries.push(`  - ... and ${remaining} more findings (not shown)`)
  }
}
```

**No hardcoded values**: Use config.maxFindingsPerTurn.

---

## Gap 10: No Preventive Context Limits (HIGH)

### Root Cause
No explicit limits on how much graph state is sent to LLM. No `maxEndpointsInSummary`, no `maxFindingsPerTurn`, no `maxBlackboardFactsInSummary`.

### Impact
- System relies solely on reactive compaction
- Can grow unbounded before overflow
- Different users have different context windows (8k vs 32k vs 128k)
- No user control over behavior

### Design Solution

#### 10.1: Add context limits to config

**Approach**: Add configurable limits for graph state.

**Implementation**:
```typescript
export interface ContextConfig {
  maxEndpointsInSummary?: number          // Default: 10
  maxFindingsPerTurn?: number             // Default: 20
  maxBlackboardFactsInSummary?: number    // Default: 100
}
```

#### 10.2: Modify getTargetSummary() to cap endpoints/findings

**Approach**: When building graph summary, only include capped number of endpoints/findings.

**Implementation**:
```typescript
getTargetSummary(): GraphSummary {
  // Cap endpoints list
  const limitedEndpoints = endpoints.slice(0, config.maxEndpointsInSummary || 10)

  // Cap findings by severity (keep top N per severity)
  const limitedFindingsBySeverity = {}
  for (const [severity, count] of Object.entries(findingsBySeverity)) {
    const topN = Math.min(count, config.maxFindingsPerTurn || 20)
    limitedFindingsBySeverity[severity] = topN
  }

  return {
    totalEndpoints: limitedEndpoints.length,
    endpoints: limitedEndpoints,
    totalFindings: 0,
    findingsBySeverity: limitedFindingsBySeverity,
  }
}
```

**No hardcoded values**: Use config.

---

## Gap 11: No Rate Limiting on Individual Primitives (HIGH)

### Root Cause
Multiple primitives can run simultaneously, each making multiple HTTP requests. No per-primitive rate limiting.

### Impact
- API quota exhaustion from running too many primitives simultaneously
- Rate limit errors from providers
- Wasted tokens on failed API calls
- No throttling mechanism

### Design Solution

#### 11.1: Add per-primitive rate limiter

**Approach**: Implement token bucket rate limiter for primitive execution.

**Implementation**:
```typescript
class PrimitiveRateLimiter {
  constructor(private maxRequests: number, private windowMs: number) {}

  async acquire(primitiveId: string): Promise<void> {
    // Token bucket logic
  }
}
```

#### 11.2: Enforce limits in runPrimitive()

**Implementation**:
- Call rate limiter before executing each primitive
- Return error if limit exceeded
- Add config for per-primitive rate limits

---

## Gap 12: No Deduplication of Findings (MEDIUM)

### Root Cause
When writing findings, code checks for duplicates by findingId but doesn't return early.

### Impact
- Duplicate finding nodes can accumulate in graph
- Graph size grows unnecessarily
- LLM queries return duplicate results

### Design Solution

#### 12.1: Add early return on duplicate detection

**Implementation**:
```typescript
const existingNodes = store.queryNodes(NodeType.FINDING) as FindingNode[]
const duplicate = existingNodes.find(n => n.properties.findingId === findingId)

if (duplicate) {
  log.warn(`Duplicate finding detected: ${findingId}, merging into existing node`)
  duplicate.properties = { ...duplicate.properties, ...newProperties }
  return duplicate as FindingNode
}
```

#### 12.2: Add test coverage for deduplication

**Tests**:
- Test that duplicate findings are merged, not created
- Test that properties are merged correctly
- Test that warning is logged

---

## Gap 13: No Schema Validation of Graph Writes (MEDIUM)

### Root Cause
`addEndpoint()`, `addFinding()`, etc. accept `Partial<NodeType['properties']>` but don't validate before writing.

### Impact
- Invalid nodes can be written to graph (wrong field types, missing required fields)
- Graph schema becomes inconsistent
- LLM queries of graph return invalid data

### Design Solution

#### 13.1: Add zod schemas for each node type

**Implementation**:
```typescript
// In schema.ts
const EndpointSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', ...]),
  headers: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })),
  // ... all required fields
})

// In store.ts
function validateEndpoint(data: unknown): EndpointNode {
  return EndpointSchema.parse(data)
}
```

#### 13.2: Validate properties before adding nodes

**Implementation**:
- Call validator before `addEndpoint()`, `addFinding()`, etc.
- Return error if validation fails
- Auto-fix if possible

---

## Execution Order

### Phase 1: CRITICAL Fixes (Highest Priority)
```
Gap 9.2 (cap Recent Discoveries)
→ Gap 10.2 (cap getTargetSummary)
→ Gap 8.1 (transaction support in LibSQLGraphStore)
→ Gap 8.2 (capture module transactions)
→ Gap 8.3 (solver brain transactions)
```

### Phase 2: LibSQL Merge Logic
```
Gap 1.1 (mergeEndpoint in store-libsql.ts)
→ Gap 1.2 (mergePage in store-libsql.ts)
→ Gap 3.1 (replace upsertPage merge logic)
→ Gap 12.1 (deduplication of findings)
```

### Phase 3: Payload Infrastructure
```
Gap 2.1 (PayloadStore.mergePayloads)
→ Gap 2.2 (PayloadStore.loadPayloadsForVulnType)
→ Gap 2.3 (TechniqueContext.loadPayloads)
→ Gap 2.4 (refactor classicInjection)
→ Gap 2.5 (refactor all 28 primitives)
```

### Phase 4: Testing & Validation
```
Gap 1.3 (test merge endpoints/pages)
→ Gap 3.2 (test LibSQL dedup)
→ Gap 13.1-13.2 (schema validation)
→ Gap 11.1-11.2 (rate limiting)
```

### Phase 5: Wordlist Bootstrap (MEDIUM Priority)
```
Gap 4.1 (wordlist dir config)
→ Gap 4.2 (copy wordlists in init.ts)
→ Gap 4.3 (wordlist validation tests)
→ Gap 4.4 (wordlist existence checks in adapters)
```

### Phase 6: Coverage & Final Tests
```
Gap 6.1 (GraphStore → LibSQL integration tests)
→ Gap 6.2 (LibSQL-specific bug detection tests)
→ Gap 6.3 (cross-store consistency tests)
→ Gap 6.4 (performance comparison tests)
→ Gap 7.1 (payload source validation function)
→ Gap 7.2 (recordPayloadOutcome validation)
→ Gap 7.3 (EvidenceGate audit)
→ Gap 7.4 (payload source consistency test)
```

---

## Verification Checklist

- [ ] No hardcoded tool names or field names in any fix
- [ ] No regex/substring detection anywhere
- [ ] All fixes use TypeScript interfaces/types for validation
- [ ] All tests pass (1760+ tests)
- [ ] LibSQL store has merge methods
- [ ] mergedPayloads actually used by production primitives
- [ ] LibSQL dedup logic matches file-based store
- [ ] Wordlists copied during init
- [ ] Database transactions prevent data loss
- [ ] All stores (GraphStore + LibSQLGraphStore) behave identically
- [ ] Payload sources validated
- [ ] No bandaid solutions or quick fixes

---

## Success Metrics

- All 1760+ tests passing
- LibSQL store has mergeEndpoint, mergePage, upsertPage with dedup
- 28 primitives use merged payloads from PayloadStore
- Wordlists available to all users after init
- Database transactions wrap all graph writes
- Test coverage includes both GraphStore and LibSQLGraphStore
- Payload source validation catches all mismatches
- No hardcoded values, no regex, no bandaids

---

## Risk Mitigation

**Risk 1**: Adding transactions could slow down operations
**Mitigation**: Benchmark before/after, only commit after complete primitive runs, not per-step

**Risk 2**: Refactoring 28 primitives could introduce bugs
**Mitigation**: Test each primitive individually, use existing test suite, verify no regressions

**Risk 3**: LibSQL store may have different behavior than GraphStore
**Mitigation**: Add comprehensive cross-store consistency tests before deployment

**Risk 4**: Wordlist copy could fail for users with no permissions
**Mitigation**: Handle errors gracefully, fallback to internal defaults, log warnings

---

## Notes

- All fixes must maintain backward compatibility
- No changes to public API (except added methods in existing interfaces)
- No changes to existing tests unless to fix them
- All new tests must be in existing test directories
- Code must pass ESLint and TypeScript checks
