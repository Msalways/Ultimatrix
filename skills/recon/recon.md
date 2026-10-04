---
name: recon
description: "Reconnaissance and attack surface mapping through passive and active intelligence gathering"
category: core
tier: fast
toolRefs: [httpRequest, runRecon, frameworkFingerprint, findEndpointsInResponse, queryGraph, updateGraph, evaluateRendered, followRedirects, recordEvidence, writeFinding, getCapturedHeaders, nuclei, subfinder, nmap, webSearch]
triggers: ["find all endpoints", "map the attack surface", "reconnaissance", "discovery", "enumerate", "fingerprint technology", "find api endpoints", "passive scanning", "attack surface mapping", "endpoint discovery"]
mitreAttack: ["T1595", "T1592"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
strategy:
  relevanceSignals: ["admin", "internal", "debug", "manage", "secret", "config", "console", "backdoor", "private", "test"]
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

```bash
# WHOIS — registrar, nameservers, expiry, abuse contact
whois target.com | grep -Ei 'registrar|name server|expiry|creation'

# DNS baseline records
dig +short A target.com; dig +short MX target.com; dig +short NS target.com; dig +short TXT target.com

# Reverse DNS on adjacent IPs (find sibling infrastructure)
for ip in $(seq 10 30); do host 203.0.113.$ip | grep -v "not found" ; done

# DNS zone enumeration with dnsrecon (attempts AXFR first)
dnsrecon -d target.com -t std,axfr

# Passive subdomain discovery from CT logs and passive sources
curl -s "https://crt.sh/?q=%25.target.com&output=json" | jq -r '.[].name_value' | sort -u
subfinder -d target.com -silent > subs_passive.txt
assetfinder --subs-only target.com >> subs_passive.txt

# Aggregate with amass in passive mode (no packets sent to the target)
amass enum -passive -d target.com -o amass_passive.txt

# Merge all sources into one deduplicated list
cat subs_passive.txt amass_passive.txt amass_passive.txt 2>/dev/null | sed 's/^\*\.//' | sort -u > all_subs.txt
```

### Phase 2: Endpoint Discovery
1. Navigate to the target URL and capture the full page snapshot
2. Extract all links, forms, and API endpoints from the page source
3. Use **stagehand_extract** to get structured data from complex pages (forms, links, data attributes)
4. Follow only links, forms, API calls, and resource URLs present in captured traffic or delivered client code. Do not guess documentation paths, version prefixes, or common directories.
5. If the target links to API documentation, fetch that exact linked URL and extract its operations; otherwise leave API documentation undiscovered.
6. Record each observed endpoint and its source evidence to the graph with **updateGraph**

```bash
# Probe which discovered subdomains are alive and capture titles/status
cat subs_passive.txt | sort -u | httpx -title -tech-detect -status-code -o live_subs.txt

# Content discovery against the live host
gobuster dir -u https://target.com -w /usr/share/seclists/Discovery/Web-Content/common.txt -t 20 -x php,asp,aspx,jsp,html,bak,json

# Fetch robots.txt, sitemap.xml, or security.txt only when linked by the page,
# declared by captured client code, or explicitly requested by the operator.
```

```bash
# Nuclei baseline sweep — information disclosure templates only at recon stage
nuclei -l live_subs.txt -t exposures/configs/ -t exposures/tokens/ -t technologies/ -severity info,low,medium -silent
```

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

```bash
# Pull the page and all its linked JS for offline analysis
curl -sk https://target.com/ > index.html
grep -oE 'src="[^"]+\.js[^"]*"' index.html | sed 's/src="//;s/"$//' | sort -u > js_files.txt

# Grep JS bundles for secrets and internal endpoints
while read js; do
  url=$(echo "$js" | grep '^http' || echo "https://target.com$js")
  curl -sk "$url" >> all_js.txt
done < js_files.txt

grep -oEi '(api[_-]?key|apikey|secret|token|password)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9_\-]{16,}' all_js.txt
grep -oE '"/(api|internal|v[0-9])/[a-zA-Z0-9/_\-]+' all_js.txt | sort -u   # hidden API routes

# Source maps — original source code exposure
grep -oE '[a-zA-Z0-9_\-./]+\.js\.map' all_js.txt | sort -u
# If found, download and unpack:
curl -sk https://target.com/app.js.map -o app.map
npx source-map-explorer app.js.map --json 2>/dev/null | head -50

# SSR data payloads often contain full user objects / internal config
grep -o 'window.__NEXT_DATA__[^<]*' index.html | head -c 2000

# Check exposed dotfiles / VCS directories
for p in .env .env.local .env.production .git/config .svn/entries composer.json package.json; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" "https://target.com/$p")
  echo "[${code}] /$p"
done

# robots.txt disallowed paths = admin/staging hints
curl -sk https://target.com/robots.txt
```

4. **Technology fingerprinting:**
   - Call **frameworkFingerprint** to identify the web framework and version
   - Check cookie names for framework signatures (PHPSESSID, JSESSIONID, _rails_session, etc.)
   - Look at error pages for stack traces or version information

```bash
# Header-based fingerprinting
curl -sIk https://target.com | grep -Ei 'server|x-powered|x-aspnet|x-generator|set-cookie'

# Wappalyzer-style CLI fingerprinting
webanalyze -host https://target.com -output json

# Force a 404 to inspect the error-page stack signature
curl -sk https://target.com/nonexistent-page-8f3c1 | grep -Ei 'stack|trace|version|exception|django|flask|laravel'
```

### Phase 4: GraphQL Reconnaissance (if applicable)
1. Check if GraphQL introspection is enabled: query `{ __schema { types { name fields { name } } } }`
2. Map all queries, mutations, and subscriptions
3. Identify GraphQL-specific vulnerabilities: batching, depth attacks, field suggestions

```bash
# Introspection probe on common endpoints
for ep in graphql graphiql api/graphql v1/graphql gql; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" "https://target.com/$ep")
  echo "[${code}] /$ep"
done

# Full introspection query
curl -sk https://target.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query IntrospectionQuery { __schema { queryType { name } mutationType { name } types { name kind fields { name type { name kind ofType { name } } } } } }"}' | jq .

# Field suggestion oracle — invalid field returns "Did you mean ..." even when introspection is disabled
curl -sk https://target.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ user { id emailx } }"}'
```

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

```bash
# HTML comments / metadata sweep
grep -oE '<!--[^>]+-->' index.html | grep -Ei 'todo|fixme|pass|key|internal|admin|dev|debug'
grep -oE '<meta[^>]+(generator|author)[^>]*>' index.html

# Extract all links/forms/API paths from the captured page
grep -oE 'href="[^"]+"' index.html | sed 's/href="//;s/"$//' | sort -u > links.txt
grep -oE '<form[^>]+action="[^"]*"' index.html
grep -oE '"(/api/[a-zA-Z0-9/_\-?=&.]+)"' all_js.txt | sort -u

# Hidden form fields with default values (tokens, user IDs)
grep -B2 -A2 'type="hidden"' index.html
```

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

Work from target-provided evidence. Capture the page, extract links/forms/API calls, and inspect delivered client code and responses. Follow only observed or linked routes, or paths explicitly authorized by the operator; do not guess conventional docs paths, version prefixes, or directories. Analyze captured HTML/JS/API responses for disclosures and fingerprint the framework. If an observed GraphQL route exists, assess its schema under the engagement's authorization. Record each endpoint with its source evidence and revisit discovery when new target-provided surface appears.

## Pitfalls

- Skipping deep page/JS-bundle analysis — that's where most real findings hide.
- Shallow-scanning many targets instead of deeply mapping few.
- Treating the file extension as authoritative — verify magic bytes / actual responses.
- Only testing the landing page and missing admin/docs/staging endpoints.
- Not recording negative results (paths confirmed absent).
- Jumping to exploitation before the surface is fully mapped.

## Verification & Impact

CONFIRMED when a discovered item is backed by a real captured response — an endpoint that responds, a secret found in a JS bundle, a disclosed config file, or an introspectable GraphQL schema. SUSPECTED when a path is guessed but unverified — record as candidate. Document impact by what the discovery enables (attack surface for later skills, exposed credentials = high). Capture each discovery with `recordEvidence` and summarize the full surface via `writeFinding`/graph updates.

---

## Cheat Sheet — Recon Tools & Commands

### Shodan / Censys

```bash
# Shodan CLI
shodan search "org:Target ssl.cert.subject.CN:target.com"
shodan host 1.2.3.4

# Censys
censys search "services.tls.certificates.leaf_names: target.com"
```

### Certificate Transparency

```bash
# crt.sh
curl -s "https://crt.sh/?q=%.target.com&output=json" | jq -r '.[].name_value' | sort -u

# CT log monitoring
certspotter -d target.com
```

### WAF Fingerprinting

```bash
# Identify WAF vendor
wafw00f https://target.com

# Probe WAF rules
curl -sI "https://target.com/?id=1' AND 1=1--"
# Look for: 403, custom error pages, WAF headers (cf-ray, x-sucuri, x-akamai)
```

### Technology Stack

```bash
# whatweb
whatweb https://target.com

# wappalyzer (browser extension)
# HTTP header analysis
curl -sI https://target.com | grep -i "server\|x-powered-by\|x-aspnet"
```
