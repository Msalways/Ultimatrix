# RBAC Testing Protocol

## Role Matrix

For each endpoint, test with every role:
| Endpoint | Guest | User | Moderator | Admin |
|----------|-------|------|-----------|-------|
| /api/public | ? | ? | ? | ? |
| /api/users/me | ? | ? | ? | ? |
| /api/admin/users | ? | ? | ? | ? |
| /api/admin/settings | ? | ? | ? | ? |

## Test Commands

1. **Get captured headers for each role**:
   ```
   getCapturedHeaders → target URL + role="guest"
   getCapturedHeaders → target URL + role="user"
   getCapturedHeaders → target URL + role="admin"
   ```

2. **Test each endpoint with each role**:
   ```
   httpRequest → endpoint + headers from role A
   httpRequest → endpoint + headers from role B
   ```

3. **Compare responses**:
   - Same 200 + same body → role doesn't matter (broken RBAC)
   - 200 for user, 403 for guest → RBAC working
   - 200 for guest, 403 for user → inverted RBAC (critical)
   - Different response sizes → possible data leak

## Privilege Escalation Vectors

1. **Path traversal in role check**: `/api/admin/../user/settings` may bypass role check
2. **HTTP method override**: `X-HTTP-Method-Override: DELETE` on a GET endpoint
3. **Case sensitivity**: `/Admin/Settings` vs `/admin/settings`
4. **API versioning**: `/api/v2/admin/users` may have weaker auth than `/api/v1/admin/users`
5. **Wildcard routes**: `/api/users/*` may match `/api/users/admin`
6. **Null byte injection**: `/admin/settings%00.json` — some servers truncate at null byte

## Method-Based Access Control

1. Test each endpoint with every HTTP method:
   ```
   GET /api/admin/users → 403
   POST /api/admin/users → 200 (method-based bypass)
   ```
2. Test with `X-HTTP-Method-Override` header
3. Test with `_method` query parameter (some frameworks support this)
4. Test OPTIONS response for allowed methods
