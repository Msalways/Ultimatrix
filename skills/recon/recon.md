---
name: recon
description: "Reconnaissance and attack surface mapping through passive and active intelligence gathering"
category: core
tier: fast
toolRefs: [httpRequest, runRecon, frameworkFingerprint, findEndpointsInResponse, queryGraph, updateGraph, evaluateRendered, followRedirects, recordEvidence, writeFinding, getCapturedHeaders]
triggers: ["find all endpoints", "map the attack surface", "reconnaissance", "discovery", "enumerate", "fingerprint technology", "find api endpoints", "passive scanning", "attack surface mapping", "endpoint discovery"]
mitreAttack: ["T1595", "T1592"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# Reconnaissance

## Description
Reconnaissance is the foundation of all security testing. You systematically discover and enumerate the target, building a complete attack surface map before any vulnerability testing begins.

## Auth Context
Before making HTTP requests, call **getCapturedHeaders** with the target URL to get real auth context. Pass these in the `headers` parameter of httpRequest.

## Methodology

### Phase 1: Passive Reconnaissance
Gather information without touching the target directly:
- Technology stack identification from HTTP headers, error pages, cookie names
- JavaScript library detection and version fingerprinting
- Public code repositories, job postings (reveal tech stack), archived pages
- Certificate transparency logs, DNS records

### Phase 2: Endpoint Discovery
1. Navigate to the target URL and capture the full page snapshot
2. Extract all links, forms, and API endpoints from the page source
3. Use **stagehand_extract** to get structured data from complex pages (forms, links, data attributes)
4. Test common paths: /api, /graphql, /admin, /.env, /robots.txt, /sitemap.xml, /swagger, /openapi.json
5. Check for API documentation endpoints: /docs, /api-docs, /swagger.json, /openapi.yaml
6. Record every discovered endpoint to the graph with **updateGraph**

### Phase 3: Deep Page Analysis (CRITICAL — Do Not Skip)
This is where most scanners miss real findings. You must look at what the page actually contains:

1. **Examine HTML source for sensitive data:**
   - HTML comments with credentials, paths, or TODOs
   - Hidden form fields with default values (tokens, user IDs)
   - Meta tags with internal information
   - `<script>` tags with inline configuration

2. **Analyze JavaScript bundles for exposed secrets:**
   - API keys, tokens, or secrets embedded in JS files
   - Internal API endpoints not linked from the UI
   - Configuration objects with sensitive defaults
   - `window.__NEXT_DATA__`, `window.__NUXT__`, or similar SSR payloads containing all page data
   - Source maps that reveal original source code

3. **Check for exposed files and directories:**
   - `.env`, `.env.local`, `.env.production` — environment variables
   - `package.json`, `composer.json` — dependency lists
   - `.git/`, `.svn/` — version control metadata
   - `backup/`, `old/`, `temp/` — backup directories
   - `robots.txt`, `sitemap.xml` — disallowed paths often contain admin panels

4. **Technology fingerprinting:**
   - Call **frameworkFingerprint** to identify the web framework and version
   - Check cookie names for framework signatures (PHPSESSID, JSESSIONID, _rails_session, etc.)
   - Look at error pages for stack traces or version information

### Phase 4: GraphQL Reconnaissance (if applicable)
1. Check if GraphQL introspection is enabled: query `{ __schema { types { name fields { name } } } }`
2. Map all queries, mutations, and subscriptions
3. Identify GraphQL-specific vulnerabilities: batching, depth attacks, field suggestions

### Phase 5: Record and Report
1. Call **recordEvidence** for every significant discovery
2. Call **writeFinding** for information disclosure findings (exposed keys, debug endpoints, etc.)
3. Summarize the complete attack surface: endpoints found, technologies identified, auth mechanisms, exposed data

## What to Discover
- All pages, routes, and API endpoints (including undocumented ones)
- Forms and their fields (with input types and validation)
- Authentication mechanisms (login forms, OAuth, JWT)
- Technology stack and versions
- GraphQL endpoints and introspection availability
- JWT tokens in responses
- Comments and metadata in HTML
- **JavaScript files with embedded secrets or internal endpoints**
- **Exposed configuration files (.env, package.json)**
- **HTML source code comments with sensitive data**

## Key Concepts
- **Attack Surface Mapping**: Every discovered endpoint, parameter, and service is a potential testing vector
- **Passive Before Active**: Start with zero-touch methods to avoid detection
- **Depth Over Speed**: A thorough recon of fewer targets beats a shallow scan of many
- **Context Matters**: A staging server in DNS records may have weaker protections than production
- **Iterative Process**: Recon is not a one-shot phase — revisit as new findings reveal additional surface

## Anti-Hallucination
Your claims will be verified against real tool output. Never fabricate findings.
Every discovery you report MUST have a corresponding tool call response that proves it.
If a tool call fails, say so honestly — do not invent a success.

## Trigger Conditions

Activate at the start of any assessment (or whenever new surface appears) to map the attack surface before vulnerability testing. Trigger on requests to "find endpoints", "map the attack surface", fingerprint tech, or discover API/GraphQL/docs endpoints. Especially valuable before active exploitation skills run. Do not trigger for active exploitation itself (use the relevant injection/auth/API skill) — recon is discovery, not proof-of-exploit.

## Detection Approach

Work passive-before-active to avoid premature detection. Phase 1: passive — tech stack from headers/errors/cookies, JS library versions, public repos, CT logs, DNS. Phase 2: endpoint discovery — capture the page, extract links/forms/API endpoints, probe common paths (`/api`, `/graphql`, `/admin`, `/.env`, `/robots.txt`, `/swagger`). Phase 3: deep page analysis (the highest-value step) — read HTML source for comments/hidden fields/inline config, analyze JS bundles for embedded secrets and internal endpoints and source maps, probe exposed files, and fingerprint the framework. Phase 4: GraphQL recon if applicable (introspection). Phase 5: record everything to the graph and write findings for disclosures. Revisit recon iteratively as new findings reveal more surface.

## Pitfalls

- Skipping deep page/JS-bundle analysis — that's where most real findings hide.
- Shallow-scanning many targets instead of deeply mapping few.
- Treating the file extension as authoritative — verify magic bytes / actual responses.
- Only testing the landing page and missing admin/docs/staging endpoints.
- Not recording negative results (paths confirmed absent).
- Jumping to exploitation before the surface is fully mapped.

## Verification & Impact

CONFIRMED when a discovered item is backed by a real captured response — an endpoint that responds, a secret found in a JS bundle, a disclosed config file, or an introspectable GraphQL schema. SUSPECTED when a path is guessed but unverified — record as candidate. Document impact by what the discovery enables (attack surface for later skills, exposed credentials = high). Capture each discovery with `recordEvidence` and summarize the full surface via `writeFinding`/graph updates.
