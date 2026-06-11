# agents.md

## Ultimatrix v5 — Action-as-Node Architecture

### Status
- **0 type errors, 309 tests (22 files), clean tsup build (ESM 149KB + CJS 157KB + DTS)**
- All 159 tasks across 6 phases implemented + all bugs fixed

### Architecture
- **Supervisor Agent** (`src/manager/agent.ts`): Mastra Agent with 14 tools — Observe-Learn-Attack loop. Delegates to 4 workers, chains findings, records evidence.
- **4 Specialist Workers** (`src/workers/`): `injection`, `authControl`, `advanced`, `recon` — all Mastra Agents with Stagehand + AgentBrowser + tool wrapping.
- **Spider Agent** (`src/spider/agent.ts`): Hybrid crawler with Stagehand + AgentBrowser. Discovers pages, forms, SPA hash routes, overlays, auth flows.
- **Action Recorder** (`src/recorder/`): Records every browser action as Interaction nodes. Generates happy/sad/edge/security test cases. Streams Playwright code. Session-resumable.
- **TypeGraph** (`src/graph/`): 8 node types (Page, Action, Input, Test, Finding, AuthFlow, RBACRole, Attack), 10 edge types, full CRUD + query methods, JSON-backed, Mastra tools.
- **Intelligence** (`src/intelligence/`): Auth flow recording/replay, RBAC learning (multi-role comparison), 7-chain-rule finding chaining, dynamic hypothesis generation, session resume.
- **OAST Server** (`src/oast/`): Local HTTP callback server for blind payload detection. Persists to `output/oast-callbacks.json`. Auto-starts before agent, stopped in finally block.
- **Browser Bridge** (`src/browser/state-bridge.ts`): State import/export between Stagehand and Playwright.
- **TUI** (`src/tui/`): terminui-based 4-split-pane terminal UI (Chat, Activity, Code, Graph) + StatusBar + input bar. No React/Ink/yoga-layout. Default interface (use `--cli` for REPL mode).

### 27+ Mastra Tools
- **HTTP** (4): httpRequest, multipartUpload, followRedirects, omitHeader
- **Injection** (1): injectInContext
- **Observation** (6): parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse
- **Session** (3): extractSessionCookie, extractCsrfToken, useSession
- **Control** (2): recordEvidence, writeFinding
- **Graph** (6): queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows
- **App Model** (2): readAppModelSection, writeAppModelSection
- **Recon** (5): runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe
- **Interactive** (1): askUser
- **Stagehand** (3): stagehandAct, stagehandExtract, stagehandAgent
- **OAST** (3): getOastUrlTool, checkOastCallbacks, clearOastCallbacks

### CLI Commands
- `ultimatrix assess -t <url> -o <dir>` — full assessment
- `ultimatrix scan -t <url> -o <dir>` — autonomous pentest
- `ultimatrix verify -a <model> -t <new-url>` — re-run findings
- `ultimatrix interact -t <url>` — REPL chat loop
- `ultimatrix web` — Web UI dashboard at http://localhost:3000
- `ultimatrix init` — Interactive provider setup wizard
- `ultimatrix -t <url>` — TUI (default), `--cli` for REPL

### Key Fixes Applied
- OAST persistence to `output/oast-callbacks.json`
- All missing tools wired to workers (session tools, cloudMetadataProbe)
- Session resume auto-invoked on startup
- Chaining runs programmatically after each REPL turn
- delegate-tool fallback passes recorder
- Session loop wrapped in try/finally for cleanup
- All 5 missing CLI commands implemented
- @inquirer/prompts removed (unused dep)
- .opencode/PLAN.md created
- Form auto-fill + submit added to spider features
- Browser tools re-export file created
