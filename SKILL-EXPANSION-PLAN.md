# Skill Expansion Plan — Ultimatrix v8.2

> **Goal:** Transform 21 basic skills into 47 path-breaking, bug-bounty-ready skills with a scalable infrastructure that supports 100+ skills without code changes.

---

## Current State Assessment

### Skill System Infrastructure (Broken)

| Component | File | Status | Issue |
|-----------|------|--------|-------|
| Primary Loader | `src/solver/skills/loader.ts` | OK (179 lines) | Synchronous, loads all bodies at init |
| Legacy Loader | `src/analysis/skill-loader.ts` | DEAD CODE | 242 lines, `BUILTIN_SKILLS` hardcoded duplicates |
| Matcher #1 | `src/solver/skills/tool-filter.ts:52` | `resolveSkillsForInput()` | NL keyword matching, top 3 |
| Matcher #2 | `src/solver/skills/registry.ts:81` | `matchSkills()` | Target-aware, hardcoded skill sets |
| Matcher #3 | `src/solver/skills/loader.ts:147` | `searchSkills()` | Basic keyword search |
| Registry | `src/solver/skills/registry.ts` | OK (174 lines) | Wraps loader, adds matching |
| Tool Filter | `src/solver/skills/tool-filter.ts` | OK (113 lines) | 34 CORE_TOOLS always included |

### Critical: 21 Broken Imports

`src/skills/` directory does **NOT exist**, but 21 files import from `../skills/registry`, `../skills/loader`, `../skills/tool-filter`:

| File | Import Path | Actual Location |
|------|------------|-----------------|
| `src/mastra/index.ts:3` | `../skills/registry.js` | `src/solver/skills/registry.ts` |
| `src/mastra/index.ts:11` | `../skills/tool-filter.js` | `src/solver/skills/tool-filter.ts` |
| `src/session.ts:5` | `./skills/tool-filter` | `src/solver/skills/tool-filter.ts` |
| `src/session/lifecycle.ts:36` | `../skills/tool-filter` | `src/solver/skills/tool-filter.ts` |
| `src/session/lifecycle.ts:38` | `../skills/registry` | `src/solver/skills/registry.ts` |
| `src/workers/pool.ts:5` | `../skills/registry` | `src/solver/skills/registry.ts` |
| `src/workers/factory.ts:3` | `../skills/registry` | `src/solver/skills/registry.ts` |
| `src/workers/factory.ts:5` | `../skills/loader` | `src/solver/skills/loader.ts` |
| `src/mastra/workspace.ts:8` | `../skills/registry` | `src/solver/skills/registry.ts` |
| `src/cli/solve.ts:14` | `../skills/registry` | `src/solver/skills/registry.ts` |
| `src/lib/agent-manager.ts:15` | `../skills/registry` | `src/solver/skills/registry.ts` |
| `src/manager/agent.ts:8` | `../skills/registry` | `src/solver/skills/registry.ts` |
| `src/swarm/builder.ts:2` | `../skills/registry` | `src/solver/skills/registry.ts` |
| `src/intelligence/hypotheses.ts:4` | `../skills/registry` | `src/solver/skills/registry.ts` |
| `src/tools/tool-selector.ts:4` | `../skills/loader` | `src/solver/skills/loader.ts` |
| `src/tools/skill-tools.ts:3` | `../skills/loader` | `src/solver/skills/loader.ts` |
| `src/manager/tools/spawn-worker.ts:3` | `../../skills/registry` | `src/solver/skills/registry.ts` |
| `src/manager/tools/spawn-swarm.ts:3` | `../../skills/registry` | `src/solver/skills/registry.ts` |
| `src/manager/tools/skill-search.ts:3` | `../../skills/registry` | `src/solver/skills/registry.ts` |
| `src/manager/tools/skill-load.ts:3` | `../../skills/registry` | `src/solver/skills/registry.ts` |
| `src/manager/tools/execute-direct.ts:3` | `../../skills/registry` | `src/solver/skills/registry.ts` |

### Test Files with Broken Imports

| Test File | Import Path |
|-----------|------------|
| `test/skills/target-aware-matcher.test.ts:2` | `../../src/skills/registry` |
| `test/skills/target-aware-matcher.test.ts:3` | `../../src/skills/loader` |
| `test/tools/skill-tools.test.ts:15` | `../../src/skills/loader` |
| `test/analysis/skill-loader.test.ts:12` | `../../src/analysis/skill-loader` (legacy) |
| `test/analysis/instructions.test.ts:3` | `../../src/analysis/skill-loader` (legacy) |

### Current Skills (21 files, 3 directories)

| # | File | Category | Tier | Lines | Quality | Action |
|---|------|----------|------|-------|---------|--------|
| 1 | `core/recon.md` | core | fast | 95 | STRONG | KEEP → `recon/` |
| 2 | `core/vuln-discovery.md` | core | balanced | 107 | STRONG | KEEP → `injection/` |
| 3 | `core/exploitation.md` | core | powerful | 40 | MODERATE | REWRITE → `injection/` |
| 4 | `core/post-exploitation.md` | core | balanced | 40 | MODERATE | KEEP → `recon/` |
| 5 | `core/reporting.md` | core | fast | 39 | MODERATE | KEEP → `reports/` |
| 6 | `core/waf-bypass.md` | core | balanced | 38 | WEAK | DELETE (subset of vuln-discovery) |
| 7 | `core/pentest-flow.md` | core | balanced | 28 | WEAK | DELETE (redundant summary) |
| 8 | `specialized/web-pentest.md` | specialized | balanced | 40 | MODERATE | REWRITE → `web-attacks/` |
| 9 | `specialized/web-security-advanced.md` | specialized | powerful | 40 | MODERATE | REWRITE → `web-attacks/` |
| 10 | `specialized/crypto-toolkit.md` | specialized | balanced | 41 | MODERATE | REWRITE → `crypto/` |
| 11 | `specialized/ctf-web.md` | specialized | fast | 39 | WEAK | DELETE (subset of web-pentest) |
| 12 | `specialized/ctf-crypto.md` | specialized | balanced | 40 | MODERATE | KEEP → `crypto/` |
| 13 | `specialized/ctf-misc.md` | specialized | fast | 41 | MODERATE | KEEP → `recon/` |
| 14 | `specialized/osint-recon.md` | specialized | fast | 41 | MODERATE | KEEP → `recon/` |
| 15 | `specialized/ai-mcp-security.md` | specialized | balanced | 42 | MODERATE | KEEP → `api-security/` |
| 16 | `specialized/intranet-pentest.md` | specialized | balanced | 41 | MODERATE | KEEP → `recon/` |
| 17 | `specialized/pentest-tools.md` | specialized | balanced | 41 | WEAK | DELETE (meta-noise, no payloads) |
| 18 | `analysis/authorization.md` | specialized* | powerful | 96 | STRONG | KEEP → `auth-security/` |
| 19 | `analysis/business-logic.md` | specialized* | powerful | 120 | STRONG | KEEP → `web-attacks/` |
| 20 | `analysis/information-disclosure.md` | specialized* | balanced | 107 | STRONG | KEEP → `recon/` |
| 21 | `analysis/race-conditions.md` | specialized* | powerful | 34 | WEAK | DELETE (subset of business-logic Step 4) |

---

## Wave 1: Infrastructure Upgrades ✅ COMPLETE (2026-07-06)

**1048 tests passing, 77 files, clean build**

### Completed Steps
- [x] Step 1.1: Domain-based directory restructure (8 domains, 16 skills, 5 deleted)
- [x] Step 1.2: Fixed 24 broken imports (`src/skills/` → `src/solver/skills/`)
- [x] Step 1.3: Updated loader for domain dirs + `domain`/`contextBoosts` fields
- [x] Step 1.4: Progressive disclosure (`initSkillIndex()` + `loadSkillBody()`)
- [x] Step 1.5: Updated `SkillRegistry` to use `contextBoosts` (no hardcoded sets)
- [x] Step 1.6: Replaced `AUTH_SKILLS`, `SQL_SKILLS`, `WEBSOCKET_SKILLS`, `GRAPHQL_SKILLS` with contextBoosts
- [x] Step 1.7: Updated consumers (`session.ts`, `execute-direct.ts`, `skill-load.ts`, `skill-tools.ts`)
- [x] Step 1.8: Updated/created tests (loader-tier, matcher, skill-tools)
- [x] Step 1.9: Updated barrel exports (`src/solver/skills/index.ts`)

### Files Modified
| File | Action |
|------|--------|
| `src/solver/skills/loader.ts` | Rewritten — domain scan, SkillMeta, progressive disclosure |
| `src/solver/skills/registry.ts` | Rewritten — contextBoosts matching, no hardcoded sets |
| `src/solver/skills/tool-filter.ts` | Updated — returns SkillMeta[] |
| `src/solver/skills/index.ts` | Updated — new exports |
| `src/session.ts` | Updated — progressive disclosure for matched skills |
| `src/session/lifecycle.ts` | Updated — removed dead import |
| 21 source files | Fixed broken imports |
| 3 test files | Updated for new types/counts |
| 16 skill .md files | Moved to domain directories |
| 5 skill .md files | Deleted (dead skills) |

---

## Wave 2: Rewrite 6 Weakest Skills

### Step 1.1: Create Domain-Based Directory Structure

**New structure under `skills/`:**
```
skills/
  injection/           # SQLi, NoSQL, SSTI, command injection, XPATH
  web-attacks/         # XSS, CSRF, SSRF, XXE, open redirect, clickjacking, file upload
  api-security/        # GraphQL, REST, JWT, WebSocket, mass assignment
  auth-security/       # OAuth, RBAC, IDOR, session management
  cloud-security/      # SSRF, metadata, IAM, container
  crypto/              # TLS, hashing, encoding, key management
  recon/               # OSINT, fingerprinting, endpoint discovery
  reports/             # Reporting, CVSS, business case
```

**Moves:**
| Current | Destination |
|---------|-------------|
| `core/recon.md` | `recon/recon.md` |
| `core/vuln-discovery.md` | `injection/vuln-discovery.md` |
| `core/exploitation.md` | `injection/exploitation.md` |
| `core/post-exploitation.md` | `recon/post-exploitation.md` |
| `core/reporting.md` | `reports/reporting.md` |
| `specialized/web-pentest.md` | `web-attacks/web-pentest.md` |
| `specialized/web-security-advanced.md` | `web-attacks/web-security-advanced.md` |
| `specialized/crypto-toolkit.md` | `crypto/crypto-toolkit.md` |
| `specialized/ctf-crypto.md` | `crypto/ctf-crypto.md` |
| `specialized/ctf-misc.md` | `recon/ctf-misc.md` |
| `specialized/osint-recon.md` | `recon/osint-recon.md` |
| `specialized/ai-mcp-security.md` | `api-security/ai-mcp-security.md` |
| `specialized/intranet-pentest.md` | `recon/intranet-pentest.md` |
| `analysis/authorization.md` | `auth-security/authorization.md` |
| `analysis/business-logic.md` | `web-attacks/business-logic.md` |
| `analysis/information-disclosure.md` | `recon/information-disclosure.md` |

**Deletes (5 dead skills):**
- `core/waf-bypass.md` — subset of vuln-discovery WAF section
- `core/pentest-flow.md` — redundant 28-line summary of 5 core skills
- `specialized/ctf-web.md` — weak subset of web-pentest + vuln-discovery
- `specialized/pentest-tools.md` — meta-noise, no payloads
- `analysis/race-conditions.md` — subset of business-logic Step 4

**Remove empty old directories:** `core/`, `specialized/`, `analysis/`

### Step 1.2: Fix Broken Imports (`src/skills/` → `src/solver/skills/`)

All 21 broken imports must be fixed to point to the actual location `src/solver/skills/`.

**Pattern:** `../skills/X` → `../solver/skills/X` (adjust relative depth per file)

| File | Old Import | New Import |
|------|-----------|------------|
| `src/mastra/index.ts` | `../skills/registry.js` | `../solver/skills/registry.js` |
| `src/mastra/index.ts` | `../skills/tool-filter.js` | `../solver/skills/tool-filter.js` |
| `src/session.ts` | `./skills/tool-filter` | `./solver/skills/tool-filter` |
| `src/session/lifecycle.ts` | `../skills/tool-filter` | `../solver/skills/tool-filter` |
| `src/session/lifecycle.ts` | `../skills/registry` | `../solver/skills/registry` |
| `src/workers/pool.ts` | `../skills/registry` | `../solver/skills/registry` |
| `src/workers/factory.ts` | `../skills/registry` | `../solver/skills/registry` |
| `src/workers/factory.ts` | `../skills/loader` | `../solver/skills/loader` |
| `src/mastra/workspace.ts` | `../skills/registry` | `../solver/skills/registry` |
| `src/cli/solve.ts` | `../skills/registry` | `../solver/skills/registry` |
| `src/lib/agent-manager.ts` | `../skills/registry` | `../solver/skills/registry` |
| `src/manager/agent.ts` | `../skills/registry` | `../solver/skills/registry` |
| `src/swarm/builder.ts` | `../skills/registry` | `../solver/skills/registry` |
| `src/intelligence/hypotheses.ts` | `../skills/registry` | `../solver/skills/registry` |
| `src/tools/tool-selector.ts` | `../skills/loader` | `../solver/skills/loader` |
| `src/tools/skill-tools.ts` | `../skills/loader` | `../solver/skills/loader` |
| `src/manager/tools/spawn-worker.ts` | `../../skills/registry` | `../../solver/skills/registry` |
| `src/manager/tools/spawn-swarm.ts` | `../../skills/registry` | `../../solver/skills/registry` |
| `src/manager/tools/skill-search.ts` | `../../skills/registry` | `../../solver/skills/registry` |
| `src/manager/tools/skill-load.ts` | `../../skills/registry` | `../../solver/skills/registry` |
| `src/manager/tools/execute-direct.ts` | `../../skills/registry` | `../../solver/skills/registry` |

**Test files:**
| Test File | Old Import | New Import |
|-----------|-----------|------------|
| `test/skills/target-aware-matcher.test.ts` | `../../src/skills/registry` | `../../src/solver/skills/registry` |
| `test/skills/target-aware-matcher.test.ts` | `../../src/skills/loader` | `../../src/solver/skills/loader` |
| `test/tools/skill-tools.test.ts` | `../../src/skills/loader` | `../../src/solver/skills/loader` |

### Step 1.3: Update Loader for Domain-Based Directories

**Modify:** `src/solver/skills/loader.ts`

Current hardcoded scan:
```typescript
loadDir(join(SKILLS_DIR, 'core'), 'core')
loadDir(join(SKILLS_DIR, 'specialized'), 'specialized')
loadDir(ANALYSIS_SKILLS_DIR, 'specialized')
```

New: Scan ALL subdirectories of `skills/`:
```typescript
// Scan all subdirectories under skills/
const entries = readdirSync(SKILLS_DIR)
for (const entry of entries) {
  const entryPath = join(SKILLS_DIR, entry)
  if (statSync(entryPath).isDirectory()) {
    loadDir(entryPath, entry)  // domain name = category
  }
}
```

**Update `Skill` interface** — add `domain` field:
```typescript
export interface Skill {
  id: string
  name: string
  domain: string        // NEW: e.g. 'injection', 'web-attacks', 'auth-security'
  tier: SkillTier
  description: string
  instructions: string
  references: Reference[]
  toolRefs: string[]
  triggers: string[]
  contextBoosts: string[]  // NEW: replaces hardcoded AUTH_SKILLS etc.
}
```

**Add `contextBoosts` parsing** in `parseSkillFile()`:
```typescript
const contextBoosts = Array.isArray(meta.contextBoosts)
  ? meta.contextBoosts.filter((b): b is string => typeof b === 'string')
  : []
```

### Step 1.4: Progressive Disclosure

**Change `loadAllSkills()`** to two-phase:

1. `initSkillIndex()` — reads ONLY frontmatter from all `.md` files (fast, ~80 lines total)
2. `loadSkillBody(id)` — reads full file on demand (called when agent selects a skill)

Add to each skill `.md` frontmatter:
```yaml
---
name: recon
domain: recon
tier: fast
contextBoosts:
  - endpoints
toolRefs: [...]
triggers: [...]
---
```

**Impact:** Init goes from ~1100 lines of skill text in memory to ~80 lines of metadata. Full body loaded only for the 3 matched skills.

### Step 1.5: Create Consolidated SkillMatcher

**New file:** `src/solver/skills/matcher.ts`

Consolidates all 3 matching systems into one:

```typescript
export class SkillMatcher {
  private index: Map<string, SkillMeta> = new Map()
  private recentUses: Map<string, number> = new Map()

  // Called once at startup
  init(): void  // calls initSkillIndex()

  // Single matching entry point (replaces resolveSkillsForInput + matchSkills + searchSkills)
  match(input: string, context?: MatchContext): SkillMatch[]

  // Load full skill body on demand
  loadSkill(id: string): Skill | null

  // Tool filtering (replaces resolveToolsForSkills)
  resolveTools(skillIds: string[]): string[]

  // Get all core tools (replaces getCoreTools)
  getCoreTools(): string[]

  // Track usage for diversity
  recordUse(skillId: string): void

  // All skills metadata
  list(): SkillMeta[]
}

interface MatchContext {
  graphSummary?: {
    hasAuth: boolean
    hasSQL: boolean
    hasGraphQL: boolean
    hasAPI: boolean
    hasWebSocket: boolean
    untestedEndpoints: number
  }
  goal?: string
  complexity?: 'low' | 'medium' | 'high' | 'critical'
  previousSkills?: string[]
}
```

**Scoring system:**
1. Trigger match: +8 per trigger found in input
2. ID match: +10 if skill ID is in input
3. ID parts match: +6 per ID part found
4. Description words: +3 per word > 3 chars found
5. Name words: +2 per word > 3 chars found
6. contextBoosts: +6 per boost matching context signal
7. Goal alignment: +5 if goal keywords match skill domain
8. Complexity alignment: +3 if tier matches complexity
9. Diversity penalty: -5 per previous use (max -10)

### Step 1.6: Replace Hardcoded Skill Sets with contextBoosts

**Delete from `src/solver/skills/registry.ts`:**
```typescript
const AUTH_SKILLS = new Set(['authorization', 'post-exploitation'])
const SQL_SKILLS = new Set(['vuln-discovery', 'exploitation'])
const WEBSOCKET_SKILLS = new Set(['web-pentest', 'web-security-advanced'])
const GRAPHQL_SKILLS = new Set(['web-pentest'])
```

**Add to `src/intelligence/constants.ts`:**
```typescript
export const CONTEXT_SIGNALS: Record<string, (ctx: MatchContext) => boolean> = {
  auth:       (ctx) => ctx.graphSummary?.hasAuth === true,
  sqli:       (ctx) => ctx.graphSummary?.hasSQL === true,
  graphql:    (ctx) => ctx.graphSummary?.hasGraphQL === true,
  endpoints:  (ctx) => (ctx.graphSummary?.untestedEndpoints ?? 0) > 3,
  api:        (ctx) => ctx.graphSummary?.hasAPI === true,
  websocket:  (ctx) => ctx.graphSummary?.hasWebSocket === true,
}
```

**Each skill declares its own boosts in frontmatter:**
```yaml
# auth-security/authorization.md
contextBoosts: [auth, endpoints]

# injection/vuln-discovery.md
contextBoosts: [sqli]

# api-security/graphql-attacks.md
contextBoosts: [graphql, api]
```

### Step 1.7: Delete Legacy Loader

**Delete:** `src/analysis/skill-loader.ts` (242 lines)
- Contains `BUILTIN_SKILLS` hardcoded duplicates
- Contains async `loadSkill()`, `loadAllSkills()`, `getSkillsByCategory()`, `getCategories()`, `getBuiltinSkill()`

**Update consumers:**
| File | Old Import | New Import |
|------|-----------|------------|
| `src/sdk.ts:6` | `./analysis/skill-loader` | `./solver/skills/loader` |
| `src/sdk.ts:7` | `./analysis/skill-loader` | `./solver/skills/loader` |
| `src/analysis/instructions.ts` | (if imports skill-loader) | Update to use `SkillMatcher` |

**Update tests:**
| Test | Action |
|------|--------|
| `test/analysis/skill-loader.test.ts` | DELETE — tests deleted legacy loader |
| `test/analysis/instructions.test.ts` | UPDATE — remove `BUILTIN_SKILLS` import, use new types |

### Step 1.8: Update Existing Tests

**`test/skills/target-aware-matcher.test.ts`:**
- Fix imports: `../../src/skills/registry` → `../../src/solver/skills/registry`
- Fix imports: `../../src/skills/loader` → `../../src/solver/skills/loader`
- Add tests for `contextBoosts` matching
- Verify deleted hardcoded sets no longer referenced

**`test/tools/skill-tools.test.ts`:**
- Fix import: `../../src/skills/loader` → `../../src/solver/skills/loader`

**New test file: `test/skills/matcher.test.ts`:**
- Test `init()` loads all 16 skills
- Test `match()` scoring with various inputs
- Test `contextBoosts` boost when graph context matches
- Test `resolveTools()` returns CORE_TOOLS + skill toolRefs
- Test progressive disclosure (body not loaded until `loadSkill()`)

### Step 1.9: Update barrel exports

**`src/solver/skills/index.ts`:**
```typescript
export { SkillRegistry } from './registry'
export { SkillMatcher } from './matcher'  // NEW
export { getAllSkills, loadSkill, searchSkills, loadReference, listReferences, resetSkillCache } from './registry'
export type { Skill, Reference } from './registry'
```

---

## Wave 2: Rewrite 6 Weakest Skills

Transform basic/textbook skills into path-breaking, payload-rich references.

### Skills to Rewrite

| Skill | Current Lines | Target Lines | Key Additions |
|-------|--------------|-------------|---------------|
| `injection/exploitation.md` | 40 | 150+ | Real SQLi/XSS/SSRF payloads, tool commands, WAF bypass chains |
| `web-attacks/web-pentest.md` | 40 | 180+ | Modern XSS polyglots, SSRF chains, CSRF token bypass, HTTP method tampering |
| `injection/vuln-discovery.md` | 107 | 150+ | Add specific payloads for each vuln class, tool-specific curl commands |
| `web-attacks/web-security-advanced.md` | 40 | 180+ | CSP bypass techniques, CORS misconfiguration, subdomain takeover, prototype pollution chains |
| `auth-security/authorization.md` | 96 | 150+ | Add JWT tool commands, OAuth bypass payloads, IDOR automation scripts |
| `crypto/crypto-toolkit.md` | 41 | 150+ | Hash length extension, padding oracle, CBC bit flipping, specific tool commands |

### Quality Standard (from Anthropic reference analysis)

Each rewritten skill must include:
1. **When to Use / Do Not Use** — clear activation criteria
2. **Prerequisites** — specific tools needed (Burp, jwt_tool, sqlmap, etc.)
3. **Step-by-step workflow** with:
   - Real curl commands or Python scripts
   - Actual payload strings (not "inject malicious input")
   - Decision trees for different responses
   - Tool-specific invocation examples
4. **WAF bypass section** with encoding techniques
5. **Impact demonstration** — how to prove severity
6. **Anti-Hallucination** section

### Frontmatter Format (all skills)

```yaml
---
name: <skill-slug>
domain: <domain-directory>
tier: fast|balanced|powerful
description: "One-line description"
toolRefs: [tool1, tool2]
triggers: ["natural language phrase 1", "phrase 2"]
contextBoosts: [signal1, signal2]
mitre_attack:
  - T1190
  - T1059
owasp_refs:
  - A03:2021
---
```

---

## Wave 3: Add 12 High-Priority New Skills ✅ COMPLETE (2026-07-06)

**28 total skills, 1048 tests passing**

### Skills Created
| Skill | Domain | Lines | Content |
|-------|--------|-------|---------|
| `ssti` | injection | 552 | Jinja2/Twig/Freemarker/Velocity/Handlebars/Go RCE chains |
| `modern-xss` | web-attacks | 438 | Polyglot payloads, CSP bypass, DOM clobbering, mutation XSS |
| `graphql-attacks` | api-security | 533 | Introspection, batching, alias brute force, nested DoS |
| `api-security` | api-security | 698 | BOLA, mass assignment, rate limit bypass, versioning |
| `jwt-advanced` | auth-security | 365 | Alg confusion, JKU injection, KID traversal, weak secrets |
| `http-smuggling` | web-attacks | 429 | CL.TE, TE.CL, TE.TE, H2.CL, 20+ TE obfuscation |
| `open-redirect` | web-attacks | 150+ | Filter bypass, OAuth token theft, tabnabbing |
| `cache-poisoning` | web-attacks | 683 | Unkeyed headers, param cloaking, fat GET, CDN-specific |
| `file-upload-attacks` | web-attacks | 150+ | Double extension, polyglot, SVG XSS, ImageMagick |
| `cors-misconfig` | web-attacks | 160+ | Null origin, subdomain matching, wildcard bypass |
| `host-header-injection` | web-attacks | 288 | Password reset poisoning, cache poisoning, SSRF |
| `race-conditions-advanced` | web-attacks | 364 | Turbowlence, single-packet, TOCTOU chains |

### BOM Fix
- Added BOM stripping to `parseFrontmatter()` in loader.ts (Windows-encoded files)

### New Skills by Domain

| # | Skill ID | Domain | Tier | Description |
|---|----------|--------|------|-------------|
| 1 | `ssti` | injection | powerful | Server-Side Template Injection — Jinja2, Twig, Freemarker, Velocity, Handlebars chains |
| 2 | `modern-xss` | web-attacks | powerful | Modern XSS — polyglot payloads, CSP bypass, DOM clobbering, import-map abuse |
| 3 | `graphql-attacks` | api-security | powerful | GraphQL — introspection abuse, batching, alias brute force, nested query DoS |
| 4 | `api-security` | api-security | balanced | REST API — mass assignment, BOLA, rate limiting bypass, API versioning attacks |
| 5 | `jwt-advanced` | auth-security | powerful | JWT — alg:none, key confusion, jku/x5u injection, token injection, null byte attacks |
| 6 | `http-smuggling` | web-attacks | powerful | HTTP Request Smuggling — CL.TE, TE.CL, TE.TE, H2.CL, H2.TE, smuggling via HTTP/2 |
| 7 | `open-redirect` | web-attacks | balanced | Open Redirect — filter bypass, JavaScript URI, tabnabbing, OAuth token theft |
| 8 | `cache-poisoning` | web-attacks | powerful | Web Cache Poisoning — unkeyed headers, param Cloaking, fat GET, normalization |
| 9 | `file-upload-attacks` | web-attacks | balanced | File Upload — double extension, null byte, polyglot files, SVG XSS, webshell upload |
| 10 | `cors-misconfig` | web-attacks | balanced | CORS Misconfiguration — null origin, subdomain matching, wildcard reflection |
| 11 | `host-header-injection` | web-attacks | balanced | Host Header — password reset poisoning, cache poisoning, SSRF via Host |
| 12 | `race-conditions-advanced` | web-attacks | powerful | Race Conditions — Turbowlence, concurrent file reads, TOCTOU chains, single-packet attacks |

---

## Wave 4: Add 8 Medium-Priority New Skills ✅ COMPLETE (2026-07-06)

**36 skills total, 1048 tests passing**

| Skill | Domain | Lines | Content |
|-------|--------|-------|---------|
| `xxe` | injection | 426 | Classic, blind, SVG, SOAP, filter bypass, billion laughs |
| `nosql-injection` | injection | 589 | MongoDB operators, JS injection, ReDoS, CouchDB |
| `command-injection-advanced` | injection | 311 | Filter bypass, encoding, blind exfil, polyglot |
| `deserialization` | web-attacks | 305 | Java/PHP/Python/.NET gadget chains, cookie-based |
| `prototype-pollution` | web-attacks | 620 | __proto__, merge patterns, sandbox escape |
| `websocket-attacks` | api-security | 304 | CSWSH, message injection, protocol abuse |
| `subdomain-takeover` | recon | 315 | CNAME enumeration, cloud takeovers |
| `type-juggling` | web-attacks | 501 | PHP loose comparison, magic hashes, strcmp bypass |

## Wave 5: Add 6 Lower-Priority New Skills ✅ COMPLETE (2026-07-06)

**41 skills total, 1048 tests passing**

| Skill | Domain | Lines | Content |
|-------|--------|-------|---------|
| `clickjacking` | web-attacks | 400 | X-Frame-Options, CSP frame-ancestors, cookie forcing |
| `css-injection` | web-attacks | 371 | Attribute selectors, data exfil, CSS keylogger |
| `hsts-bypass` | recon | 398 | Downgrade, preload bypass, SSL stripping |
| `email-injection` | injection | 331 | SMTP header injection, CRLF, spoofing |
| `directory-traversal-advanced` | injection | 180+ | Encoding bypass, PHP wrappers, log poisoning |
| `ssl-stripping` | recon | 332 | HTTPS downgrade, HSTS bypass, cert pinning bypass |

## Wave 6: Polish — MITRE ATT&CK + OWASP Refs ✅ COMPLETE (2026-07-06)

- All 41 skills now have `mitreAttack` and `owaspRefs` in YAML frontmatter
- 77 test files, 1048 tests passing, clean build
- Final skill line counts: 48-702 lines per skill, avg ~320 lines

## Final Skill Library Summary

**41 skills across 8 domain directories:**

| Domain | Count | Total Lines | Avg Lines |
|--------|-------|-------------|-----------|
| injection | 7 | 3,578 | 511 |
| web-attacks | 16 | 6,228 | 389 |
| api-security | 4 | 2,260 | 565 |
| auth-security | 2 | 878 | 439 |
| crypto | 2 | 676 | 338 |
| recon | 10 | 1,609 | 161 |
| reports | 1 | 48 | 48 |
| cloud-security | 0 | 0 | 0 |
| **Total** | **41** | **15,277** | **373** |

| # | Skill ID | Domain | Tier | Description |
|---|----------|--------|------|-------------|
| 1 | `xxe` | injection | powerful | XXE — classic, blind, OOB, file read, SSRF, SVG/image upload XXE |
| 2 | `nosql-injection` | injection | balanced | NoSQL Injection — MongoDB, CouchDB, operator injection, regex DoS |
| 3 | `command-injection-advanced` | injection | powerful | Command Injection — filter bypass, time-based, OOB, polyglot payloads |
| 4 | `deserialization` | web-attacks | powerful | Deserialization — Java, PHP, Python, .NET gadget chains, object injection |
| 5 | `prototype-pollution` | web-attacks | balanced | Prototype Pollution — deep merge exploits, Angular/Jinja2 sandbox escape |
| 6 | `websocket-attacks` | api-security | balanced | WebSocket — cross-site WebSocket hijacking, message injection, CSWSH |
| 7 | `subdomain-takeover` | recon | balanced | Subdomain Takeover — dangling CNAME, S3/Azure/GitHub Pages takeover |
| 8 | `type-juggling` | web-attacks | balanced | PHP Type Juggling — magic hashes, loose comparison, `==` vs `===` |

---

## Wave 5: Add 6 Lower-Priority New Skills

| # | Skill ID | Domain | Tier | Description |
|---|----------|--------|------|-------------|
| 1 | `clickjacking` | web-attacks | fast | Clickjacking — frame busting bypass, nested iframes, drag-and-drop |
| 2 | `css-injection` | web-attacks | balanced | CSS Injection — data exfiltration via CSS selectors, @import-based exfil |
| 3 | `hsts-bypass` | web-attacks | fast | HSTS Bypass — subdomain stripping, preloading gaps, 307 redirect abuse |
| 4 | `email-injection` | web-attacks | balanced | Email Header Injection — CRLF in SMTP, header injection, email bombing |
| 5 | `directory-traversal-advanced` | injection | balanced | Path Traversal — filter bypass, encoding tricks, null byte, double URL encoding |
| 6 | `ssl-stripping` | web-attacks | fast | SSL Struggling — HSTS bypass, downgrade attack, certificate pinning bypass |

---

## Wave 6: Polish

### MITRE ATT&CK IDs

Add `mitre_attack` field to all skill frontmatter:

| Attack | MITRE ID |
|--------|----------|
| SQL Injection | T1190 |
| XSS | T1189 |
| SSRF | T1190 |
| Command Injection | T1059 |
| File Upload | T1190 |
| Path Traversal | T1083 |
| Authentication Bypass | T1078 |
| Privilege Escalation | T1068 |
| Deserialization | T1190 |
| XML External Entity | T1203 |
| Template Injection | T1059 |
| HTTP Smuggling | T1190 |
| Cache Poisoning | T1190 |

### OWASP Top 10 2021 References

Add `owasp_refs` to all skill frontmatter:
- A01: Broken Access Control
- A02: Cryptographic Failures
- A03: Injection
- A04: Insecure Design
- A05: Security Misconfiguration
- A06: Vulnerable and Outdated Components
- A07: Identification and Authentication Failures
- A08: Software and Data Integrity Failures
- A09: Security Logging and Monitoring Failures
- A10: Server-Side Request Forgery

### Coverage Audit

Verify all 47 skills:
- [ ] Have `domain`, `tier`, `triggers`, `toolRefs`, `contextBoosts` in frontmatter
- [ ] Have anti-hallucination section
- [ ] Have real payloads (not just methodology)
- [ ] Load correctly via `SkillMatcher.loadSkill()`
- [ ] Tool filtering works: `SkillMatcher.resolveTools([id])` returns correct tools
- [ ] Context matching works: `SkillMatcher.match("test JWT")` → `jwt-advanced`

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking 21 imports | HIGH | Fix all imports before any other changes |
| Tests fail after directory restructure | MEDIUM | Update test imports, add new tests |
| Loader can't find skills after restructure | HIGH | Test `initSkillIndex()` finds all 16 skills |
| Progressive disclosure breaks solver injection | HIGH | Verify `loadSkillBody()` returns same format as old `loadSkill()` |
| contextBoosts don't match correctly | MEDIUM | Test with mock graph summaries |
| New skills too large for LLM context | LOW | Progressive disclosure + summary-first approach |

---

## Verification Checklist

- [ ] `npm run build:cli` — clean build, zero errors
- [ ] `npm test` — all tests pass
- [ ] `node -e "..."` — verify `SkillMatcher.init()` loads 16 skills
- [ ] Manual: `SkillMatcher.match("test for XSS")` → returns `web-pentest` or `modern-xss`
- [ ] Manual: `SkillMatcher.match("JWT token broken")` → returns `jwt-advanced` or `authorization`
- [ ] Manual: `SkillMatcher.match("GraphQL introspection")` → returns `graphql-attacks`
- [ ] Manual: contextBoosts boost `authorization` when `graphSummary.hasAuth = true`
- [ ] Manual: `SkillMatcher.resolveTools(["jwt-advanced"])` → includes JWT-specific tools
- [ ] Manual: deleted skills (pentest-flow, waf-bypass, etc.) no longer loadable
- [ ] Manual: `src/skills/` directory does NOT exist (no stale references)

---

## Execution Order

1. **Step 1.2** — Fix broken imports (21 files) — unblocks everything
2. **Step 1.1** — Create domain directories, move/delete skill files
3. **Step 1.3** — Update loader for domain dirs + `domain`/`contextBoosts` fields
4. **Step 1.4** — Progressive disclosure (`initSkillIndex()` + `loadSkillBody()`)
5. **Step 1.5** — Create `SkillMatcher` class
6. **Step 1.6** — Replace hardcoded sets with contextBoosts
7. **Step 1.7** — Delete legacy loader + update consumers
8. **Step 1.8** — Update/create tests
9. **Step 1.9** — Update barrel exports
10. **Verify** — `npm test` + `npm run build:cli`
