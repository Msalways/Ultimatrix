# Ultimatrix v4 "Menace" — Final Plan

## Locked-in constraints

- All 5 personas: demo, bounty, pen-tester, CI/CD, first-timer
- Frontends: TUI (Ink, default), headless (CI), chat (REPL), report HTML (dashboard)
- No `init` step. LLM config inline + persistent in `~/.config/ultimatrix/`
- Termination: time-budget / LLM-exhausted / user-`/quit`
- Architecture: one core (HuntCore event stream) → many frontends
- Phase model: continuous loop. Observation + attack run from t=0. No phase boundary
- AppModel: static (spider) + behavioral (trace). Both fed to attack LLM
- Browser driver: hybrid — LLM has goal, switches to free exploration when goal hit
- Recorder: capture all 15 step types, LLM filters at read time
- LLM streaming: all 6 call sites emit `streamToken(source, text)`. JSON mode buffers
- Multi-session: built-in, 2 parallel contexts when creds provided
- OOB: 5 categories — SSRF, blind XSS, blind SQLi, XXE, deserialization
- TUI: 4-pane Ink — status, live activity, findings, chat. Chafa/imgcat for screenshots
- Web dashboard: report HTML IS the dashboard. No separate WS service
- Specialists: all 9, full implementation — jwt, oauth, race, graphql, idor, cloud, waf-mutator, xss, second-order
- Codegen: full artifact set — specs, fixtures, config, evidence/, package.json, README
- CI format: SARIF + JSON + plain text. Exit 0/1/2/3 with `--fail-on`
- Triage: heuristics + 1 adversarial LLM call. 2/3 agree = confirmed
- Remediation: LLM-generated per finding, no static DB
- Verification: xss-game + crapi + VAmPI (end-to-end smoke)
- Diff storage: local JSON files keyed by target
- Sharing: local-only — zip or single HTML with embedded base64 assets
- CLI subcommands: `hunt`, `codegen`, `doctor`, `demo`
- Exit codes: 0/1/2/3 with `--fail-on` flag
- Screenshots: auto on finding, user-triggered via TUI `snap`

## The three Fixes

### Fix 1 — Visible, trustworthy, real-time progress

- 4-pane Ink TUI: status / live activity / findings / chat
- LLM streaming on all 6 call sites: composer, triage, chat, specialist, browser driver, codegen mutator
- Status bar: time, cost, count, ETA
- Live activity pane: tokens stream, source-tagged, word-wrapped, auto-scroll, cancellable
- Findings pane: severity-colored, click-to-expand for proof
- Chat pane: standard streaming chat UX

### Fix 2 — Trustworthy findings with proof, remediation, map

- Per-finding: inline proof (request/response diff), screenshot, reproducer (curl), triage badge
- Triage: heuristics + adversarial LLM. 2/3 agree = confirmed
- Remediation: LLM-generated, 1-2 lines, tailored to actual finding
- Map: OWASP category, CWE, CVSS score

### Fix 3 — Real report, diff, regression suite, share

- Single HTML report opens in browser, IS the dashboard
- Executive summary at top
- Per-finding: proof (uses Fix 2), remediation, map
- Diff vs last hunt: green=fixed, red=new, yellow=still here
- "Regenerate tests" button → runnable Playwright suite
- "Share" → local zip export or self-contained HTML
- CI mode: SARIF + JSON + plain text, exit 0/1/2/3

## Architecture

```
                  ┌─────────────────────────────────────┐
                  │           HuntCore (one)            │
                  │  state + events:                    │
                  │    primitive-call                   │
                  │    behavioral-step                  │
                  │    llm-token (source-tagged)        │
                  │    finding                          │
                  │    screenshot                       │
                  │    oob-callback                     │
                  │    chat-message                     │
                  │    budget-update                    │
                  │    done (reason)                    │
                  └─────────────┬───────────────────────┘
                                │
            ┌───────────────────┼────────────────────────┐
            │                   │                        │
   ┌────────▼────────┐  ┌────────▼────────┐  ┌────────────▼─────────┐
   │   TUI (Ink)     │  │  headless CI    │  │  chat REPL           │
   │   4 panes       │  │  SARIF+JSON     │  │  single-line         │
   │   live tokens   │  │  exit 0/1/2/3   │  │  streaming chat      │
   └─────────────────┘  └─────────────────┘  └──────────────────────┘
                                │
                       ┌────────▼─────────┐
                       │  report HTML     │
                       │  (the dashboard) │
                       │  opens in browser│
                       └──────────────────┘
```

The continuous loop in HuntCore:

```
recorder → BehavioralStep[] ─┐
                             ├──► behavioral AppModel
static AppModel (spider) ────┤
                             ├──► LLM (composer) ──► primitive calls
chat user input ─────────────┘
                             │
                             ├──► primitive execution
                             ├──► OAST callback injection
                             ├──► multi-session replay
                             ├──► triage
                             │
                             ├──► findings emitted
                             ├──► live spec grows
                             └──► budget / termination check
```

## Execution order

| # | Block | New tests | New LOC | Output |
|---|-------|-----------|---------|--------|
| 0 | Commit baseline | 0 | 0 | 1 commit |
| 1 | HuntCore + BehavioralRecorder + 15 step types + LiveTestWriter + dual AppModel | ~50 | ~1500 | continuous loop, recorder, live spec |
| 2 | 4-pane Ink TUI + LLM streaming on all 6 call sites | ~35 | ~1200 | TUI, token streaming |
| 3 | Multi-session pool + 9 specialists (full impl) | ~50 | ~2500 | BOLA, JWT, OAuth, race, GraphQL, cloud, WAF, XSS, 2nd-order |
| 4 | 5 OOB primitives (SSRF, blind XSS, blind SQLi, XXE, deser) | ~25 | ~800 | OAST integration |
| 5 | Headless CI frontend + SARIF/JSON + 0/1/2/3 exit + `--fail-on` | ~15 | ~600 | CI mode |
| 6 | Report HTML dashboard + diff vs last hunt + zip export + share | ~30 | ~1200 | the dashboard |
| 7 | `codegen` subcommand + `doctor` + `demo` + bench | ~20 | ~600 | CLI subcommands |
| 8 | End-to-end smoke (xss-game + crapi + VAmPI) + README + demo recording | ~5 | ~400 | demo asset |

**Total**: 657 baseline + 230 new = ~887 tests, ~8800 LOC

## Verification

After each block: `npx vitest run` + `npx tsc --noEmit` + `npx tsup` must be clean.

After Block 8: end-to-end smoke against all three targets.

- xss-game: autonomous 60s hunt finds the XSS, generates a finding with proof, writes a regression spec
- crapi: BOLA detection via 2-session replay produces a finding on `/api/identity/v2/user/`
- VAmPI: SQLi detection via OOB callback

## Acceptance criteria

- [ ] `npx vitest run` — 880+ tests pass, 0 failures, 0 type errors
- [ ] `npx tsup` — clean build
- [ ] `npx ultimatrix doctor` — passes on a fresh machine
- [ ] `npx ultimatrix hunt -t https://xss-game.appspot.com/level1/frame` — opens TUI, finds XSS, shows streaming reasoning, emits finding with screenshot
- [ ] `npx ultimatrix hunt -t https://xss-game.appspot.com/level1/frame --frontend=headless --format=sarif` — emits valid SARIF, exits 0/1
- [ ] `npx ultimatrix demo` — runs full pipeline, opens report HTML, generates regression suite
- [ ] `npx ultimatrix codegen all` — emits full `playwright-tests/` directory, runnable with `npm i && npx playwright test`
- [ ] All 9 specialists dispatched and producing findings when their preconditions are met
- [ ] 5 OOB categories confirmed with real OAST callbacks
- [ ] LLM streaming visible in TUI live-activity pane
- [ ] 2-session BOLA detection works against crapi
- [ ] Diff vs last hunt shows green/red/yellow correctly
- [ ] Report HTML opens in browser, is interactive, exports to zip

## What I will NOT do

- No destructive changes to existing 657 tests (additive only)
- No push to origin
- No npm publish
- No modifications to user's `~/.config/ultimatrix/` (only creates if missing)
- No destructive changes to demo targets
- No pretending things work that don't

## What I will do mid-execution

- Commit baseline in Block 0
- Per-block smoke test before moving on
- Surface progress at end of each block (test count, files added, smoke status)
- Pause and ask if any block produces blockers I can't resolve in <30 min
- Generate a final demo recording at the end (a 90s screencast of the live hunt)
