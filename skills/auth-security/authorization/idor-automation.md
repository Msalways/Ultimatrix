# IDOR Automation

## Pattern Recognition

IDOR typically appears in these parameter patterns:

- **Path parameters**: `/api/users/12345` → change `12345` to `12346`
- **Query parameters**: `?user_id=abc` → change to `?user_id=def`
- **Request body**: `{"id": 100}` → `{"id": 101}`
- **Headers**: `X-User-Id: 100` → `X-User-Id: 101`
- **Encoded values**: UUID (`550e8400-e29b...`), numeric ID, base64-encoded ID
- **Composite keys**: `?file=user1/document.pdf` → `?file=user2/document.pdf`

## IDOR Test Protocol

1. Authenticate as User A, capture request/response
2. Note all object references: URLs, params, body fields, headers
3. Authenticate as User B
4. Replay User A's request with User B's session
5. If User A's data appears → Horizontal IDOR
6. Repeat for admin endpoints with User A's session → Vertical IDOR

## Bulk IDOR Enumeration

1. Capture a request that lists objects: `/api/users/12345/orders`
2. Extract the object ID pattern (numeric: iterate ±100; UUID: note the format)
3. Automate with a loop:
   - For numeric IDs: iterate from `id-100` to `id+100`
   - For UUIDs: capture UUIDs from another endpoint (e.g., user list) and replay
4. Check response differences:
   - 200 with data → IDOR
   - 403 with same-length response → access control present (good)
   - 404 → ID doesn't exist (not IDOR)
   - Different response size → possible data leak

## IDOR via API Versioning

1. Test `/api/v1/users/123` → `/api/v2/users/123` (newer version may skip auth checks)
2. Test `/api/internal/users/123` vs `/api/public/users/123`
3. Test with different `Accept` headers:
   - `Accept: application/json` vs `Accept: text/html` — different versions may have different auth
4. Test with `X-API-Version: 1` header — version via header may bypass path-based checks

## Parameter Pollution

1. Submit the same parameter twice:
   - `?user_id=attacker&user_id=victim` — server may use the first or last
   - Some servers use the first occurrence (attacker's), some use the last (victim's)
2. Test in different positions:
   - Query string: `?id=1&id=2`
   - Body (form): `id=1&id=2`
   - Headers: duplicate header values
3. Check if the authorization check uses one value while the data retrieval uses another
