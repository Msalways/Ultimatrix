---
name: ctf-web
description: "CTF web challenge patterns: source review, input manipulation, and exploitation chain building"
category: specialized
toolRefs: [httpRequest, parseResponse, evaluateRendered, encodeDecode, updateGraph, writeFinding]
---

# CTF Web Challenges

## Description
CTF web challenges test creative problem-solving with intentionally vulnerable applications. This skill teaches common CTF patterns: source code review, database exploitation, file inclusion, authentication bypass, and how to think like a CTF player.

## Methodology
1. **Read the Challenge Carefully** — CTF challenges have hints in their names, descriptions, and page titles. Read everything before touching the application.
2. **Inspect the Source** — Check HTML comments, JavaScript source, robots.txt, sitemap.xml, .well-known paths. CTF creators hide flags in plain sight.
3. **Test Input Manipulation** — Modify parameters, cookies, headers, and hidden fields. CTF challenges often respond to unexpected input formats.
4. **Trace Application Logic** — Follow the code flow. How does the application decide what to do with your input? Where does validation happen?
5. **Identify the Intended Vulnerability** — Most CTF challenges teach one specific vulnerability class. Recognize the pattern: SQL injection for auth bypass, SSRF for internal access, deserialization for code execution.
6. **Chain Small Findings** — CTF challenges often require combining multiple small issues: information disclosure → credential found → authenticated access → flag.

## Key Concepts
- **Source Code Review**: In CTFs, you often have partial or full source access. Read it carefully — the vulnerability is documented in the code.
- **Unusual Input Vectors**: CTFs love headers, cookies, hidden fields, and multi-step processes. Test everything.
- **Integer Overflow and Type Juggling**: PHP loose comparison, JavaScript type coercion, and integer overflow are common CTF themes.
- **Serialization Attacks**: If the application serializes/deserializes objects, test for object injection and property overwrite.
- **Flag Formats**: Look for FLAG{...}, CTF{...}, or similar patterns. Sometimes encoded or split across multiple responses.

## Evidence to Collect
- Application source code analysis showing the vulnerability
- Step-by-step exploitation chain with request/response pairs
- Location and content of the flag
- Explanation of the vulnerability class and why it works

## Common Pitfalls
- Overthinking simple challenges — start with basic tests (dirbusting, parameter fuzzing)
- Not reading the source code thoroughly before testing
- Forgetting to check response headers and hidden HTML
- Getting tunnel vision on one approach when the challenge requires a different angle
- Not validating the flag format before submission

## References
- OWASP WebGoat, DVWA, Juice Shop (practice targets)
- CTFtime.org (challenge archives)
- HackTheBox, TryHackMe web challenges
