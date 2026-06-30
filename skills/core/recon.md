---
name: recon
description: "Reconnaissance and attack surface mapping through passive and active intelligence gathering"
category: core
toolRefs: [httpRequest, runRecon, frameworkFingerprint, findEndpointsInResponse, queryGraph, updateGraph, evaluateRendered, followRedirects, recordEvidence, writeFinding, getCapturedHeaders]
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
