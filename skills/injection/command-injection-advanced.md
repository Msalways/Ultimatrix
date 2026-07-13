---
name: command-injection-advanced
description: "Advanced command injection with filter bypass, encoding tricks, OOB exfiltration, and polyglot payloads"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, measureTiming, compareResponses, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["advanced command injection", "command injection bypass", "os command injection", "rce injection", "shell injection", "command filter bypass", "blind command injection", "out of band command", "polyglot injection", "code injection"]
contextBoosts: [sqli]
mitreAttack: ["T1059", "T1059.004", "T1190"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection", "OWASP OS Command Injection"]
---

# Advanced Command Injection

## When to Use

- Input is passed to a system shell, exec, system, popen, or similar OS-level execution functions
- Application performs file operations, network calls, or system tasks based on user-controlled parameters
- Blind injection points where output is not directly returned but side effects (timing, DNS, file writes) are observable
- WAF or input filters are in place and standard payloads are blocked
- Target environment runs PHP, Java, Python, Node.js, or any language that interfaces with the OS shell
- Time-based or out-of-band detection is the only viable confirmation method
- You need to bypass allowlists, blocklists, or regex-based input sanitization

## Do Not Use

- Input is handled purely by language-level interpreters (SQL, template engines, JSON parsers) without OS shell invocation
- Target is a static site or fully sandboxed container with no shell access
- Injection point only affects client-side JavaScript execution
- You have not confirmed the input reaches a command execution sink (avoid guessing)
- Destructive payloads against production systems without explicit authorization

## Auth Context

Before any injection test, call `getCapturedHeaders` to retrieve session tokens, CSRF tokens, and authentication headers. Command injection in authenticated contexts may produce different output or require valid session state to reach the execution sink. Replay captured cookies and authorization headers with every probe request. Authenticated injection points often have stricter filtering — document the auth requirement for each finding.

## Filter Bypass Techniques

### IFS Bypass

The Internal Field Separator (`$IFS`) acts as whitespace in bash when spaces are filtered:


Alternative IFS values:


### Hex Encoding

Bypass character filters using hex-encoded command strings:


### Octal Encoding


### Wildcards

Use glob wildcards to construct commands without using the actual characters:


### Brace Expansion

Bash brace expansion bypasses space and keyword filters:


Combined with IFS:


### Null Byte Injection

Null bytes may truncate strings in certain parsers while passing validation:


PHP-specific null byte handling:


## Blind Exfiltration Techniques

### DNS Exfiltration

When no output is returned, exfiltrate data via DNS queries:

**Linux:**

**Simplified DNS leak:**

**PHP-specific:**

### HTTP Exfiltration

Exfiltrate data via HTTP requests to an external server:

**Using curl:**

**Using Python:**

**Using Node.js:**

### File-Based Exfiltration

Write output to a file that can be retrieved through a web-accessible directory:


Combined with web server access:


## Time-Based Detection

When no output channel exists, use timing to confirm injection:

### Sleep-Based


### Conditional Timing

Only sleep if a condition is true:


### Timing-Based Data Extraction

Extract data bit by bit using timing:


### /dev/tcp Blind Channel

Bash `/dev/tcp` for blind data transfer:


Reverse shell via `/dev/tcp`:


## Encoding Techniques

### Hex Encoding


### Octal Encoding


### Unicode Encoding


### Base64 Encoding


### Subshell / Command Substitution


### Variable Expansion


### Arithmetic Expansion


## Alternative Delimiters

Different shells and execution contexts support various command separators:

| Delimiter | Example | Notes |
|-----------|---------|-------|
| Backticks | `` `id` `` | Universal in bash/sh |
| `$()` | `$(id)` | Modern shell substitution |
| `${}` | `${cmd}` | Variable expansion context |
| `\|` (pipe) | `ls \| id` | Output piped to next command |
| `\|\|` (OR) | `id \|\| true` | Execute if previous fails |
| `&&` (AND) | `id && whoami` | Execute if previous succeeds |
| `;` (semicolon) | `id; whoami` | Sequential execution |
| Newline | `id%0a whoami` | URL-encoded newline |
| `%0d%0a` | `id%0d%0awhoami` | CRLF injection |
| `{}` | `{id,whoami}` | Brace expansion |
| `<>` | `</etc/passwd` | Redirect (limited) |
| `&` | `id&` | Background execution |

### Newline Injection

URL-encoded newline to inject new commands:


### Pipe Chains


## OS-Specific Differences

### Linux

- Uses `/bin/sh`, `/bin/bash`, or `/bin/dash`
- File paths: `/etc/passwd`, `/etc/shadow`, `/tmp`
- Commands: `id`, `whoami`, `cat`, `ls`, `wget`, `curl`, `nc`
- Wildcards: `?`, `*`, `[a-z]`
- Null bytes: often ineffective (kernel rejects)
- Process substitution: `<()`, `>()`
- `/dev/tcp` available in bash

### Windows

- Uses `cmd.exe`, `powershell.exe`, or `pwsh`
- File paths: `C:\Windows\System32`, `C:\Users`, `C:\temp`
- Commands: `whoami`, `dir`, `type`, `powershell`, `certutil`
- Wildcards: `?`, `*`
- Null bytes: may truncate strings in some contexts
- Environment variables: `%PATH%`, `%TEMP%`
- Pipe and redirect: same as Linux but with `findstr` instead of `grep`

**Windows-specific bypasses:**

### PowerShell Encoding


## Polyglot Payloads

Payloads designed to execute across multiple injection contexts:

### Multi-Context Polyglot


Works with: semicolons, backticks, subshell, pipes, logical operators.

### SQL + Command Injection Polyglot


### XSS + Command Injection Polyglot


### Template + Command Injection Polyglot


### Universal Blind Polyglot


Detects which delimiter the target processes by timing each variant.

## Anti-Hallucination

### Verification Protocol

1. **Command execution claims require output evidence** — `id` must produce `uid=`, `gid=`, or `groups=` in the response body
2. **Blind injection claims require side-effect evidence** — timing data, DNS callback, file write, or HTTP exfil must be observed
3. **Filter bypass claims require comparison** — show the blocked payload fails AND the bypass payload succeeds on the same endpoint
4. **Encoding claims require decoded verification** — show the encoded payload and confirm the decoded command executed
5. **File read claims require file content** — partial or full file content must appear in the response
6. **OS-specific claims require OS identification** — confirm the target OS before claiming Linux vs Windows differences
7. **Time-based claims require measurement** — document exact timing; if `sleep 5` does not cause a 5+ second delay, the payload did not execute
8. **Polyglot claims require multi-context proof** — demonstrate the payload works in more than one injection context
9. **Do not infer shell type from URL structure** — `/api/run` does not guarantee bash; confirm with `echo $0` or similar
10. **Document every request-response pair** — include the exact payload, the exact response, and the timing data

### Evidence Recording

For every confirmed command injection finding, record via `writeFinding`:
- **Endpoint**: Full URL, parameter name, and HTTP method
- **Payload**: Exact string injected (raw, not encoded)
- **Shell**: Identified shell or execution context with evidence
- **Filter bypass**: Whether WAF/filter was present and how it was bypassed
- **Exfiltration method**: Direct output, blind timing, DNS, HTTP, or file-based
- **OS**: Confirmed target operating system
- **Impact**: RCE, file read, file write, reverse shell, or data exfiltration
- **Request/Response**: Full HTTP exchange via `recordEvidence`
- **Timing**: If time-based, include request start, end, and delta

## Trigger Conditions

Activate when user input reaches an OS command execution sink — `system`/`exec`/`popen`/`shell_exec`/`Runtime.exec`/`ProcessBuilder`/`subprocess`/`child_process` — or when the app performs file/network/system tasks parameterized by user data (filename processing, ping/traceroute-style tools, PDF/image conversion, archive extraction). Trigger on blind endpoints where output is suppressed but timing, DNS, or file-write side effects are observable, and on WAF/allowlist/regex-filtered inputs needing bypass. Do not trigger on SQL/template/JSON-parser sinks (those are separate skills) or pure client-side JS execution.

## Detection Approach

First decide if the input reaches a shell or direct exec: send a benign delimiter (`;`, `&&`, `|`, newline) with a harmless command and compare output/status to a baseline. If output returns, classify the shell (Linux vs Windows by available commands) and the separators it honors. For blind sinks, pivot to out-of-band and timing: a DNS/HTTP callback carrying `whoami` output, or a measured `sleep` delay, proves execution even without visible output. When filters block keywords or characters (spaces, slashes, letters), escalate through bypass families in order of subtlety: IFS/whitespace substitution, then encoding (hex/octal/base64/`printf`), then wildcards and brace expansion, then variable/arithmetic concatenation, then polyglots that span multiple delimiters. Always prove a bypass by showing the original payload fails while the transformed one succeeds on the *same* endpoint. Reserve reverse-shell/file-write exfil only for confirmed execution with explicit scope.

## Pitfalls

- Claiming execution from a generic error or 500 — an error is not output; require `uid=`/`whoami` evidence or a callback.
- Single timing sample treated as blind confirmation — network jitter mimics sleep; repeat and compare true vs false conditions.
- Assuming bash on Windows and vice versa — separator and command semantics differ; confirm OS first.
- Overclaiming filter bypass from one success without showing the blocked variant fail on the same endpoint.
- Treating reflected input as RCE — the literal payload string appearing in a page is not command output.
- Null-byte tricks that fail on modern kernels (Linux rejects them); don't rely on them.
- Reverse shells/file writes without scope authorization — keep PoCs read-only/safe.

## Verification & Impact

CONFIRMED when the response shows actual command output (`uid=`, `whoami` value, or file contents) or an observed OAST callback/measured timing delta proves execution. SUSPECTED when only a status shift or single timing blip occurs with no second confirmation — record as candidate. Document impact by capability proven: arbitrary command execution (RCE), file read/write, data exfiltration (DNS/HTTP/file-based), or reverse-shell access; name the OS, shell, and filter bypass used. Capture full request/response and timing via `recordEvidence`.
