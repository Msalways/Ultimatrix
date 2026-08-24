---
name: business-logic
description: "Business logic flaw testing: workflow bypass, data manipulation, race conditions, and state integrity"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, measureTiming, compareResponses, followRedirects, findEndpointsInResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders, runPrimitive, runCampaign]
primitives: [workflowBypass, invariantProbe, configTrust, businessLogicAbuse]
triggers: ["business logic", "workflow bypass", "data manipulation", "race conditions", "state integrity", "logic flaws", "business testing", "workflow testing", "business vulnerabilities", "application logic"]
mitreAttack: ["T1190"]
owaspRefs: ["OWASP Top 10 A04:2021 Insecure Design"]
---

# Business Logic Testing

## Description
Business logic testing identifies flaws in application workflows that allow users to manipulate intended business processes. These flaws often have high impact because they bypass technical security controls.

## Auth Context
Before making HTTP requests, call **getCapturedHeaders** with the target URL to get real auth context.

## Methodology

### Step 1: Understand the Business Flow
Before testing, map the complete intended workflow:
1. Navigate the application using browser tools to understand normal user flow
2. Identify all steps in multi-step processes (checkout, registration, password reset)
3. Note validation points at each step
4. Identify what data is passed between steps (hidden fields, session, tokens)

### Step 2: Workflow Bypass Testing

**Skip Steps:**
- Try accessing step 3 directly without completing steps 1 and 2
- Modify URL parameters to jump to later steps
- Send POST requests to final endpoints without going through the form flow

**Reorder Steps:**
- Complete steps out of order (e.g., submit payment before adding items to cart)
- Repeat steps (e.g., apply discount code multiple times)
- Skip mandatory fields by sending requests directly

**Repeat Steps:**
- Submit the same form twice (double-spending, double-registration)
- Use replay attacks on state-changing operations

### Step 3: Data Manipulation Testing

**Price Manipulation:**
- Modify price fields in POST requests (negative prices, zero prices, decimal manipulation)
- Change currency codes
- Modify quantity to negative values
- Test bulk discount thresholds

**Payload:** price tampering — client-trusted price in checkout JSON:

```http
POST /api/checkout HTTP/1.1
Host: target.com
Content-Type: application/json
Cookie: session=...

{
  "items": [
    {"productId": 1337, "name": "Laptop", "price": 0.01, "qty": 1}
  ],
  "currency": "USD"
}
```

**Quantity Manipulation:**
- Set quantity to 0, negative, or very large numbers
- Test integer overflow: `quantity=2147483648`
- Test decimal quantities: `quantity=0.5`

**Payload:** negative quantity for refund-style credit:

```http
POST /api/cart/items HTTP/1.1
Host: target.com
Content-Type: application/json

{"productId": 2001, "quantity": -100}
```

```http
GET /cart HTTP/1.1
Host: target.com
```

If cart total goes negative (store credit / payout), the server trusts client-side totals.

**Coupon Stacking:**
- Apply the same coupon repeatedly via replayed requests
- Submit multiple different coupons when only one should be valid
- Reuse an expired or single-use code

**Payload:** stacked discount application:

```http
POST /api/coupons/apply HTTP/1.1
Host: target.com
Content-Type: application/json

{"code": "SAVE10"}
```

Replay the same request 5 times; then apply `{"code": "WELCOME20"}` on top. If the order total reflects both discounts multiplied, stacking is accepted.

**State Manipulation:**
- Modify order status in transit (pending → delivered)
- Change user role in registration (user → admin)
- Modify boolean flags (isVerified, isAdmin, isPremium)

### Step 4: Race Condition Testing

Race conditions exploit timing in concurrent operations:

1. **Identify sensitive operations:**
   - Password change, email update, funds transfer
   - Coupon redemption, voucher usage
   - Inventory management, seat booking
   - Account registration, email verification

2. **Test with concurrent requests:**
   - Send 5-10 simultaneous requests to the same endpoint
   - Use the same auth headers for all requests
   - Look for: double spending, multiple success responses, inconsistent state

**Payload:** race on single-use coupon redeem — fire N identical requests concurrently (last-byte sync):

```http
POST /api/coupons/redeem HTTP/1.1
Host: target.com
Content-Type: application/json
Cookie: session=...

{"code": "SAVE50", "orderId": 9001}
```

Send 20 parallel copies of this request (e.g. via `HTTP/2` single-connection pipelining or threads started on a shared gate event). If ≥2 responses return `200 {"redeemed": true}` and the discount is applied twice to the order, the redemption is non-atomic.

**Payload:** race on fund withdrawal / transfer:

```http
POST /api/wallet/transfer HTTP/1.1
Host: target.com
Content-Type: application/json

{"to": "attacker", "amount": 500.00}
```

Fire 10 concurrent transfers against a balance of 500.00 — two successes means check-and-debit is not atomic.

3. **Timing-based tests:**
   - Submit a form while the server is processing (TOCTOU)
   - Modify data between check and use (time-of-check to time-of-use)

### Step 5: Input Validation Bypass

**Client-Side Validation:**
- Bypass JavaScript validation by sending requests directly
- Modify field types (string → number, number → array)
- Test with very long inputs, special characters, null bytes

**Server-Side Validation:**
- Test with missing required fields
- Test with extra unexpected fields (mass assignment)
- Test with wrong data types

**Payload:** mass assignment of privilege flags:

```http
PATCH /api/user/profile HTTP/1.1
Host: target.com
Content-Type: application/json

{
  "email": "user@example.com",
  "isAdmin": true,
  "isVerified": true,
  "role": "admin",
  "creditBalance": 999999
}
```

### Step 6: State Integrity Testing

- Test if operations can be performed multiple times (double-spend)
- Test if state changes are atomic (partial updates leaving inconsistent state)
- Test if concurrent modifications cause data corruption
- Test if rollback mechanisms work correctly

## What to Look For
- Missing validation on client-side only
- Steps that can be skipped or reordered
- Values that can be modified mid-process
- Concurrent requests that bypass checks
- Inconsistent state management
- Double-spending or double-redemption
- Negative quantities or prices
- Mass assignment of privilege fields

## Testing Approach
1. Map the complete business workflow using browser tools
2. Test each step in isolation for input validation
3. Test step skipping and reordering
4. Test concurrent operations for race conditions
5. Verify final state consistency after manipulation
6. Record all evidence with before/after comparisons

## Anti-Hallucination
Your claims will be verified against real tool output. Never fabricate findings.
Every vulnerability you report MUST have a corresponding tool call response that proves it.
If a tool call fails, say so honestly — do not invent a success.

## Trigger Conditions

Activate on multi-step workflows and stateful operations where the intended business order, validation, or constraints could be subverted: checkout/registration/password-reset flows, price/quantity/coupon fields, role/status/flag assignments, and any operation performable directly via request without browser navigation. Strong signals: hidden fields or tokens passed between steps, client-side-only validation, and endpoints that accept mutated types (string→array, number→object). Do not trigger on pure information disclosure or injection issues better covered by other skills.

## Detection Approach

First map the intended workflow end-to-end and note every validation point and the data passed between steps (session, hidden fields, tokens). Then reason about which checks are enforceable server-side vs only client-side. Test leapfrogging (access step 3 without 1–2), reordering (payment before cart), and repetition (replay a discount/coupon). For data manipulation, tamper with price/quantity/role/boolean flags and with field types. For state integrity, probe mass-assignment of unexpected fields and non-atomic updates. For races, fire concurrent identical state-changing requests and compare responses. Establish causation by changing one variable at a time; always verify the *final server state* (not just a friendly response) reflects the abuse.

## Pitfalls

- Trusting a success-page response as proof — verify the backend state actually changed (admin granted, price applied, coupon consumed once).
- Assuming client-side validation is mirrored server-side — send requests directly to confirm.
- Missing the race window because requests were sent sequentially — true concurrency is required to prove TOCTOU.
- Overlooking mass assignment — adding an extra `isAdmin` field the UI never shows.
- Conflating a UI quirk with a logic flaw — the business rule must be bypassable server-side.
- Reporting double-spend from a single replay without checking whether the server dedupes.

## Verification & Impact

CONFIRMED when a manipulation produces a verifiable server-side state change inconsistent with intended business rules — e.g., admin role granted, negative/zero price accepted and order placed, coupon redeemed multiple times, or a step executed out of order with effect. SUSPECTED when the response looks anomalous but final state is unverified — record as candidate. Document impact by the business consequence (financial loss, privilege gain, workflow bypass) and severity. Capture before/after request/response pairs and resulting state via `recordEvidence`.

## Primitive Execution

The attack classes above are executable through the primitive registry. Invoke each
primitive by its id below using the run-primitive execution tool instead of re-firing
payloads manually; confirmed results pass through the evidence gate and commit as
findings with exploit proofs automatically.

| Primitive id | Coverage |
|---|---|
| `workflowBypass` | state-machine step skipping/bypass |
| `invariantProbe` | business-invariant violation probe |
| `configTrust` | client-trust tampering (price/role flags) |
| `businessLogicAbuse` | business-logic abuse flows |
