---
name: web-methodology
description: "Structured methodology for web application security testing — recon, auth mapping, attack surface, exploitation, reporting"
category: methodology
tier: balanced
toolRefs: [httpRequest, parseResponse, loadSkillReference, getCapturedHeaders, writeFinding, updateGraph, encodeDecode, followRedirects, getOastUrlTool, checkOastCallbacks, runPrimitive, searchSkills]
triggers: ["web app", "website", "web application", "web security", "web testing"]
---

# Web Application Security Testing Methodology

## Phase 1: Reconnaissance (passive first)

1. **Target summary** — Call `queryNodes` to read existing graph state (endpoints, pages, auth flows). Do not re-discover what the spider already found.
2. **Technology fingerprint** — Load the `web-pentest` skill for technology detection techniques. Check response headers, HTML meta tags, JS framework signatures.
3. **Scope verification** — Confirm all planned attack URLs are within scope. Use `isUrlInScope()` before any request.

## Phase 2: Authentication & Session Mapping

1. **Auth flow detection** — Call `detectAuthFlows` to discover login mechanisms. Record form-based, OAuth, SAML, or API-key auth.
2. **Session management** — Test session token generation, expiry, invalidation. Check cookie flags (HttpOnly, Secure, SameSite).
3. **Role enumeration** — Identify distinct user roles from observed RBAC nodes. Map role → permission boundaries.

## Phase 3: Attack Surface Enumeration

1. **Endpoint inventory** — Read all Endpoint nodes from graph. For each: method, path, parameters, auth requirement.
2. **Parameter classification** — Categorize each parameter: user-controlled, derived, hidden. Flag parameters that flow across endpoints (IDOR risk).
3. **Input validation mapping** — For each input: where is it validated (client, server, both)? What encoding/escaping is applied?

## Phase 4: Attack Execution (ordered by severity potential)

Execute attacks in this priority order:

### 4a. Injection (highest impact)
- Load `exploitation` skill for SQLi, XSS, SSTI techniques
- Test each parameter with detection payloads (error-based, blind, time-based)
- Confirm before escalating: one narrow end-to-end flow

### 4b. Authentication & Authorization
- Load `authorization` skill for authz testing
- Test broken access control: access resources as different roles
- Test IDOR: swap IDs between authorized endpoints
- Test privilege escalation: low-priv → high-priv actions

### 4c. Business Logic
- Load `business-logic` skill for workflow bypass
- Test multi-step workflows: can steps be skipped, reordered, replayed?
- Test race conditions on critical operations (payment, balance, inventory)
- Test input boundary violations (negative quantities, overflow values)

### 4d. SSRF & External Interaction
- Load `blind-ssrf` skill for out-of-band detection
- Use OAST callbacks to confirm server-side requests
- Test internal network access via SSRF

### 4e. Client-Side
- Load `modern-xss` skill for DOM-based attacks
- Test DOM manipulation, prototype pollution, client-side routing bypass
- Test CSS injection for data exfiltration

## Phase 5: Exploitation & Proof

For each confirmed vulnerability:
1. **Build minimal PoC** — Smallest possible reproduction case
2. **Document impact** — What can an attacker achieve?
3. **Record finding** — Use `writeFinding` with structured evidence (request, response, impact)
4. **Verify independently** — Re-run the PoC to confirm it's not a false positive

## Phase 6: Reporting

1. **Severity classification** — CVSS-based, considering business impact
2. **Remediation guidance** — Specific, actionable fix for each finding
3. **Evidence chain** — Each finding linked to raw request/response pairs

## Anti-Patterns (never do these)

- Do not run all payloads at once — one variable at a time
- Do not skip auth context — always load captured headers first
- Do not trust client-side validation — test server-side independently
- Do not report unverified findings as confirmed
