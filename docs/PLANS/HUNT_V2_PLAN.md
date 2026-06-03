# Plan: `ultimatrix hunt` v2 — Advanced-attack-first

## Goal

Merge `assess` + `interact` into a single `hunt` command (no separate flags) whose default behavior flows into Playwright test case generation. `hunt` is wired with a full advanced-attack recon + specialist + chain-reasoning layer so the product demonstrates non-trivial findings (OAuth redirect bypass, cloud-metadata SSRF chains, race conditions, JWT confusion, SSTI, smuggling) instead of basic XSS/SQLi.

## Locked scope decisions

| Decision | Value |
| --- | --- |
| Command name | `hunt` |
| Default mode | `guided` (prompt at every node) |
| Test-gen trigger | `ask` (prompt at end of run) |
| Tests output dir | `./<outputDir>/playwright-tests/` |
| Spider default | yes, depth=2 |
| Slash commands | full set: `/auto`, `/guided`, `/findings`, `/test`, `/report`, `/add`, `/help`, `/quit` + Y/s/i/d/a |
| Backward compat | `assess` / `interact` / `test` become deprecated aliases (one release) |
| Mid-run `/add <url> [technique]` | yes, v1 |
| Attack surface scope | Full expansion (~3000-5000 LOC) |
| Recon scope | Full recon layer (9 tools) |
| Chain engine | Full LLM-driven attack-chain reasoning |
| Worker model | Hybrid: hand-rolled for high-confidence patterns; LLM for novel bypass / chain reasoning |

## Why this matters

XSS and SQLi are sanitized by every modern framework. A 2026 product that only hunts XSS/SQLi looks like a Burp-Suite-replica and gets dismissed. The differentiators in this plan — OAuth redirect_uri bypass, cloud-metadata SSRF chains, attack-chain reasoning, race conditions, JWT alg confusion, request smuggling, SSTI — are the attacks real appsec teams miss and that judges will respect.

## Phase 1 — Foundation (must ship for hackathon)

### 1.1 Recon layer (5 tools, ~600 LOC)

| File | Detects | LOC |
| --- | --- | --- |
| `src/recon/oauth-discovery.ts` | `/.well-known/openid-configuration`, IdP list, redirect URIs, scopes | 150 |
| `src/recon/graphql-discovery.ts` | `/graphql`, `/gql`, `__schema` reflection | 100 |
| `src/recon/jwt-discovery.ts` | decode tokens in cookies / headers / storage (no verify) | 100 |
| `src/recon/framework-fingerprint.ts` | Next.js / Django / Rails / Spring / Express / Laravel / FastAPI | 150 |
| `src/recon/cloud-metadata-probe.ts` | SSRF payloads to `169.254.169.254` / `metadata.google.internal` via OAST | 100 |

### 1.2 Specialists (3 new, ~700 LOC)

| File | Attack | Worker type | LOC |
| --- | --- | --- | --- |
| `src/agents/specialists/oauth.ts` | redirect_uri bypass, state fixation, scope escalation, code theft | LLM | 280 |
| `src/agents/specialists/cloud.ts` | SSRF → AWS IMDSv1/v2 → IAM → S3 | hand-rolled + OAST | 220 |
| `src/agents/specialists/race.ts` | TOCTOU: balance/withdraw, coupon reuse, invite race, parallel request | hand-rolled parallel | 200 |

### 1.3 Chain engine v1 (~300 LOC)

| File | Purpose | LOC |
| --- | --- | --- |
| `src/core/attack-chain.ts` | LLM takes `Finding[]`, returns `AttackChain[]` | 250 |
| `src/core/chain-report.ts` | render chains at the top of the report (chain-first, not finding-first) | 50 |

### 1.4 WAF mutator expansion (~150 LOC)

Extend `src/agents/specialists/waf-mutator.ts` with:

- comment injection (`/*! ... */`)
- double URL encoding
- unicode normalization (NFKC / NFKD)
- HTTP parameter pollution (HPP)
- chunked transfer encoding
- content-type confusion

### 1.5 Updated `NodeStrategy.resolve()` (~100 LOC)

URL/path + auth + param + framework-based inference, no LLM. Reads `app-model` heuristics. Examples:

- `/oauth/*`, `/.well-known/openid-configuration` → `oauth`
- `/graphql`, `/gql` → `graphql`
- `Bearer ` header, `app-model.auth.type === 'jwt'` → `jwt-v2-advanced`
- params `url|uri|callback|webhook|fetch|load|proxy|img` → `ssrf-chain`
- params `amount|price|qty|quantity|discount|coupon|balance|withdraw` → `race-condition`
- params `template|render|preview|view|name|format` → `ssti`

### 1.6 Merge `assess` + `interact` into `hunt` (~830 LOC)

- `src/cli/hunt.ts` — `runHunt(opts)` orchestrator
- `src/cli/prompt.ts` — readline prompt + slash command parser
- `src/tools/finding-test-generator.ts` — Playwright attack-replay codegen

Slash commands:

| Command | Effect |
| --- | --- |
| `Y` / Enter | run the proposed node |
| `s` | skip this node |
| `i` | inspect: graph size, pool, app-model, recent findings |
| `d` | detail: raw node JSON |
| `a` | abort: graceful shutdown, generate report + tests |
| `/auto` | switch to fully autonomous (no more prompts) |
| `/guided` | re-enable prompts |
| `/findings` | list all findings so far |
| `/test` | generate Playwright tests now (mid-run) |
| `/report` | show current report path |
| `/add <url> [technique]` | inject a new node into the graph |
| `/help` | show command list |
| `/quit` | save state and exit |

### 1.7 Tests (~400 LOC, ~36 new tests)

- `tests/recon/oauth-discovery.test.ts` (5)
- `tests/recon/graphql-discovery.test.ts` (3)
- `tests/recon/jwt-discovery.test.ts` (4)
- `tests/agents/specialists/oauth.test.ts` (3)
- `tests/agents/specialists/cloud.test.ts` (3)
- `tests/agents/specialists/race.test.ts` (3)
- `tests/core/attack-chain.test.ts` (4)
- `tests/cli/hunt.test.ts` (8)
- `tests/tools/finding-test-generator.test.ts` (3)

### 1.8 Docs (~100 LOC)

- `docs/USER_FLOW.md` — `hunt` flow + prompts + slash commands
- `docs/ATTACK_SURFACE.md` — list of attacks, when they fire, demo targets
- `docs/CHAIN_ENGINE.md` — chain-reasoning examples + how to extend

## Phase 2 — Polish (post-hackathon-stretch)

### 2.1 Recon expansion (4 tools, ~400 LOC)

- `src/recon/websocket-discovery.ts` — ws / socket.io / signalR
- `src/recon/cdn-bucket-probe.ts` — S3 / GCS / Azure Blob / CloudFront
- `src/recon/saml-discovery.ts` — SAML metadata, ACS endpoints
- `src/recon/grpc-reflection.ts` — gRPC server reflection

### 2.2 Specialists (4 more, ~700 LOC)

- `src/agents/specialists/smuggling.ts` — CL.TE / TE.CL / H2.TE probes
- `src/agents/specialists/ssti.ts` — Jinja2 / Twig / ERB / Freemarker / Pug
- `src/agents/specialists/proto-pollution.ts` — Node.js / browser PP + gadget detection
- `src/agents/specialists/cache.ts` — web cache poisoning / deception

### 2.3 Specialist expansions (~400 LOC)

- `jwt-v2-advanced.ts` (extend jwt-v2) — kid injection, jku/x5u SSRF, weak HMAC brute
- `graphql-v2.ts` (extend graphql) — field-level authz with multi-role diff
- `waf-mutator-v2.ts` (extend) — T.E.T, 0-RTT, header smuggling

### 2.4 Chain engine v2 (~200 LOC)

- LLM-driven chain reasoning across 100+ findings
- cross-session chain detection
- probability / confidence scoring

### 2.5 Report v2 (~200 LOC)

- interactive Mermaid chain graph
- click-to-expand chain steps
- replay each chain step in Playwright

### 2.6 Tests (~500 LOC) — all new specialists + chain v2

## File map

### NEW (Phase 1 + Phase 2: 25 files)

```
src/cli/hunt.ts
src/cli/prompt.ts
src/tools/finding-test-generator.ts
src/recon/index.ts
src/recon/oauth-discovery.ts
src/recon/graphql-discovery.ts
src/recon/jwt-discovery.ts
src/recon/framework-fingerprint.ts
src/recon/cloud-metadata-probe.ts
src/recon/websocket-discovery.ts            [Phase 2]
src/recon/cdn-bucket-probe.ts               [Phase 2]
src/recon/saml-discovery.ts                 [Phase 2]
src/recon/grpc-reflection.ts                [Phase 2]
src/agents/specialists/oauth.ts
src/agents/specialists/cloud.ts
src/agents/specialists/race.ts
src/agents/specialists/smuggling.ts         [Phase 2]
src/agents/specialists/ssti.ts              [Phase 2]
src/agents/specialists/proto-pollution.ts   [Phase 2]
src/agents/specialists/cache.ts             [Phase 2]
src/core/attack-chain.ts
src/core/chain-report.ts
docs/USER_FLOW.md
docs/ATTACK_SURFACE.md
docs/CHAIN_ENGINE.md
```

### MODIFIED

```
src/cli/index.ts                              # +hunt command, deprecate aliases
src/index.ts                                  # export hunt + recon + chain types
src/agents/specialists/waf-mutator.ts         # expand mutations
src/pipeline/autonomous-v3.ts                 # NodeStrategy inference updated
src/core/app-model.ts                         # +oauthProviders, graphqlSchemas, jwtTokens, etc.
src/core/types.ts                             # +AttackChain, CloudProbeResult, etc.
README.md                                     # hunt is the canonical command
```

### DELETED

```
scripts/interact-v3-xss-game.js               # superseded by src/cli/hunt.ts
```

## Implementation order (post plan-mode exit)

1. **Recon layer (1-2 days)** — `src/recon/`, extend `AppModel` type, tests
2. **Specialists (2-3 days)** — oauth, cloud, race; wire into `AutonomousV3Orchestrator`
3. **WAF mutator expansion (0.5 day)** — 6 new mutation techniques
4. **NodeStrategy inference update (0.5 day)** — heuristic-only, no LLM
5. **Chain engine (1 day)** — LLM prompt + `AttackChain[]` + tests
6. **Chain-first report (0.5 day)** — `src/core/chain-report.ts` + Mermaid
7. **Merge `hunt` command (1-1.5 days)** — `src/cli/hunt.ts`, prompt loop, slash cmds, test-gen trigger
8. **Tests (1 day)** — ~36 new tests, all mock-based
9. **Docs (0.5 day)** — USER_FLOW, ATTACK_SURFACE, CHAIN_ENGINE, README
10. **Validate + commit** — vitest + tsc + tsup + smoke run

## Demo target

**Recommendation: custom vulnerable Node.js/Express app** (~200 LOC) seeded with:

- OAuth flow with `redirect_uri` validation flaw
- JWT with HS256 + weak secret
- race condition on `/api/transfer`
- cloud metadata reachable via SSRF on `/api/preview?url=`
- SSTI on `/api/render?template=`
- file upload with extension filter bypass
- IDOR on `/api/users/:id`

All flaws map cleanly to a specialist. Judges see "ultimatrix found this 18-issue kill chain in 4 minutes" — exactly the demo that wins.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Scope too aggressive for 5-day deadline | High | Missing demo | Phase 2 deferred; Phase 1 must ship |
| LLM specialists too slow on real targets | High | Worker timeout | Hand-rolled workers for known patterns |
| Chain engine hallucinates non-existent chains | Medium | Bad report | Validate each chain step against verbatim evidence in `app-model` |
| OAuth specialist misses bypass technique | Medium | Misses real bug | Pre-built technique list; LLM picks, doesn't invent |
| Cloud metadata probe blocked by egress | Medium | No finding | OAST-based; mark inconclusive if blocked |
| Race specialist causes rate-limit ban | Low | Target bans us | Configurable concurrency cap, abort on 429 |
| Recon adds 30s to startup | Medium | Slow UX | `Promise.all` parallel, 5s per-probe cap |
| WAF mutator triggers WAF ban | Medium | Target bans us | Backoff on 429/403, configurable aggressiveness |
| Demo target bans during recording | Medium | Bad demo | Pick target with auth path that does not rate-limit |

## Verification gates

1. `npx vitest run` — 435 existing + ~36 new = ~471 tests pass, 0 failures
2. `npx tsc --noEmit` — 0 type errors
3. `npx tsup` — clean build
4. `npx ultimatrix hunt -t <demo-target>` — full flow demo (spider → recon → strategy → specialists → chains → report → tests)
5. `npx ultimatrix hunt -t <demo-target> --auto` — autonomous mode
6. `npx ultimatrix assess -t <url>` — deprecation warning + forward to `hunt --auto`
7. Final commit + push
