---
name: subdomain-takeover
description: "Subdomain takeover discovery and exploitation via dangling CNAME records and cloud service misconfigurations"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, followRedirects, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
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
# amass — passive enumeration from multiple sources
amass enum -passive -d target.com -o amass_passive.txt

# subfinder — fast passive subdomain discovery
subfinder -d target.com -silent -o subfinder.txt

# assetfinder — quick passive enumeration
assetfinder --subs-only target.com > assetfinder.txt
```

### Certificate Transparency Logs

```bash
# crt.sh — free CT log search
curl -s "https://crt.sh/?q=%25.target.com&output=json" | jq -r '.[].name_value' | sort -u

# Use webfetch to pull crt.sh data
GET https://crt.sh/?q=%25.target.com&output=json
```

### DNS Brute-Force (Active)

```bash
# dnsx — fast DNS brute-force
dnsx -d target.com -w wordlist.txt -silent

# gobuster — DNS mode brute-force
gobuster dns -d target.com -w wordlist.txt -t 50
```

### Aggregation Strategy

1. Run passive enumeration (amass + subfinder + crt.sh)
2. Deduplicate results into a single list
3. Probe each subdomain for live HTTP responses
4. Extract CNAME records for all live subdomains
5. Flag any CNAME pointing to external services

---

## DNS Analysis

### CNAME Record Lookup

```bash
# dig CNAME records
dig +short CNAME subdomain.target.com

# Check for dangling CNAME (resolves to NXDOMAIN on target side)
dig subdomain.target.com

# Check if CNAME target is dead
dig +short CNAME cname-target.com
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

```http
GET / HTTP/1.1
Host: subdomain.target.com
```

**Response to look for:**
```xml
<Error>
  <Code>NoSuchBucket</Code>
  <Message>The specified bucket does not exist</Message>
</Error>
```

**Exploitation:**
```bash
aws s3 mb s3://claimed-bucket-name --region us-east-1
# Upload proof content to the bucket
echo "Proof of concept" > index.html
aws s3 cp index.html s3://claimed-bucket-name/index.html
```

### Azure Web Apps

**Fingerprint:** `Azure Web App - Your web app is running and waiting for your content`

```http
GET / HTTP/1.1
Host: subdomain.target.com
```

**Response to look for:**
```html
<h1 style="font-family: 'Segoe UI', sans-serif;">Azure Web App - Your web app is running and waiting for your content.</h1>
```

**Exploitation:**
- Create Azure account → create Web App with the exact hostname
- Deploy content to prove control

### GitHub Pages

**Fingerprint:** `There isn't a GitHub Pages site here.`, `For root URLs`

```http
GET / HTTP/1.1
Host: subdomain.target.com
```

**Response to look for:**
```html
<h1>There isn't a GitHub Pages site here.</h1>
```

**Exploitation:**
- Fork or create a repository named `username.github.io`
- Add a CNAME file pointing to the subdomain
- Push content to prove control

### Heroku

**Fingerprint:** `no such app`, `no-hierarchical-name`

```http
GET / HTTP/1.1
Host: subdomain.target.com
```

**Response to look for:**
```html
<h1>No such app</h1>
<p>There is no app configured at that hostname.</p>
```

**Exploitation:**
- Create Heroku app with the exact subdomain name
- Deploy proof content

### Fastly

**Fingerprint:** `Fastly error: unknown domain subdomain.target.com`

```http
GET / HTTP/1.1
Host: subdomain.target.com
```

**Response to look for:**
```
Fastly error: unknown domain subdomain.target.com
```

**Exploitation:**
- Create Fastly account → add custom domain matching the subdomain
- Upload proof content

### Netlify

**Fingerprint:** `Not Found - Request ID:`

```http
GET / HTTP/1.1
Host: subdomain.target.com
```

**Response to look for:**
```html
<h1>Not Found</h1>
<p>Request ID: <some-id></p>
```

**Exploitation:**
- Create Netlify site with the exact subdomain name
- Deploy content to prove control

### Cloudfront

**Fingerprint:** `Bad request.`, `ERROR: The request could not be satisfied`

```http
GET / HTTP/1.1
Host: subdomain.target.com
```

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
# Verify the CNAME exists and points to external service
dig CNAME subdomain.target.com

# Verify CNAME target is not owned by the target
whois cname-target.com
```

### Step 2: Verify Service Takeover Feasibility

```bash
# HTTP probe to confirm fingerprint
httpx -u subdomain.target.com -mc 200,301,302,404 -title -tech-detect

# Or manual curl
curl -sI https://subdomain.target.com
```

### Step 3: Claim the Service

- **S3:** `aws s3 mb s3://bucket-name`
- **Azure:** Create Web App with matching hostname
- **GitHub Pages:** Create repo, add CNAME file
- **Heroku:** `heroku create subdomain-target-com`
- **Fastly:** Add custom domain in dashboard
- **Netlify:** Create site with matching name

### Step 4: Upload Proof Content

Create a proof page:
```html
<html>
<head><title>Subdomain Takeover Proof</title></head>
<body>
<h1>Subdomain Takeover Proof of Concept</h1>
<p>Subdomain: subdomain.target.com</p>
<p>Attacker: your-identifier</p>
<p>Date: $(date)</p>
</body>
</html>
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
# subjack — fast subdomain takeover checker
subjack -w subdomains.txt -t 100 -timeout 30 -ssl -a fingerprints.json

# nuclei — template-based scanner
nuclei -l subdomains.txt -t subdomain-takeover/

# takeover — Go-based scanner
takeover -l subdomains.txt -all
```

### Nuclei Templates (Recommended)

```bash
# Run all subdomain takeover templates
nuclei -l subdomains.txt -t http/vulnerabilities/subdomain-takeover/

# Specific service checks
nuclei -l subdomains.txt -t http/vulnerabilities/subdomain-takeover/s3.yaml
nuclei -l subdomains.txt -t http/vulnerabilities/subdomain-takeover/azure.yaml
nuclei -l subdomains.txt -t http/vulnerabilities/subdomain-takeover/github-pages.yaml
```

### Manual Verification

```bash
# Check CNAME for all subdomains
for sub in $(cat subdomains.txt); do
  echo "=== $sub ==="
  dig +short CNAME $sub
  dig +short A $sub
done
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

```
If subdomain.target.com is taken over:
  - Cookies set with Domain=.target.com → accessible by attacker
  - Cookies set with Domain=subdomain.target.com → accessible by attacker
  - Cookies with HttpOnly flag → NOT accessible via JavaScript
  - Cookies with Secure flag → only sent over HTTPS
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
