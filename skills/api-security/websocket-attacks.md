---
name: websocket-attacks
description: "WebSocket security testing including cross-site WebSocket hijacking, message injection, and protocol abuse"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["websocket attack", "websocket security", "cross-site websocket hijacking", "cswsh", "websocket injection", "websocket protocol", "real-time attack", "websocket testing", "ws security", "socket.io attack"]
contextBoosts: [api, websocket]
mitreAttack: ["T1190", "T1189"]
owaspRefs: ["OWASP Top 10 A01:2021 Broken Access Control"]
---

# WebSocket Security Testing

## When to Use

- Target exposes WebSocket endpoints (ws:// or wss://)
- Real-time features: chat, notifications, live feeds, collaborative editing, gaming
- API responses include Upgrade headers or WS URLs in JavaScript bundles
- User reports issues with real-time data leakage or session hijacking
- Target uses Socket.IO, SignalR, or similar WS frameworks

## Do Not Use

- Static REST-only APIs with no WebSocket presence
- Server-Sent Events (SSE) — different protocol, different attack surface
- Long-polling — not true WebSocket, use HTTP testing instead
- When WebSocket handshake consistently fails after multiple attempts — may indicate IP/rate blocking

## Auth Context

Before testing, capture the full WebSocket handshake:
1. Record the initial HTTP Upgrade request headers
2. Note authentication mechanism: cookie, Bearer token, query param, or session ID
3. Identify if auth is enforced at handshake or per-message
4. Check if the server validates Origin header during upgrade

## WebSocket Discovery

Identify WebSocket endpoints through multiple vectors:

### Page Source Inspection
- Search HTML for `ws://`, `wss://`, `WebSocket(`, `new WebSocket`
- Look for Socket.IO `io()` or `io.connect()` calls
- Check for protocol handlers like `socket.io/?EIO=`
- Find configuration objects containing WS URLs (look for `socketUrl`, `wsUrl`, `wsEndpoint`)

### JavaScript Bundle Analysis
- Grep bundled JS for WebSocket constructor calls
- Search for `addEventListener.*message`, `onmessage`, `socket.on`
- Look for reconnection logic — indicates persistent WS dependency
- Check for `socket.io/client` imports

### Network Tab (if browser available)
- Filter for WebSocket frames in DevTools Network tab
- Look for 101 Switching Protocols responses
- Note the full URL including query parameters and path

### Common WS Paths
- `/ws`, `/socket`, `/websocket`, `/ws/`, `/api/ws`
- `/socket.io/?EIO=4&transport=websocket` (Socket.IO)
- `/signalr/negotiate` then `/signalr/connect` (SignalR)
- `/graphql` over WebSocket (subscriptions)

## Cross-Site WebSocket Hijacking (CSWSH)

CSWSH exploits missing or weak Origin validation during the WebSocket handshake.

### Attack Principle
The WebSocket protocol does not enforce same-origin policy at the browser level. If the server does not validate the Origin header, any malicious page can open a WebSocket connection and hijack the victim's session.

### Test Procedure
1. **Capture a legitimate handshake** — note the full URL, all headers, and cookies sent
2. **Identify Origin validation** — does the server reject connections from unknown origins?
3. **Craft a malicious page** — create HTML with JavaScript that connects to the target WS endpoint
4. **Serve from attacker domain** — host the page on a controlled domain (e.g., attacker.example)
5. **Test with victim's cookies** — if auth is cookie-based, the malicious page inherits cookies

### Malicious Page Template

### Origin Validation Checks
- Does server send `Access-Control-Allow-Origin` on the 101 response?
- Does server echo back the request Origin without validation?
- Can you connect with a completely random Origin header?
- Does server only check Origin for the initial handshake but not for subsequent messages?
- Can you bypass Origin check using `null` origin (sandboxed iframe)?

### Severity Indicators
- **Critical**: No Origin check + cookie auth = full session hijack
- **High**: Weak Origin check (allows subdomains) + cookie auth
- **Medium**: Origin validated but auth token in URL query string (leaks in logs)
- **Low**: Origin validated and auth via header — still verify token reuse

## Message Injection

Inject unauthorized messages into authenticated WebSocket sessions.

### Injection Vectors

**Cross-origin injection (CSWSH prerequisite):**
- Open a WS connection from attacker-controlled page
- Send messages to manipulate victim's session
- Example: inject messages into a chat room, modify shared state

**Replay injection:**
- Capture legitimate WS frames
- Replay messages to test for idempotency
- Test if server processes duplicate messages (financial transactions, state changes)

**Partial message injection:**
- Send messages with modified fields while keeping valid structure
- Test if server validates message schema strictly
- Try modifying IDs, permissions, user fields in message payloads

### Test Procedure
1. Establish a legitimate WS connection
2. Capture the message format and structure
3. Modify message fields (IDs, roles, permissions, recipients)
4. Send modified messages and observe server response
5. Check if unauthorized state changes occur

### Message Format Analysis
- Parse incoming messages for JSON structure
- Note field names: `userId`, `role`, `action`, `type`, `permission`
- Identify which fields are server-validated vs client-only
- Check if messages are signed or integrity-protected

## Authentication Testing

### Handshake-Level Auth
- Test connection without any auth headers/cookies — does server reject?
- Test with expired tokens — does server close the connection?
- Test with tokens from other users/sessions
- Check if auth is checked at upgrade or lazily on first message

### Token in URL (Insecure)
- If auth token is in query string (`?token=xxx`), it leaks in:
  - Server logs
  - Browser history
  - Referrer headers
  - Proxy logs
- Severity: Medium-High depending on token scope

### Token in Header (Secure)
- Verify server requires Authorization header during handshake
- Check if connection is closed when token expires mid-session
- Test if server validates token on every message or only at handshake

### Session Binding
- Does the server bind the WS connection to the authenticated session?
- Can you use the same token to open multiple concurrent connections?
- Does server invalidate WS session when HTTP session expires?

## Authorization Testing

### Horizontal Privilege Escalation
- Connect as User A, send messages targeting User B's resources
- Modify `userId` or `recipientId` in message payloads
- Subscribe to channels/rooms the authenticated user should not access
- Request data for other users via message parameters

### Vertical Privilege Escalation
- Attempt admin-only operations via WS messages
- Send messages requiring elevated roles
- Test if role checks happen server-side per message or only at connection

### Channel/Room Authorization
- Join rooms/channels the user is not subscribed to
- Test wildcard or pattern-based room names (`admin/*`, `user/other-id/*`)
- Check if room names are predictable or enumerable
- Test if private rooms leak data when joined without authorization

## Input Validation

### Oversized Messages
- Send messages significantly larger than normal (1MB, 10MB, 100MB)
- Check if server enforces per-message size limits
- Test if large messages cause memory exhaustion or crashes
- Monitor server response times during large message sends

### Malformed Data
- Send non-JSON data when JSON is expected
- Send deeply nested JSON objects (stack overflow potential)
- Send Unicode edge cases: surrogate pairs, RTL overrides, zero-width characters
- Send binary frames when text is expected and vice versa
- Send empty frames, null bytes, unterminated JSON

### Injection Payloads in Messages
- SQL injection in string fields: `'; DROP TABLE users; --`
- XSS in chat messages: `<script>alert(1)</script>`, `<img onerror=...>`
- NoSQL injection: `{"$gt": ""}`, `{"$ne": null}`
- Template injection: `{{7*7}}`, `${7*7}`, `<%= 7*7 %>`
- Path traversal in file references: `../../etc/passwd`

### Schema Validation Bypass
- Remove required fields from JSON messages
- Change field types (string → array, number → object)
- Add unexpected fields the server might process
- Send messages from deprecated protocol versions

## Rate Limiting

### Message Flood DoS
- Send rapid bursts of messages (100+ per second)
- Test if server enforces per-connection rate limits
- Check if rate limiting is global (affects all users) or per-connection
- Monitor server resource usage during flood

### Connection Flood
- Open many concurrent WebSocket connections from same source
- Test if server limits total connections per IP/user
- Check connection limits per session
- Test connection churn (rapid open/close cycles)

### Asymmetric Load
- Send messages that trigger expensive server processing
- Test if server-side validation is computationally expensive
- Send messages requiring database queries or external API calls
- Check if server applies different limits for different message types

## Protocol Abuse

### WebSocket Upgrade Abuse
- Send Upgrade headers to non-WS endpoints
- Test if server properly rejects non-WS upgrade requests
- Send malformed HTTP upgrade requests
- Test HTTP request smuggling via Upgrade headers

### HTTP/2 WebSocket
- Test if server supports WebSocket over HTTP/2
- Check for CONNECT method handling
- Test WebSocket over cleartext HTTP/2 (h2c)

### Subprotocol Manipulation
- List all supported subprotocols from server response
- Send unsupported subprotocol names
- Test if server enforces subprotocol-specific message formats
- Negotiate multiple subprotocols simultaneously

### Close Frame Manipulation
- Send close frames with different status codes
- Send close frames with payload data
- Test if server properly handles abnormal closures
- Check if server cleans up resources on abnormal close

### Ping/Pong Abuse
- Send rapid ping frames
- Send oversized ping payloads
- Test if server responds to pings (resource consumption)
- Check if missing pong responses trigger disconnect

### Socket.IO Specific
- Test Engine.IO transport upgrade (polling → websocket)
- Manipulate `EIO` parameter (v3 vs v4 protocol differences)
- Test `sid` parameter reuse across connections
- Check for path traversal in Socket.IO namespace routing
- Test binary vs text frame handling differences

## Anti-Hallucination

### Evidence Requirements
Every finding must be backed by concrete evidence:
- Record the exact WebSocket URL and handshake headers
- Capture the malicious page HTML used for CSWSH testing
- Log all sent and received messages with timestamps
- Document server responses including close frames and error messages
- Save network traces showing the full handshake sequence

### What Constitutes Valid Evidence
- A successful 101 Switching Protocols response from an attacker-controlled origin
- Received data from a WS connection without proper authentication
- Server processing a modified message that changed application state
- Connection remaining open after sending invalid auth credentials
- Server echoing back data sent from unauthorized connections

### Common Hallucination Patterns
- Claiming CSWSH without testing from an actual external origin
- Assuming message injection worked without server-side state verification
- Reporting rate limiting issues without measuring actual server thresholds
- Claiming auth bypass without demonstrating the full handshake sequence

### Verification Checklist
- [ ] Handshake captured with full request/response headers
- [ ] CSWSH tested with actual external page served from different origin
- [ ] Message injection verified by observing state change on legitimate session
- [ ] Auth bypass confirmed by receiving protected data without credentials
- [ ] Rate limits measured with actual message timing data
- [ ] All findings reproduce consistently across multiple attempts

## Trigger Conditions

Activate when the target exposes WebSocket endpoints (`ws://`/`wss://`) — chat, notifications, live feeds, collaborative editing, or `/socket.io`, `/signalr`, `/graphql` subscriptions — especially when WS URLs or Upgrade headers appear in JS bundles or API responses. Trigger for real-time authz/session concerns and message-injection surfaces. Do not trigger on REST-only APIs, SSE, or long-polling; if the WS handshake consistently fails (IP/rate blocking), pause rather than hammer.

## Detection Approach

First discover WS endpoints via page source, bundle analysis, and DevTools (look for `101 Switching Protocols`). Capture the full Upgrade handshake and identify the auth mechanism (cookie/Bearer/query) and whether Origin is validated. For CSWSH, test whether the server accepts a connection from an attacker-controlled origin — if it does and auth is cookie-based, the victim's session is hijackable. For message injection/authorization, establish a legitimate connection, learn the message schema, then tamper with `userId`/`role`/`recipientId` and observe server-enforced vs client-only validation. Test auth at handshake vs per-message, and horizontal/vertical escalation via message params. For input validation, send oversized/malformed/injection-laden frames. Confirm every finding with the actual handshake and observed state change — never assume from schema alone.

## Pitfalls

- Claiming CSWSH without testing from a real external origin (not just header inspection).
- Assuming message injection worked without verifying server-side state change.
- Reporting rate-limiting issues without measuring actual thresholds.
- Claiming auth bypass without demonstrating the full handshake sequence.
- Confusing SSE/long-polling with true WebSocket.
- Ignoring whether auth is checked per-message or only at handshake (lazy checks are the gap).

## Verification & Impact

CONFIRMED when evidence shows: a successful 101 from an external origin (CSWSH), receipt of protected data without credentials, a modified message that changed application state, or connection persistence with invalid auth. SUSPECTED when the handshake looks weak but cross-origin/state impact isn't reproduced — record as candidate. Document impact by capability (session hijack, cross-user data access, privilege escalation, DoS via flood) and severity (CSWSH + cookie auth = Critical). Capture the WS URL, handshake headers, sent/received frames, and close frames via `recordEvidence`.
