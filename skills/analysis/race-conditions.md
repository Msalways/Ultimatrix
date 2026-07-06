---
name: race-conditions
description: "Race condition testing for TOCTOU, double-spend, and concurrent state manipulation"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, measureTiming, compareResponses, updateGraph, writeFinding]
triggers: ["race conditions", "toctou", "double spend", "concurrent state", "timing attacks", "race condition", "concurrent testing", "timing vulnerabilities", "thread safety", "race condition testing"]
---

# Race Condition Testing

## What is Race Condition Testing?
Race condition testing identifies vulnerabilities where concurrent requests can bypass security controls or manipulate application state.

## Key Concepts
- **TOCTOU (Time of Check to Time of Use)**: Gap between validation and action
- **Double-Spend**: Using same resource twice before update
- **Privilege Escalation**: Concurrent requests gaining higher access
- **Data Corruption**: Simultaneous modifications causing inconsistency

## Reasoning Framework
1. Identify state-changing operations
2. Test with concurrent requests
3. Verify atomicity of operations
4. Check for proper locking mechanisms
5. Validate final state consistency

## What to Look For
- Balance transfers with concurrent requests
- Coupon/voucher redemption with multiple uses
- Resource allocation with concurrent access
- Form submissions with rapid resubmission
- Check-then-act patterns without proper locking

## Testing Approach
- Send multiple concurrent requests for the same operation
- Verify only one succeeds when only one should
- Check final state consistency
- Test with different timing intervals
- Look for non-atomic operations
