# Session Management Testing

## Session Fixation

1. Get a session ID before login: `GET /login` → note `Set-Cookie: session_id=abc123`
2. Log in with valid credentials
3. Check if the session ID changed:
   - Same `session_id=abc123` after login → Session fixation vulnerability
   - New `session_id=def456` → Session regenerated (good)
4. Test: Use the pre-login session ID to access authenticated endpoints

## Session Timeout

1. After login, wait for the configured session timeout
2. Try to access an authenticated endpoint:
   - 401/403 → timeout enforced (good)
   - 200 → no timeout enforcement (vulnerability)
3. Test with sliding vs fixed timeout:
   - Sliding: timeout resets on each request
   - Fixed: timeout from initial login
4. Check if timeout is configurable client-side (cookie expiry vs server-side)

## Concurrent Sessions

1. Log in from Browser A → get session A
2. Log in from Browser B → get session B
3. Check if both sessions are valid simultaneously:
   - Both work → concurrent sessions allowed (may be intentional)
   - Session A invalidated → single-session enforcement (good for sensitive apps)
4. Test maximum session count:
   - Log in from N browsers → does the server enforce a limit?
   - What happens when limit is exceeded? (oldest session killed? new login rejected?)

## Session Invalidation on Logout

1. Log in → get session cookie
2. Log out via the logout endpoint
3. Try to access an authenticated endpoint with the old session cookie:
   - 401/403 → session invalidated (good)
   - 200 → session still valid (vulnerability)
4. Check if logout clears server-side session store
5. Check if logout clears client-side storage (cookies, localStorage)

## Token Storage Analysis

1. After login, check where the session token is stored:
   - `HttpOnly` cookie → not accessible via JavaScript (good)
   - `localStorage` → accessible via JavaScript (vulnerable to XSS)
   - `sessionStorage` → cleared on tab close (better than localStorage)
   - URL query parameter → leaked via Referer (critical)
2. Check cookie attributes:
   - `Secure` → only sent over HTTPS
   - `SameSite=Strict` → not sent with cross-origin requests
   - `Path` → restricts cookie scope
   - `Expires/Max-Age` → session lifetime
