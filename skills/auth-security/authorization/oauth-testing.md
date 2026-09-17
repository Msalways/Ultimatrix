# OAuth Testing

## Redirect URI Bypass

1. **Exact match bypass**: If server uses prefix matching, try:
   - `https://app.com/callback` → `https://app.com/callback/../admin`
   - `https://app.com/callback` → `https://app.com/callback?extra=/admin`
   - `https://app.com/callback` → `https://app.com/callback/` (trailing slash)
2. **Subdomain wildcard**: If server allows `*.app.com`:
   - Register `evil-app.com` or use `attacker.app.com`
   - Test `https://attacker.app.com/callback`
3. **Protocol confusion**: Test `http://app.com/callback` when `https://app.com/callback` is registered
4. **Domain confusion**: `https://app.com.evil.com` (subdomain of attacker domain)
5. **Port manipulation**: `https://app.com:443/callback` vs `https://app.com:8443/callback`
6. **Fragment bypass**: `https://app.com/callback#evil` — some servers strip fragments before comparison
7. **Open redirect chain**: `https://app.com/callback → /login?next=https://evil.com` → if the IdP follows the redirect, the auth code goes to attacker

## CSRF in OAuth Flow

1. Check if the OAuth flow uses `state` parameter:
   - No `state` → CSRF vulnerability: attacker can initiate a login with their account, link it to victim's session
   - `state` present but static/predictable → same issue
2. Test: Intercept the OAuth authorize URL, remove the `state` parameter, complete the flow. If it succeeds → CSRF present
3. Check if `state` is validated on callback (not just present)
4. **Login CSRF**: Register an attacker account with victim's email → victim logs in → attacker's account linked to victim

## Scope Escalation

1. Intercept the authorization request and modify `scope` parameter:
   - `openid profile` → `openid profile email admin api:write`
   - Add scopes not requested originally
2. Check if the token response includes all requested scopes or only what was authorized
3. Test with over-requested scopes: `scope=read write admin delete`
4. Check if scope validation happens server-side (token introspection) or if the client trusts the token's scope claim
5. If the authorization server has a scope approval page, check if modifying scope post-approval affects the token

## Authorization Code Interception

1. **Code replay**: Use the same authorization code twice — first exchange should work, second should fail
2. **Code injection**: Modify the `code` parameter in the callback before token exchange
3. **Code fixation**: Force a specific code value into the flow (if server accepts client-provided codes)
4. **PKCE bypass**: If PKCE is not enforced:
   - Steal the authorization code and exchange it without the code_verifier
   - If PKCE is enforced but weak (e.g., short code_verifier), test brute force
5. **Redirect interception**: Capture the code from the redirect URL (it's in the query string)

## Token Leakage via Referrer

1. Check if tokens appear in URLs (query parameters):
   - `https://app.com/callback?access_token=xyz`
   - If a page includes an external link or image, the token leaks via Referer header
2. Check if the callback URL retains the token after exchange
3. Test: Load a page that has an external `<img>` or `<a>` tag, check if Referer header contains the token
4. Check for tokens in JavaScript-accessible storage: `localStorage`, `sessionStorage`, `document.cookie`
5. Check for tokens in browser history (URL bar)
