---
name: ssti
description: "Server-Side Template Injection exploitation across Jinja2, Twig, Freemarker, Velocity, Handlebars, and Go templates"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, encodeDecode, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["server side template injection", "ssti", "template injection", "template escape", "jinja2", "twig", "freemarker", "velocity", "handlebars template", "go template injection"]
contextBoosts: [sqli]
mitreAttack: ["T1059.007", "T1190"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection", "OWASP SSTI"]
toolChains:
  - name: ssti-detection
    description: "Detect Server-Side Template Injection across engines"
    steps: [httpRequest, parseResponse, measureTiming, compareResponses, recordEvidence]
  - name: ssti-exploitation
    description: "Exploit SSTI for remote code execution"
    steps: [httpRequest, parseResponse, recordEvidence, updateGraph, writeFinding]
compositionRules:
  requires: [vuln-discovery]
  enhances: [exploitation]
---

# Server-Side Template Injection (SSTI)

## When to Use

- Target reflects user input directly into a server-side template string
- Output contains template syntax artifacts (e.g., rendered variable names, error traces mentioning template engines)
- Parameter values influence page structure beyond simple variable substitution
- Error messages reference template engine internals (e.g., `UndefinedError`, `CompilationException`, `Error evaluating template`)
- Input flows into email templates, PDF generators, report builders, or document renderers
- Template partials or includes are constructed from user input

## Do Not Use

- Input only reflected in plain HTML attributes without server-side rendering context
- Client-side JavaScript template engines (Handlebars client-side, Mustache client-side, Angular expressions) — these are XSS, not SSTI
- CMS themes where template rendering is fully sandboxed with no escape hatch
- Static file generators where templates are compiled offline, not per-request

## Auth Context

Before any injection test, call `getCapturedHeaders` to retrieve session tokens, CSRF tokens, and authentication headers. SSTI payloads in authenticated contexts may produce different results or require valid session state to reach template rendering code paths. Replay captured cookies and authorization headers with every probe request.

## SSTI Detection

### Universal Detection Payloads

Test each expression syntax. If the template engine evaluates arithmetic, injection is confirmed.

| Syntax | Template Engines | Expected Output |
|--------|-----------------|-----------------|
| `{{7*7}}` | Jinja2, Nunjucks, Twig, Handlebars (server), Mako, Angular (server) | `49` |
| `${7*7}` | Freemarker, Velocity, Thymeleaf (expressions), EL (JSP) | `49` |
| `<%= 7*7 %>` | ERB (Ruby), EJS, Slim | `49` |
| `#{7*7}` | Ruby string interpolation, Thymeleaf (inline) | `49` |
| `#{7*7}` | Clojure (server-side), some .NET engines | `49` |
| `$((7*7))` | Bash/Zsh templates, Shell-based renderers | `49` |
| `{{= 7*7}}` | Marko, some Nunjucks configs | `49` |
| `<#-- ${7*7} -->` | Freemarker (comment context) | May still evaluate |
| `[[${7*7}]]` | Thymeleaf inline mode | `49` |
| `<?php echo 7*7; ?>` | PHP template engines (Twig, Blade partial) | `49` |

### Conditional Detection (Blind SSTI)

When no output is rendered, use time-based or out-of-band detection:

**Jinja2 time-based:**

**Freemarker time-based:**

**Velocity time-based:**

### Error-Based Detection

Inject syntax that triggers engine-specific errors to fingerprint:

- `{{invalid_syntax` — Jinja2 throws `TemplateSyntaxError`
- `${invalid` — Freemarker throws `ParsingException`
- `<%= invalid %>` — ERB throws `SyntaxError`

## Engine Identification

### From Output Patterns

| Observed Output | Likely Engine |
|----------------|---------------|
| `49` from `{{7*7}}` | Jinja2, Twig, Nunjucks, Handlebars (server) |
| `49` from `${7*7}` | Freemarker, Velocity, Thymeleaf |
| `49` from `<%= 7*7 %>` | ERB, EJS |
| Error mentioning `jinja2.exceptions` | Jinja2/Python |
| Error mentioning `freemarker.template` | Freemarker/Java |
| Error mentioning `org.apache.velocity` | Velocity/Java |
| Error mentioning `Twig\Error` | Twig/PHP |
| Error mentioning `Handlebars` | Handlebars/Node |
| Error mentioning `text/template` or `html/template` | Go templates |

### From Page Context

- Python/Django/Flask → likely Jinja2
- PHP/Laravel/Symfony → likely Twig or Blade
- Java/Spring Boot → likely Freemarker, Velocity, or Thymeleaf
- Node.js/Express → likely Handlebars, EJS, Nunjucks, or Pug
- Go/net/http → likely Go html/template or text/template

### Fingerprinting via Object Inspection

**Jinja2:**
Returns `Config` — confirms Jinja2.

**Twig:**
Returns Twig extension list — confirms Twig.

**Freemarker:**
Returns Freemarker version string.

## Jinja2 / Python

### RCE Chains

**Standard RCE (Flask/Jinja2):**

**Alternative RCE path:**

**Using cycler (Flask-specific):**

**Using joiner:**

**Using namespace:**

### File Read/Write

**Read /etc/passwd:**

**Read application source:**

### Sandbox Escape

**Jinja2 sandboxed environment bypass (CVE-2024-22195):**

**Attr filter bypass for sandbox:**

### Subclass Enumeration (Generic Python RCE)


Locate `os._wrap_close` or `subprocess.Popen` in the list and invoke:


Replace `X` with the index of the identified class.

## Twig / PHP

### RCE Chains

**Standard Twig RCE:**

**Alternative using _self parent:**

**Using apply filter:**

### File Operations

**Read file via Twig:**

### Sandbox Escape

**Twig sandbox escape via _self access:**

The `_self` variable references the current template, and its `env` property gives access to the Twig environment, bypassing sandbox restrictions if the sandbox policy allows `_self` access.

## Freemarker / Java

### RCE Chains

**Execute system command:**

**Alternative using ObjectConstructor:**

### File Operations

**Read file:**

**List directory:**

### Sandbox Bypass

If `Execute` and `ObjectConstructor` are blocked, try:


Or via Jython/other loaded libraries:


## Velocity / Java

### RCE Chains

**Standard Velocity RCE:**

**Alternative using tools:**

**Using context lookup:**

### File Operations

**Read file:**

### Sandbox Bypass

If `$class` is restricted, try:


Or via reflection:


## Handlebars / Node.js

### RCE Chains

**Prototype pollution RCE (Node.js < 4.2.0):**

**Simplified RCE (if require is accessible):**

### File Read


### Sandbox Bypass

Handlebars has no built-in sandbox. If `handlebars` is used with a custom `runtime` that restricts access, prototype pollution via `__proto__` or `constructor.prototype` can bypass restrictions by modifying the runtime environment.

## Go Templates

### RCE Chains

**Standard Go template RCE (custom FuncMap):**

**Using template method calls:**

### File Operations

**Read file (if file functions are exposed):**

### Sandbox Bypass

Go templates have no built-in sandbox, but the `text/template` and `html/template` packages restrict what methods can be called on objects. If `reflect` is available:


## Filter Bypass Techniques

### Encoding Bypass

When WAFs block keyword patterns, encode payloads:

**URL encoding:**

**Double URL encoding:**

**HTML entity encoding:**

**Unicode encoding (for Java engines):**

### String Concatenation

**Jinja2 string concat:**

**Freemarker string concat:**

**Velocity string concat:**

### Case Manipulation

**Mixed case (PHP/Twig):**

### Whitespace Bypass

Insert tabs or newlines within keywords:

**Jinja2:**

**Freemarker:**

### Null Byte Injection

Some template engines ignore null bytes:


### Alternative Class Chains

When primary chain is blocked, enumerate alternatives:

**Jinja2 subclass list:**

Count subclasses, then iterate:


**Freemarker class loading:**

### Template Engine Switching

If one engine's payloads are blocked, try injecting syntax for a different engine:

- Inject `${7*7}` when `{{7*7}}` is blocked (Freemarker/Velocity context)
- Inject `<%= 7*7 %>` when both are blocked (ERB context)
- Inject `#{7*7}` for Thymeleaf or Ruby contexts

### Dynamic Variable Construction

**Jinja2 with variable injection:**
URL parameter: `?a=__class__`

**Twig with variable injection:**
URL: `?a=registerUndefinedFilterCallback&b=exec`

### Polyglot Payloads

Test multiple engines simultaneously:


If output contains `49` in multiple formats, multiple engines may be processing the input.

## Anti-Hallucination

### Verification Protocol

1. **Never trust template engine detection from error messages alone** — confirm with actual evaluation of `{{7*7}}` or `${7*7}`
2. **RCE claims require proof** — `id` command output must contain `uid=`, `gid=`, or `groups=` in the response body
3. **File read claims require file content** — partial or full file content must appear in the rendered output
4. **Sandbox bypass claims require evidence** — successful command execution after bypass, not just absence of error
5. **Time-based claims require measurement** — if `sleep 5` causes a 5+ second delay, document the timing; if delay is absent, the payload did not execute
6. **Out-of-band claims require callback evidence** — DNS or HTTP callback must be observed on the OAST server
7. **Filter bypass claims require comparison** — show the blocked payload fails AND the bypass payload succeeds on the same endpoint
8. **Do not infer template engine from URL structure alone** — `/app.py` does not guarantee Jinja2; confirm with detection payload
9. **Document every request-response pair** — include the exact payload sent and the exact response received

### Evidence Recording

For every confirmed SSTI finding, record via `writeFinding`:
- **Endpoint**: Full URL and parameter name
- **Payload**: Exact string injected
- **Engine**: Identified template engine with evidence
- **Impact**: RCE, file read, file write, or information disclosure
- **Request/Response**: Full HTTP exchange via `recordEvidence`
- **Sanbox status**: Whether sandbox is active and whether bypass was achieved

## Trigger Conditions

Activate when user input is rendered or evaluated by a server-side template engine rather than simply stored or reflected. Signs: arithmetic payload `{{7*7}}` (or engine-appropriate syntax) returns `49`; error traces mention template internals (`UndefinedError`, `freemarker.template`, `Twig\Error`, `text/template`); parameters flow into email/PDF/report/document generators; or pages are built from user-driven template partials. Trigger on any reflected value that changes page structure, not just text. Do not trigger on purely client-side template engines (Handlebars/Mustache/Angular in the browser) — those are XSS, not SSTI.

## Detection Approach

First, fingerprint the engine: try each syntax variant (`{{7*7}}`, `${7*7}`, `<%= 7*7 %>`, `#{7*7}`, `[[${7*7}]]`) against a reflected parameter; the one that returns `49` names the engine. If nothing renders, switch to blind: time-based (a sleep/expansion inside the expression) and out-of-band (expression that triggers an external fetch) detection. Never infer the engine from URL extension or framework guesses — confirm with evaluation. Once the engine is known, escalate from detection to reading: start with arithmetic confirmation, then file read, then RCE class-chains (`os`/`subprocess` for Jinja2, `Execute`/`ObjectConstructor` for Freemarker/Velocity, environment access for Twig). When a direct chain is blocked, attempt sandbox escape specific to that engine, then fallback to filter bypass (encoding, string concat, case/whitespace, alternative class enumeration, polyglots). Stop and record if every evaluated payload returns the literal input unchanged — that indicates a non-rendering context.

## Pitfalls

- Inferring the engine from error messages or framework alone — a Flask app is usually Jinja2 but confirmation requires actual evaluation.
- Assuming arithmetic reflection equals RCE — file read or command execution still must be demonstrated.
- Blind SSTI without timing/OOB evidence: a delayed response must be *measured* (repeat >3 times) and compared to a baseline, or it is a network artifact.
- Overclaiming sandbox bypass from "no error" — bypass requires demonstrated execution after the restriction, not merely absence of an error.
- Mixing client-side template syntax into SSTI attempts; browser engines evaluate locally and never reach server RCE.
- One blocked payload ≠ patched — WAFs block keywords; switch to concat/encoding before concluding.

## Verification & Impact

CONFIRMED when the raw response shows evaluated output: `49` for detection, actual file content for read, or command output containing `uid=`/`groups=` for RCE. Blind cases are CONFIRMED only with measured timing deltas or an observed OAST callback; otherwise SUSPECTED. Document impact by capability proven — information disclosure (file read), RCE (command output), or sandbox-escape context — plus engine, endpoint, parameter, and exact payload. Always attach the full request/response exchange via `recordEvidence`.
