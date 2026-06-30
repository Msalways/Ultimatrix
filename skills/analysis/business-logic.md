---
name: business-logic
description: "Business logic flaw testing: workflow bypass, data manipulation, race conditions, and state integrity"
category: specialized
toolRefs: [httpRequest, parseResponse, evaluateRendered, measureTiming, compareResponses, followRedirects, findEndpointsInResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
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

**Quantity Manipulation:**
- Set quantity to 0, negative, or very large numbers
- Test integer overflow: `quantity=2147483648`
- Test decimal quantities: `quantity=0.5`

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
