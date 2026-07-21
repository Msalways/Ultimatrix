---
name: subdomain-takeover
description: "Subdomain takeover discovery and exploitation via dangling CNAME records and cloud service misconfigurations"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, followRedirects, updateGraph, writeFinding, recordEvidence, getCapturedHeaders, subfinder, nuclei]
triggers: ["subdomain takeover", "dangling cname", "subdomain hijack", "cname takeover", "cloud takeover", "expired domain", "abandoned subdomain", "subdomain enumeration", "dns takeover", "virtual host takeover"]
contextBoosts: [endpoints]
mitreAttack: ["T1584", "T1583"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# Subdomain Takeover

## When to Use

Use this skill when you encounter:
- Subdomains pointing to external cloud services (S3, Azure, Heroku, GitHub Pages, Fastly, Netlify)
- CNAME records resolving to expired or deprovisioned domains
- HTTP responses containing service-specific "not found" pages on subdomains
- DNS enumeration results showing third-party hosting references
- Target with large attack surface and many subdomains (enterprise, SaaS)

## Do Not Use

- Target has no subdomains or minimal DNS footprint
- All CNAME records resolve to the target's own infrastructure
- CNAME targets are active and serving legitimate content
- Legal scope explicitly prohibits subdomain enumeration or DNS attacks

## Auth Context

Subdomain takeover is typically passive recon — no authentication required. DNS queries and HTTP probing are unauthenticated by nature. However:
- If the target's DNS provider requires credentials, you need access to verify records
- Some cloud takeover proofs (S3 bucket creation, Azure validation) require valid cloud accounts
- Stay within authorized scope — subdomain takeover can affect third-party services

---

## Subdomain Enumeration

### Automated DNS Brute-Force


### Certificate Transparency Logs


### DNS Brute-Force (Active)


### Aggregation Strategy

1. Run passive enumeration (amass + subfinder + crt.sh)
2. Deduplicate results into a single list
3. Probe each subdomain for live HTTP responses
4. Extract CNAME records for all live subdomains
5. Flag any CNAME pointing to external services

---

## DNS Analysis

### CNAME Record Lookup


### Dangling CNAME Detection Logic

A CNAME is dangling when:
1. `subdomain.target.com` → CNAME → `service.azurewebsites.net`
2. `service.azurewebsites.net` itself resolves (or NXDOMAIN)
3. The target has **no active resource** at the CNAME endpoint
4. The claimed service (Azure, S3, etc.) can be re-provisioned by anyone

### Key Indicators

| Signal | Meaning |
|--------|---------|
| CNAME → external service | Potential takeover candidate |
| CNAME → NXDOMAIN on CNAME target | Dangling — high confidence |
| CNAME → active but 404/error page | Verify service ownership |
| CNAME → expired domain | Domain can be re-registered |

---

## Cloud Service Takeover

### AWS S3 Bucket

**Fingerprint:** `NoSuchBucket`, `The specified bucket does not exist`, `404: Not Found`


**Response to look for:**

**Exploitation:**

### Azure Web Apps

**Fingerprint:** `Azure Web App - Your web app is running and waiting for your content`


**Response to look for:**

**Exploitation:**
- Create Azure account → create Web App with the exact hostname
- Deploy content to prove control

### GitHub Pages

**Fingerprint:** `There isn't a GitHub Pages site here.`, `For root URLs`


**Response to look for:**

**Exploitation:**
- Fork or create a repository named `username.github.io`
- Add a CNAME file pointing to the subdomain
- Push content to prove control

### Heroku

**Fingerprint:** `no such app`, `no-hierarchical-name`


**Response to look for:**

**Exploitation:**
- Create Heroku app with the exact subdomain name
- Deploy proof content

### Fastly

**Fingerprint:** `Fastly error: unknown domain subdomain.target.com`


**Response to look for:**

**Exploitation:**
- Create Fastly account → add custom domain matching the subdomain
- Upload proof content

### Netlify

**Fingerprint:** `Not Found - Request ID:`


**Response to look for:**

**Exploitation:**
- Create Netlify site with the exact subdomain name
- Deploy content to prove control

### Cloudfront

**Fingerprint:** `Bad request.`, `ERROR: The request could not be satisfied`


**Exploitation:**
- Create CloudFront distribution with the exact domain
- Upload proof content

---

## Service Fingerprints

Always verify the actual response before claiming takeover. Common patterns:

| Service | Fingerprint | Confidence |
|---------|------------|------------|
| GitHub Pages | `There isn't a GitHub Pages site here` | HIGH |
| AWS S3 | `NoSuchBucket` / `The specified bucket does not exist` | HIGH |
| Azure | `Your web app is running and waiting for your content` | HIGH |
| Heroku | `No such app` | HIGH |
| Fastly | `unknown domain subdomain.target.com` | HIGH |
| Netlify | `Not Found - Request ID` | MEDIUM |
| Cloudfront | `Bad request.` / `ERROR: The request could not be satisfied` | MEDIUM |
| Shopify | `Sorry, this shop is currently unavailable.` | MEDIUM |
| Tumblr | `Whatever you were looking for doesn't currently exist at this address` | LOW |
| WordPress.com | `Do you want to register` | LOW |

**Verification steps before exploitation:**
1. Confirm CNAME points to the claimed service (dig)
2. Confirm HTTP response matches the service fingerprint
3. Confirm the service allows public registration of the hostname
4. Confirm no existing content is served (not just an error page)

---

## Exploitation Steps

### Step 1: Confirm Dangling CNAME


### Step 2: Verify Service Takeover Feasibility


### Step 3: Claim the Service

- **S3:** `aws s3 mb s3://bucket-name`
- **Azure:** Create Web App with matching hostname
- **GitHub Pages:** Create repo, add CNAME file
- **Heroku:** `heroku create subdomain-target-com`
- **Fastly:** Add custom domain in dashboard
- **Netlify:** Create site with matching name

### Step 4: Upload Proof Content

Create a proof page:

### Step 5: Document & Report

- Screenshot of the proof page loading at the subdomain URL
- DNS records before and after takeover
- CNAME chain evidence
- Impact assessment

---

## Detection Tools

### Automated Scanning


### Nuclei Templates (Recommended)


### Manual Verification


---

## Impact Assessment

### Direct Impact

| Impact | Description |
|--------|-------------|
| **Cookie Theft** | If subdomain shares parent domain cookies (non-HttpOnly, Domain=.target.com) |
| **Phishing** | Serve convincing login page at legitimate subdomain |
| **Credential Harvesting** | Fake SSO/OAuth endpoint captures tokens |
| **XSS via Subdomain** | Inject scripts that execute in target.com context |
| **CSP Bypass** | Subdomain may be whitelisted in Content-Security-Policy |

### Cookie Impact Analysis


### Escalation Paths

1. **Subdomain takeover → cookie theft → session hijack** (if cookies are scoped broadly)
2. **Subdomain takeover → phishing → credential theft** (users trust *.target.com)
3. **Subdomain takeover → XSS → CSP bypass → data exfiltration** (if subdomain is CSP-whitelisted)
4. **Subdomain takeover → OAuth abuse** (if subdomain is registered as OAuth redirect URI)

---

## Anti-Hallucination

### Verification Checklist

Before reporting a subdomain takeover, **every** claim must be verified with real tool output:

- [ ] **CNAME record verified:** `dig +short CNAME subdomain.target.com` shows external service
- [ ] **Service fingerprint confirmed:** HTTP response matches known takeover pattern
- [ ] **Claimability verified:** Service actually allows public re-registration of hostname
- [ ] **No existing content:** Target subdomain is not serving legitimate content
- [ ] **DNS propagation confirmed:** CNAME is consistent across multiple DNS servers

### Do NOT Claim

- Do NOT claim takeover if CNAME points to active infrastructure owned by the target
- Do NOT assume a service is vulnerable without checking the actual HTTP response
- Do NOT report a finding based on DNS records alone — HTTP verification is required
- Do NOT claim impact (cookie theft, phishing) without verifying cookie scope and CSP policies
- Do NOT fabricate tool output or response bodies — use `recordEvidence` to store real output

### Evidence Requirements

Every subdomain takeover finding requires:
1. DNS dig output showing the CNAME chain
2. HTTP response body showing the service fingerprint
3. Screenshot or proof of the claimed service endpoint
4. Description of how the service was claimed (if exploited)

## Trigger Conditions

Activate during subdomain enumeration when a subdomain's CNAME points to an external cloud/service (S3, Azure, GitHub Pages, Heroku, Fastly, Netlify, CloudFront) or to an expired/dangling target. Trigger on HTTP "not found"/service-specific error pages at subdomains, or DNS results referencing third-party hosting. Strong signal: a large subdomain footprint (enterprise/SaaS). Do not trigger when all CNAMEs resolve to the target's own infra, targets are active/serving legit content, or scope prohibits DNS enumeration.

## Detection Approach

Enumerate subdomains (passive CT logs + active brute), then for each live subdomain extract the CNAME chain and classify: CNAME→external service, CNAME→NXDOMAIN on the target, or active-but-error page. A dangling CNAME exists when the subdomain points to a service the target no longer has an active resource at. Verify the service fingerprint from the actual HTTP response (`NoSuchBucket`, `no such app`, GitHub Pages "isn't a site here", etc.). Confirm the service permits public re-registration of that exact hostname and that no legitimate content is served. Only after CNAME + fingerprint + claimability are confirmed should you attempt to claim it (requires valid cloud accounts, in scope). Route confirmed takeovers to impact analysis (cookie theft if broad Domain cookie, phishing/OAuth pivot).

## Pitfalls

- Claiming takeover from a DNS record alone — HTTP verification of the fingerprint is required.
- Assuming a service is claimable without confirming it allows public re-registration of the hostname.
- Reporting a CNAME to active, target-owned infrastructure as dangling.
- Trusting an error page that is actually the real service's generic 404 (still owned).
- Ignoring DNS propagation consistency across resolvers.
- Claiming impact (cookie theft) without verifying cookie scope/CSP.

## Verification & Impact

CONFIRMED when evidence shows: the CNAME chain to the external service, the matching service fingerprint response, and (if exploited) a claimed endpoint serving proof content at the subdomain. SUSPECTED when a dangling CNAME/fingerprint is observed but claimability isn't verified — record as candidate. Document impact by pivot potential: cookie theft/session hijack (broad Domain cookies), phishing/credential harvest, XSS-in-context/CSP bypass (if subdomain whitelisted), or OAuth redirect abuse. Capture dig output, HTTP fingerprint, and proof via `recordEvidence`.
