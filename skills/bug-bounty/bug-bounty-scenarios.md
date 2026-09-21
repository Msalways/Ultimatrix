---
name: bug-bounty-scenarios
description: "Route observed web and API behavior to high-signal bug-bounty scenarios, experiments, and proof requirements. Use for broad coverage planning; do not run every scenario blindly."
category: methodology
tier: balanced
toolRefs: [queryGraph, getTargetSummary, getCaptureOverview, listCapturedRequests, buildResearchMap, planResearchExperiments, executePlannedExperiment, compareResearchResponses, evaluateResearchExperiment, recordFindingCandidate, assessCandidateReportability, writeFinding, searchSkills, loadSkillBody]
triggers: ["bug bounty", "bounty assessment", "vulnerability research", "broad web assessment", "scenario coverage", "attack surface review"]
contextBoosts: [web, api, auth, workflow]
owaspRefs: ["OWASP WSTG", "OWASP API Security Top 10 2023", "OWASP ASVS"]
compositionRules:
  enhances: [web-pentest, authorization, api-security, business-logic, reporting]
requires:
  capabilities: [graph.query, network.request, response.compare, evidence.capture, finding.write]
procedure:
  stages:
    - id: observe
      goal: Bind scenarios to captured target structure, actors, and workflow state.
    - id: plan
      goal: Create one falsifiable baseline/mutation experiment with a typed oracle.
    - id: execute
      goal: Run the smallest authorized reversible probe.
    - id: verify
      goal: Independently retest with fresh evidence before promotion.
verification:
  coverage:
    - id: target-bound-hypothesis
      required: true
    - id: initial-experiment
      required: true
    - id: independent-retest
      required: true
output:
  schema: BugBountyScenarioConclusion
---

# Bug-bounty scenario router

Use this catalog as a hypothesis generator, not as a payload checklist. Start with the observed graph, captured requests, actors, and workflow state. Select the smallest scenario whose precondition is actually present, then create one baseline/mutation experiment. A scenario is only a candidate until the differential is independently retested.

## Operating contract

1. Read target summary, capture overview, and relevant graph neighborhoods.
2. Prefer captured requests over guessed routes. Keep one variable changed per experiment.
3. Use a unique cache/session marker for every differential so evidence cannot be confused with a previous response.
4. Never use destructive writes, credential attacks, volumetric load, or out-of-scope destinations without explicit authorization and a bounded budget.
5. Record raw request/response evidence and the exact actor/session for every candidate. A status-code difference alone is not impact.
6. Promote only after the planned experiment and an independent retest both prove the oracle.

## Scenario catalog

| Scenario | Select when the graph shows | Smallest falsifiable experiment | Proof signal |
|---|---|---|---|
| BOLA/IDOR read | object IDs, UUIDs, slugs, or owner fields | replay owner request as a different authorized actor with one identifier changed | other actor receives the object or a protected field |
| BOLA action | state-changing object endpoint | replay the same action against another actor's object in a safe test account | unauthorized state transition on the foreign object |
| Broken function-level authorization | admin/role-specific route or operation | compare the same function as low-privileged and admin actors | low-privileged actor completes a privileged function |
| Tenant isolation | tenant/org/account IDs in path, body, or headers | hold actor constant and switch one tenant identifier | data or state crosses tenant boundary |
| Excessive data exposure / BOPLA | API returns fields the UI does not render | compare UI-visible fields with raw API response and field-level mutations | unauthorized sensitive field is returned or accepted |
| Mass assignment | JSON/form update with role, owner, status, or internal fields | add one server-controlled field to a captured write | protected field changes or is accepted without authorization |
| Unauthenticated privileged access | endpoint is reachable anonymously but appears sensitive | repeat a captured request with auth headers/cookies removed | protected data/function remains available and impact is verified |
| OAuth redirect/state/linking | authorization code, redirect URI, state, or account linking flow | use a fresh test account; mutate one redirect/state/linking parameter | code/token/account link crosses the intended client or user |
| MFA/OTP/reset bypass | login, OTP, recovery, or password-reset workflow | replay each transition with one step, recipient, token, or factor altered | authentication completes without the required factor |
| Session lifecycle | cookies/tokens, logout, rotation, or device sessions | compare old session after logout, rotation, password change, and role change | invalidated credential still accesses protected state |
| JWT validation flaw | JWT or JWKS metadata | make one typed signature/claim/key-selection mutation | server accepts a token that fails the declared validation rule |
| CORS trust flaw | reflected/overbroad origin and credentialed responses | send a unique untrusted Origin and compare ACAO/ACAC plus readable sensitive response | attacker origin can read credentialed data |
| CSRF | cookie-authenticated state-changing request without robust anti-CSRF binding | replay from a clean context with token/origin binding removed | state changes without the required user intent binding |
| SSRF | server fetches a caller-controlled URL, import, preview, PDF, or webhook | use an approved OAST token and one destination mutation | callback proves a server-side request; stop before internal impact |
| XSS reflected/stored/DOM | input reaches HTML/JS/DOM sink | use an inert unique marker first, then a harmless context probe | marker reaches an executable sink and browser effect is observed |
| Clickjacking/UI redress | sensitive action in a browser-rendered page | inspect framing policy and, only in a safe harness, frame the page | protected action is reachable through an untrusted frame |
| SQL/NoSQL/LDAP injection | parameter reaches a query/filter and response varies | compare typed true/false or syntax probes with a unique marker | reproducible server-side query effect, not merely a 500 |
| SSTI/command injection | template or process boundary consumes input | use a non-destructive arithmetic/identity oracle | server evaluates controlled expression without side effects |
| XXE | XML parser accepts external entities/DOCTYPE | use a harmless local marker or approved OAST entity | parser resolves the entity; do not read arbitrary files |
| File upload | upload, import, avatar, archive, or document conversion flow | upload a benign polyglot/metadata marker and trace storage/processing | untrusted content executes or crosses a trust boundary |
| Deserialization | serialized object markers or framework-specific blobs | mutate one type marker under a no-side-effect oracle | server changes type/control flow in a reproducible way |
| Prototype pollution | JSON merge, query parser, or client/server object merge | add a uniquely named prototype key and observe only typed behavior | polluted property changes a security-relevant decision |
| Web cache poisoning | cache headers plus unkeyed input/reflection | add a unique cache buster and mutate one unkeyed input | the same cache key serves attacker-controlled content to a clean client |
| Web cache deception | dynamic sensitive GET plus static-extension/path parsing discrepancy | request the dynamic route with a unique delimiter/extension, then cleanly fetch it | cache stores and serves another actor's private response |
| HTTP desync/request smuggling | proxy/origin boundary, HTTP/1, or protocol downgrade | use an approved canary and bounded connection test; never poison shared users | parser disagreement is proven without collateral requests |
| Race condition | one-time redemption, inventory, balance, invite, or state transition | bounded parallel requests against a disposable test object | invariant is violated once under concurrency and retests cleanly |
| Rate-limit/business-flow abuse | sensitive action has quota, cost, or one-time semantics | small bounded sequence with a unique test account | business invariant fails without relying on volumetric DoS |
| GraphQL authorization | GraphQL endpoint, schema, aliases, fragments, or global IDs | compare the same resolver/field under two actors and one field mutation | unauthorized resolver or field is returned/changed |
| WebSocket auth/CSWSH | WebSocket handshake, cookies, Origin, or channel messages | compare handshake/message authorization from a clean origin/actor | unauthorized connection or action is accepted |
| Open redirect/host header | redirect target or host-derived absolute URL | mutate one destination/host while preserving route | redirect or generated link leaves the approved origin and enables a concrete chain |
| Source-map/static secret exposure | bundles, source maps, public configs, or debug artifacts | fetch the artifact and verify whether a value is a real credential or only a placeholder | usable secret is confirmed without using it against third parties |
| Subdomain takeover | DNS alias points to an unclaimed provider resource | verify DNS plus provider ownership state; do not claim the resource | provider proves the alias is claimable and in scope |
| Cloud metadata/IAM | server-side fetch and cloud identity signals | use an approved metadata-safe probe/OAST path | metadata or IAM boundary is reached with explicit authorization |
| Path traversal/LFI | file/path parameter or archive extraction | use a harmless normalized-path comparison | unauthorized file or path is returned; avoid sensitive collection |
| Parameter pollution | duplicate keys, arrays, or parser disagreements | send one duplicate-key mutation and compare canonicalization | security decision differs between layers |
| Webhook signature/replay | signed callback, timestamp, nonce, or retry endpoint | replay a captured callback once with one signature/timestamp change | unsigned, stale, or cross-tenant callback is accepted |
| PDF/CSV/template injection | export or document renderer consumes user-controlled cells/markup | insert a harmless formula/template marker in a disposable record | renderer evaluates or executes it in the wrong trust context |
| Dependency/supply-chain trust | package manifests, install hooks, third-party scripts, or CI artifacts | verify provenance and a controlled integrity mismatch in a local fixture | untrusted dependency/code path executes in the target build |

## Prioritization

Prefer scenarios with (a) a captured request, (b) a known alternate actor or clean session, (c) a typed oracle, and (d) meaningful impact. A public report or scanner signal is a reason to form a hypothesis, never proof. If the graph only contains static assets, classify the result as information gathering and continue passive route discovery instead of inventing an exploit.

## Evidence and promotion

Use `recordFindingCandidate` for an interesting differential. Use `evaluateResearchExperiment` with an explicit oracle, then independently retest with fresh evidence. Use `writeFinding` only when the proof chain, scope, reproducibility, impact, and remediation are all recorded. Keep secrets and raw sensitive bodies in the evidence/artifact store, not in the narrative.

```text
candidate -> initial proof -> independent retest -> reportability assessment -> finding
```

## Research sources

This catalog is a paraphrased routing layer over maintained public material and public disclosure patterns:

- PortSwigger Web Security Academy topic index: https://portswigger.net/web-security/all-materials
- OWASP Web Security Testing Guide: https://wstg.owasp.org/latest/
- OWASP API Security Top 10 (2023): https://api-security.owasp.org/editions/2023/en/0x11-t10/
- HackerOne MFA bypass/account takeover case study: https://www.hackerone.com/blog/how-inadequate-authentication-logic-led-mfa-bypass-and-account-takeover
- HackerOne GraphQL authorization case study: https://www.hackerone.com/blog/how-graphql-bug-resulted-authentication-bypass
- HackerOne business-logic/race case study: https://www.hackerone.com/blog/how-business-logic-vulnerability-led-unlimited-discount-redemption
- HackerOne report-writing guidance: https://www.hackerone.com/blog/bug-bounty-reports-how-do-they-work
