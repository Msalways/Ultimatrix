---
name: race-conditions-advanced
description: "Advanced race condition exploitation using Turbowlence, single-packet attacks, and TOCTOU chains"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, measureTiming, compareResponses, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["race condition", "concurrent request", "turbowlence", "single packet attack", "toctou", "time of check", "double spend", "race condition exploit", "parallel request", "thread safety"]
contextBoosts: [api]
mitreAttack: ["T1190", "T1499"]
owaspRefs: ["OWASP Top 10 A04:2021 Insecure Design"]
---

# Race Conditions — Advanced Exploitation

## When to Use

- Target exposes state-changing endpoints (payments, inventory, coupon redemption, balance transfers, role assignment)
- Application uses optimistic concurrency without proper locking
- API performs a check-then-act sequence without atomic guarantees
- You observe non-idempotent operations that lack CSRF tokens or nonce validation
- Multiple requests to the same endpoint produce inconsistent or duplicate side effects
- HTTP/2 or HTTP/3 multiplexing is available (enables single-packet techniques)

## Do Not Use

- Against systems you do not have explicit written authorization to test
- On endpoints that only perform read operations with no state mutation
- When the race window is provably eliminated by database-level serializable isolation
- Against rate-limited endpoints where the exploit requires thousands of requests (risk of DoS)
- On production payment systems without prior agreement on testing boundaries

## Auth Context

- Authenticate as a low-privilege user first; many race conditions are exploitable only across privilege boundaries
- Capture a valid session token and observe which endpoints accept state changes
- Note whether the application enforces CSRF tokens — missing tokens dramatically widen race windows
- Check if WebSocket or Server-Sent Events connections carry session context (they often bypass CSRF checks)
- Record all captured headers for evidence chain: `getCapturedHeaders`

---

## Race Condition Theory

### TOCTOU (Time-of-Check to Time-of-Use)

A TOCTOU vulnerability exists when the application performs a check (is this coupon valid?) and then acts on the result (redeem the coupon) as two separate, non-atomic operations. The vulnerability is the gap between the check and the use.

```
Thread A: CHECK coupon_valid → TRUE ────────────────── USE coupon
Thread B: CHECK coupon_valid → TRUE ────────────────── USE coupon
                                ↑ both see valid state before either acts
```

**Critical principle**: The exploit is not about speed — it is about ensuring two requests observe the same precondition before either commits the effect.

### Shared Resource Contention

Multiple concurrent requests access the same resource (balance, inventory count, session state) without proper synchronization. The application assumes sequential execution but receives parallel execution. Result: duplicate processing, overspend, oversell, or data corruption.

### Atomic Operations

An operation is atomic if it completes entirely or not at all, with no observable intermediate state. Race conditions occur when the application uses non-atomic operations for compound logic (read-modify-write). Database transactions with `SERIALIZABLE` isolation eliminate most server-side races, but application-level races persist when the transaction boundary does not enclose the full check-act sequence.

---

## Detection

### Identify State-Changing Operations

1. Map every endpoint that mutates server state: POST, PUT, PATCH, DELETE
2. For each, trace the server-side logic: does it read state, make a decision, then write?
3. Check for version fields, ETags, or `If-Match` headers (optimistic concurrency controls)
4. Note endpoints missing these controls — they are primary targets

### Test for Duplicate Processing

1. Send 10-20 concurrent identical requests to the same state-changing endpoint
2. Use `compareResponses` to identify divergent response bodies or status codes
3. Check server state after the burst: was the operation applied once or multiple times?
4. Look for partial failures (some succeed, some return 409 Conflict) — this indicates partial protection

### Timing Windows

1. Use `measureTiming` to establish baseline latency for the target endpoint
2. Send concurrent requests and measure response time variance
3. Large variance suggests the server is processing requests sequentially but not atomically — race window exists
4. Consistent response times across concurrent requests suggest proper locking (or no side effects)

---

## Concurrent Request Techniques

### Parallel Thread Execution

Use scripting to spawn N threads, each issuing an identical HTTP request. The goal is to overwhelm the application's sequential processing assumption.

```
function raceAttack(targetUrl, payload, concurrency) {
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(httpRequest(targetUrl, payload));
  }
  return Promise.allSettled(promises);
}
```

**Key parameters**:
- `concurrency`: Start with 10, scale to 50-100 if needed
- `payload`: Identical across all requests (test duplicate processing)
- `delay`: Zero delay between spawns (true parallelism)

### Async Request Batching

When true parallelism is unavailable, use asynchronous request batching with minimal stagger:

1. Queue N requests
2. Dispatch all within a single event loop tick (JavaScript) or thread pool burst (Python/Java)
3. The stagger should be under 1ms — sufficient to hit most application-level race windows

### Timing Window Identification

1. Send two requests: one that triggers a slow operation (file upload, external API call), one that exploits the gap
2. Measure the window: how long does the slow operation take before committing?
3. Use that window as the concurrency budget for the exploit

---

## Turbowlence Method

Turbowlence (or Turboslacker-style techniques) refers to sending N concurrent HTTP requests in a single burst to maximize the probability of hitting a race window.

### Principle

- Standard concurrent requests use separate TCP connections or HTTP/2 streams
- Turbowlence maximizes the burst by dispatching all requests simultaneously, not sequentially
- The target server must process all requests within the same processing cycle

### Implementation

1. **Burp Suite Turbo Intruder**: Configure to send N requests on a single connection using HTTP/2 multiplexing
2. **Custom script**: Use `asyncio` (Python) or `Promise.all` (Node.js) to fire all requests in a single tick
3. **Packet-level craft**: For HTTP/2, inject multiple HEADERS + DATA frames into a single TCP packet

### Configuration

```
concurrency: 20-50 requests
target: single state-changing endpoint
payload: identical across all requests
measure: response codes, response bodies, server-side state
```

### Interpreting Results

- All requests return 200 with identical response: operation applied once — no race condition
- Some return 200, some return 409/429: partial protection exists, narrow the window
- All return 200 with different response bodies: state was modified between requests — race confirmed
- Server returns 500 on some: server crashed under contention — potential for crash-based exploitation

---

## Single-Packet Attack

The single-packet attack is an advanced technique that embeds multiple HTTP requests within a single TCP packet, exploiting HTTP/2 multiplexing.

### How It Works

1. HTTP/2 allows multiple streams over a single TCP connection
2. Each stream carries an independent HTTP request
3. By crafting a single TCP packet containing multiple complete HTTP/2 frames (HEADERS + DATA), all requests arrive at the server simultaneously
4. The server must process all requests from the same packet — maximizing race window overlap

### Crafting the Packet

```
TCP Packet:
  [Frame 1: Stream 1, HEADERS, POST /transfer {amount: 1000}]
  [Frame 2: Stream 2, HEADERS, POST /transfer {amount: 1000}]
  [Frame 3: Stream 3, HEADERS, POST /transfer {amount: 1000}]
  ...
```

### Requirements

- HTTP/2 or HTTP/3 connection (HTTP/1.1 does not support multiplexing)
- Control over the TCP packet structure (custom socket or specialized tool)
- Server must not enforce strict ordering per-stream processing

### Effect

- Even applications with per-request rate limiting may fail to detect the burst because all requests arrive as a single network event
- Server-side queuing mechanisms may process all requests before any side effects are visible to subsequent checks

---

## TOCTOU Chains

### Balance Check → Transfer

The classic double-spend race:

1. Server checks: `balance >= amount` → TRUE
2. Thread A: `balance -= amount` (commits)
3. Thread B: `balance -= amount` (commits, because it read balance before Thread A committed)

**Exploit**: Send two concurrent transfer requests for the full balance. Both pass the check; both deduct.

### Coupon Validation → Redemption

1. Server checks: `coupon.valid == true && coupon.used == false` → TRUE
2. Thread A: `coupon.used = true, discount applied`
3. Thread B: `coupon.used = true, discount applied`

**Exploit**: Two concurrent redemptions of the same single-use coupon. Both succeed.

### Inventory Check → Purchase

1. Server checks: `stock > 0` → TRUE
2. Thread A: `stock -= 1, order created`
3. Thread B: `stock -= 1, order created`

**Exploit**: Concurrent purchases of the last item. Both succeed, stock goes negative.

### Check-Then-Act Pattern Detection

Look for this code pattern in application logic (or infer from behavior):

```
1. READ resource state
2. EVALUATE condition
3. MODIFY resource based on evaluation
```

If steps 1-3 are not within a single atomic transaction, the race window exists.

---

## Double-Spend

### Definition

A double-spend occurs when a single unit of value (currency, credit, token, coupon) is successfully redeemed more than once due to a race condition.

### Detection

1. Identify the value-unit (balance, coupon, token, credit)
2. Send N concurrent requests to consume the unit
3. Check if the unit was consumed once or N times
4. Verify the resulting state: does the system show N successful transactions or 1?

### Exploitation Patterns

- **Wallet transfer**: Send the same balance to two different recipients concurrently
- **Coupon redemption**: Apply the same coupon to two orders concurrently
- **Token consumption**: Use the same API token for two concurrent operations that each invalidate it
- **Loyalty points**: Redeem the same points for two different rewards concurrently

### Mitigation Bypass

- If the application uses `UPDATE ... WHERE balance >= amount`, the database may prevent the race — test with higher concurrency
- If the application uses optimistic versioning (`UPDATE ... WHERE version = X`), the race is partially mitigated but the version check must cover the full transaction
- If the application uses `SELECT FOR UPDATE`, the race is mitigated at the database level but application-level races may still exist (e.g., cache invalidation)

---

## Privilege Escalation via Race

### Concurrent Admin Grant

1. Send two concurrent requests: one to promote User A to admin, one to promote User B to admin
2. If the application checks "is there already an admin?" before each grant, both may pass
3. Result: two admins when only one was intended

### Role Assignment Race

1. Application checks: `user.roles.length < maxRoles` → TRUE
2. Thread A: adds "admin" role, commits
3. Thread B: adds "admin" role, commits (read role count before Thread A committed)
4. Result: user has duplicate roles, or role cap bypassed

### Session Token Race

1. Application invalidates old token and issues new token during password change
2. Send two concurrent password-change requests
3. Both receive valid new tokens before either invalidation completes
4. Result: multiple active sessions for the same user after a "logout everywhere" action

---

## File System Races

### Symlink Attacks

1. Application creates a temporary file in a shared directory with a predictable name
2. Attacker places a symlink at that path before the application opens it
3. The application writes to the symlink target (e.g., `/etc/passwd`) instead of the temp file
4. Race window: between the check ("does file exist?") and the open/create

### Temporary File Creation Races

1. Application creates temp file with `O_CREAT | O_EXCL` (atomic create)
2. If the application uses non-atomic creation (check-then-create), an attacker can create the file between check and create
3. Result: application writes to attacker-controlled file, or application fails to write and leaks information

### Log File Injection

1. Application appends user input to a log file without sanitization
2. Concurrent requests inject log entries that include newlines and fake log entries
3. If the log is processed by another tool (log analyzer, SIEM), injected entries may trigger actions

---

## GraphQL Race Conditions

### Concurrent Mutations

GraphQL allows multiple mutations in a single request. If the server processes them concurrently:

```json
{
  "query": "mutation { A: transfer(from: \"me\", to: \"alice\", amount: 100) { success } B: transfer(from: \"me\", to: \"bob\", amount: 100) { success } }"
}
```

Both mutations may read the same balance before either commits. Test by sending batched mutations that affect the same resource.

### Subscription Race Conditions

1. Client subscribes to a resource update event
2. Two concurrent mutations modify the same resource
3. The subscription may fire with stale data, or the second mutation may overwrite the first without the subscriber seeing intermediate state
4. Race between subscription event delivery and mutation commit can cause UI inconsistencies or data loss

### Batched Query Exploitation

1. Send a batched query where one query reads a value and another writes to it
2. If the server executes the batch without serializing mutations, the read may return stale data
3. Use `compareResponses` to detect inconsistent reads across batched queries

---

## Anti-Hallucination

### What NOT to Claim

- Do NOT claim a race condition exists without evidence of duplicate processing or inconsistent state
- Do NOT claim a double-spend without verifying the server actually applied the operation multiple times
- Do NOT claim TOCTOU without demonstrating that the check and act are separate operations
- Do NOT claim a file system race without evidence of symlink resolution or temp file overwrite
- Do NOT assume race conditions based solely on the absence of concurrency controls — absence of controls is necessary but not sufficient

### What Evidence Looks Like

- Two concurrent requests both return HTTP 200 with different transaction IDs (duplicate processing confirmed)
- Server-side balance is negative after two concurrent full-balance transfers (double-spend confirmed)
- Two concurrent coupon redemptions both apply the discount (race in coupon validation confirmed)
- Response bodies from concurrent requests contain inconsistent state snapshots (non-atomic reads confirmed)

### Evidence Collection

1. Use `recordEvidence` for each concurrent request with full request/response details
2. Use `compareResponses` to document divergent responses
3. Use `measureTiming` to document the race window timing
4. Use `getCapturedHeaders` to preserve auth context for the evidence chain
5. Use `writeFinding` to document the race condition with severity assessment
6. Use `updateGraph` to link the finding to the affected endpoints and data flows
