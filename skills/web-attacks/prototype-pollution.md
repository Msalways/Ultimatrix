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

## 2. Auth Context

### Prototype Pollution Authentication Requirements:
- **Unauthenticated endpoints**: Any API that accepts JSON and performs deep merge is exploitable without authentication
- **Authenticated endpoints**: If merge operations occur on authenticated data (user profiles, preferences, settings), authentication is required to reach the sink
- **Admin-only merge**: Some applications allow only admins to import/merge JSON (template imports, bulk updates) — authenticated exploitation only
- **Cookie-based state**: If merged objects come from cookies (e.g., shopping cart, user prefs), attacker can poison via cookie injection
- **SSO/OAuth flows**: Token payloads merged into session objects may be exploitable via JWT claims injection

### Auth-Aware Strategy:

## 3. Basic Prototype Pollution

### Core Concept:
In JavaScript, all objects inherit from `Object.prototype`. When a property is set on `Object.prototype`, it becomes available on every object in the runtime. Deep merge operations that recursively copy user-controlled properties can inadvertently write to `__proto__`, poisoning the prototype.

### Vulnerable Merge Patterns:

**`Object.assign` (shallow — not directly vulnerable):**
Note: `Object.assign` is safe against `__proto__` pollution because it only copies own properties. However, it IS vulnerable to pollution via `constructor.prototype` if the target object has a mutable constructor.

**`lodash.merge` / `lodash.defaultsDeep` (vulnerable):**

**`deepmerge` npm package (vulnerable in older versions):**

**Manual recursive merge (vulnerable):**

**Spread operator with nesting (NOT vulnerable):**

### The `__proto__` Key Mechanism:
When JavaScript parses `{"__proto__":{"isAdmin":true}}`, the `__proto__` key is treated specially in object literal syntax. However, when processed by `JSON.parse()`, it becomes a regular string key. Vulnerable merge functions that check `key === '__proto__'` or access `obj[key]` recursively can write to the actual prototype chain.

## 4. Detection

### Basic Detection Payload:

### Detection Methodology:

**Step 1: Inject and verify property existence:**

**Step 2: Verify via JavaScript evaluation:**

**Step 3: Confirm persistence:**

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


**Trigger chain:**
1. Pollute `Object.prototype.innerHTML` with XSS payload
2. Application renders a component that reads `.innerHTML` from a user-controlled object
3. DOM renders the XSS payload

**Verification:**

### XSS via Template Rendering:

**EJS template exploitation:**

EJS reads `options.settings.outputFunctionName` from the template context. If prototype-polluted, it injects code into the template function.

**Pug (Jade) exploitation:**

Pug reads `settings.doctype` from the context — pollution can alter template behavior.

**Handlebars exploitation:**

Handlebars uses prototype lookup — pollution can bypass sandbox restrictions.

### Open Redirect via URL Properties:


**Trigger chain:**
1. Pollute `Object.prototype.url` or `redirectUrl`
2. Application checks `req.query.url || defaults.url` — prototype provides poisoned value
3. Redirect fires: `response.redirect(target.url)` → attacker-controlled destination

**Alternative property names:**
- `url`, `redirectUrl`, `returnUrl`, `next`, `destination`, `location`, `href`, `target`
- Test each: many frameworks use specific property names for redirect logic

### CSS Injection via `style` Property:

If `element.style` or CSS object properties are populated from user-controlled objects, this can leak data.

## 6. Constructor Prototype Pollution

### `constructor.prototype` Vector:
When `__proto__` is filtered, use `constructor.prototype` as an alternative:


**How it works:**
1. Every object has a `constructor` property pointing to its constructor function
2. `constructor.prototype` is the same object as `__proto__`
3. Writing to `constructor.prototype.isAdmin` pollutes the prototype just like `__proto__`

### Filter Bypass with `constructor`:

### `constructor` in Merge Operations:

### Detection for Constructor Vector:

## 7. Node.js / Express

### `qs` Library Pollution:
The `qs` library (used by Express for query string parsing) has known prototype pollution vectors:


**Exploitation:**

**`qs` specific vectors:**

### Body Parser Exploitation:

**Common vulnerable patterns in Express:**

### Express-Specific Detection:
1. Send `{"__proto__":{"polluted":"test"}}` to POST endpoints accepting JSON
2. Check if new objects created by the server inherit the polluted property
3. Test query string pollution: `?__proto__[polluted]=test` on GET endpoints
4. Check for `qs` version — `qs` < 6.5.3, < 6.4.1, < 6.3.2 are vulnerable to prototype pollution
5. Test `body-parser` versions < 1.18.3 — known pollution vectors

### Server-Side Template Injection via Prototype Pollution:

## 8. Sandbox Escape

### VM2 Sandbox Escape:
VM2 isolates JavaScript execution but prototype pollution can escape:


**Escape chain:**
1. Pollute `Object.prototype` with a getter that executes in host context
2. Sandbox code accesses a property triggering the getter
3. Getter function runs outside the sandbox
4. Achieve RCE via `process.mainModule.require('child_process').execSync('cmd')`

### `Object.prototype.ISPrototypeOf` Override:

**Mechanism:**
1. Override `ISPrototypeOf` on the prototype
2. Code that checks `Object.prototype.ISPrototypeOf.call(a, b)` gets poisoned
3. Security checks relying on prototype chain inspection fail
4. Sandbox assumes object is legitimate → escapes sandbox restrictions

### `toString` Method Override:

**Mechanism:**
1. Override `Object.prototype.toString` with a function that executes code
2. Any string coercion in the sandbox triggers the function
3. `console.log(obj)` → `toString()` called → code executes in host context

### `valueOf` Method Override:

**Mechanism:**
1. Override `Object.prototype.valueOf`
2. Any numeric or string comparison triggers `valueOf`
3. Type coercion chains can bypass sandbox checks

### Symbol Pollution for Sandbox Escape:

### Escape Verification:

## 9. Client-Side Exploitation

### DOM Clobbering + Prototype Pollution:
Combine DOM clobbering with prototype pollution for enhanced exploitation:

**Step 1: Poison prototype with DOM sink properties:**

**Step 2: Trigger DOM clobbering that reads polluted properties:**

**Step 3: Application reads `element.innerHTML` from clobbered DOM + poisoned prototype:**

### localStorage Poisoning:

**Trigger chain:**
1. Pollute `Object.prototype.localStorage` with attacker-controlled data
2. Application checks `window.localStorage || defaults` — prototype provides poisoned value
3. Application trusts poisoned localStorage data for auth decisions

### Cookie Poisoning via Prototype:

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

**Double URL encoding:**

**Null byte injection:**

**Key name variations:**

### Nested Pollution Bypass:

### Array-Based Pollution:

### JSONP Callback Bypass:
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

### Common False Positives:
- Property exists as own property on specific object (not prototype pollution)
- Server reflects input without merge (stored XSS, not prototype pollution)
- Client-side only pollution (no server-side impact unless RCE achieved)
- Pollution in test environment but not production (different merge libraries)
- `Object.assign` result mistaken for prototype pollution (shallow copy, not deep merge)

## Trigger Conditions

Activate on JavaScript/Node.js targets that perform deep merge, clone, extend, or object-combination on user-controlled input — settings/import/profile endpoints, JSON query parsing (`qs`), cookie/session merges, WebSocket message handling, and template engines (EJS/Pug/Handlebars). Also trigger on sandboxed runtimes (VM2, isolated-vm). Do not trigger when input is never merged into existing objects, all maps use `Object.create(null)`, schemas reject `__proto__`/`constructor`, or no dangerous downstream sink exists.

## Detection Approach

First determine whether a recursive merge path exists for user input — send `{"__proto__":{"pp_detect":"x"}}` and, after the request, create fresh objects server-side (or in the affected context) and check whether the property appears via prototype lookup. If `__proto__` is filtered, switch to `constructor.prototype`. Test both vectors independently. Confirm persistence across newly created objects, not just own-property reflection. Only after pollution is proven, hunt for gadgets: a downstream sink that reads a polluted property (`innerHTML`, redirect URL, template option, sandbox method). For sandbox escape, identify which prototype method, when overridden, executes in host context. Never claim RCE from property injection alone — a concrete sink must be demonstrated.

## Pitfalls

- Assuming every merge is vulnerable — `Object.assign` and spread are shallow and safe against `__proto__`; only recursive deep merge is.
- Claiming all objects polluted from a single reflected property — verify on multiple fresh objects.
- Confusing stored XSS with prototype pollution when the server merely reflects input.
- Claiming RCE/sandbox escape without showing the exact sink and host-context code that executed.
- Testing only `__proto__` when the filter blocks it but allows `constructor`.
- Pollution that only works in a test harness with a different merge library than production.

## Verification & Impact

CONFIRMED when a property injected via `__proto__`/`constructor.prototype` is observable on objects created *after* the payload, and — for impact — a gadget/sink demonstrably consumes it (XSS rendered, redirect to attacker host, sandbox escape, or RCE via a named sink like `child_process`). SUSPECTED when pollution is shown but no impactful sink is reached — record as candidate (property injection). Document impact by the proven gadget chain and capability, capturing the full request→merge→pollution→sink flow via `recordEvidence`.
