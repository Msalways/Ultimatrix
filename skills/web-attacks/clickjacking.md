---
name: clickjacking
description: "Clickjacking (UI Redressing) attack techniques including frame injection, cookie forcing, and multi-step clickjacking"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["clickjacking", "ui redressing", "frame injection", "ui redress", "overlay attack", "cursorjacking", "scrolljacking", "tapjacking", "x-frame", "frame-ancestors"]
contextBoosts: [auth]
mitreAttack: ["T1189", "T1200"]
owaspRefs: ["OWASP Top 10 A04:2021 Insecure Design"]
---

# Clickjacking (UI Redressing) — Skill Reference

## 1. When to Use

- Target responds with missing or misconfigured `X-Frame-Options` header
- Target lacks CSP `frame-ancestors` directive
- Target is a state-changing application (password change, fund transfer, settings modification)
- Target uses session cookies sent automatically on iframe load
- Testing mobile or touch-based interfaces for overlay vulnerabilities
- Scanning for multi-step clickjacking chains (e.g., password change → email change → account takeover)

## 2. When NOT to Use

- Target explicitly blocks framing via both `X-Frame-Options: DENY` and `CSP: frame-ancestors 'none'`
- Target sets `X-Frame-Options: SAMEORIGIN` and attacker origin is external (cannot bypass same-origin)
- Purely static informational pages with no state-changing actions
- Target already implements robust anti-clickjacking (Verified framing headers + JavaScript frame-busting that is bypass-resistant)

## 3. Auth Context

- Clickjacking is most impactful when the victim is authenticated — the iframe inherits the victim's session cookies
- Prioritize pages behind authentication: profile settings, email change, password reset, payment forms, OAuth consent screens
- Unauthenticated clickjacking is possible but limited (e.g., tricking users into submitting login forms to an attacker-controlled endpoint)
- If auth is required, ensure `observeHumanActions` or `getCapturedHeaders` confirms an active session before testing framing

## 4. X-Frame-Options Detection

### Header Values

| Value | Effect |
|-------|--------|
| `DENY` | Page cannot be framed by any origin — strongest protection |
| `SAMEORIGIN` | Page can only be framed by the same origin — allows self-framing |
| `ALLOW-FROM <uri>` | Page can be framed only by specified origin — deprecated, unsupported in modern browsers |

### Detection Method

1. Fetch target page with `httpRequest`
2. Inspect response headers for `X-Frame-Options` (case-insensitive)
3. Classify:
   - **Missing entirely** → Vulnerable, proceed with iframe injection
   - **`DENY`** → Not frameable (verify with actual iframe test in case of misconfiguration)
   - **`SAMEORIGIN`** → Test: can attacker create a subdomain they control on the same eTLD+1? If yes, bypass is possible
   - **`ALLOW-FROM`** → Deprecated; test with modern browsers to confirm if actually enforced

### Common Misconfigurations

- Header present on some endpoints but absent on others (e.g., `/api/v1/settings` returns it, `/settings` does not)
- Header present on main page but absent on modal dialogs or embedded views
- Header present on HTTP response but absent on HTTPS response (or vice versa)
- Multiple `X-Frame-Options` headers with conflicting values

## 5. CSP `frame-ancestors` Directive

### Syntax


### Bypass Strategy

- **`frame-ancestors` overrides `X-Frame-Options`** — if both are present, `frame-ancestors` takes precedence in modern browsers
- Test pages individually: CSP may be set globally but missing on specific routes
- Look for CSP reported in `Content-Security-Policy-Report-Only` — this means the policy is not enforced
- If CSP uses `frame-ancestors 'self'`, test whether the attacker can host content on a subdomain or path that matches the same origin
- Pages with `frame-ancestors` but no `frame-ancestors` directive in the CSP value are still vulnerable — check the full CSP string

### Automated Detection

1. Fetch each target endpoint
2. Check for `Content-Security-Policy` header
3. Parse the CSP string for `frame-ancestors`
4. If absent or `'none'` is missing, the page is potentially frameable
5. Verify with `evaluateRendered` by loading the page in an actual iframe

## 6. Frame Busting Busts

### What is Frame Busting?

JavaScript-based protection that attempts to break out of iframes:


### Bypass Techniques

**Technique 1: Sandbox Attribute**

The `sandbox` attribute (without `allow-top-navigation`) prevents the iframe from navigating the top frame. The frame-busting script cannot redirect `top.location`.

**Technique 2: Two-Frame Nesting**

If frame-busting checks `self === top` and there is an intermediate frame, the check may pass.

**Technique 3: Overwrite `top.location` Setter**


**Technique 4: `about:blank` Origin Trick**

If the target's frame-busting code uses `document.referrer` or checks the referrer, an `about:blank` iframe may bypass the check.

**Technique 5: HTTPS/HTTP Mixed Content**

If target is HTTPS and attacker page is HTTP, the browser may block the frame entirely — but the reverse (attacker HTTPS framing HTTP target) may still work.

### Verification

After applying bypass, use `evaluateRendered` to confirm:
- The iframe content is the target page (not an error page)
- The target's JavaScript did not navigate the parent frame
- Interactive elements within the iframe are clickable

## 7. Iframe Injection — Basic Attack Setup

### Overlay Alignment

- Use `evaluateRendered` to inspect the target page's layout
- Match the overlay button position to the iframe's interactive element position
- Use `opacity: 0.0001` (not `display: none` or `visibility: hidden` — these prevent interaction)
- Test with `pointer-events: none` on the overlay if elements need to pass through

### Cookie Forcing via Iframe

If the target uses cookies for authentication and the victim is logged in:

1. Embed the target page in an iframe
2. The browser sends cookies automatically (session cookie, CSRF token)
3. The iframe renders the authenticated view
4. Overlay a deceptive UI that aligns with the target's action buttons

**Limitation**: If the target sets `SameSite=Strict` or `SameSite=Lax` cookies, cross-site iframe requests will not send cookies.

## 8. Cookie Forcing

### When Cookie Forcing Applies

- Target uses `SameSite=None` or no `SameSite` attribute on session cookies
- Target relies on cookies for auth (not custom headers or tokens in the URL)
- Target does not validate CSRF tokens on state-changing requests

### Technique

1. Identify the target's authentication cookie name
2. Use `getCapturedHeaders` to observe what cookies the browser sends during normal browsing
3. Craft an iframe that loads the target page — cookies are sent automatically
4. The iframe renders the authenticated state
5. Overlay deceptive UI to trick the user into clicking

### CSRF Token Bypass

- If target uses CSRF tokens embedded in forms, the iframe will load the form with a valid token
- The attacker does not need to know the token — it is present in the iframe's DOM
- Use `evaluateRendered` to extract the CSRF token from the iframe's DOM

## 9. Multi-Step Clickjacking

### Concept

Chain multiple clicks across sequential iframes or page loads to perform complex actions.

### Multi-Step Clickjacking

Chain sequential iframe loads to perform multi-step actions (e.g., change email then confirm). Each step depends on session state persisting across navigations, so validate that the session stays valid and overlay positions align across page layouts before claiming feasibility.

## 10. Drag-and-Drop Clickjacking

### HTML5 Drag-and-Drop Attacks

The `dragstart`, `drag`, and `drop` events can be triggered across iframes in some browsers.


### Use Cases

- Trick users into dragging a file upload button
- Trigger drag-and-drop file uploads to attacker-controlled endpoints
- bypass some click-jacking protections that only detect click events

## 11. Scrolljacking

### Concept

Hijack the scroll position to align different elements with the user's viewport, causing unintended interactions.

### Technique


### Detection

- Test if the page prevents default scroll behavior
- Test if scroll events are captured and redirected
- Use `evaluateRendered` to check if scroll position is being manipulated

## 12. Mobile Tapjacking

### Touch-Based Overlay Attacks

On mobile devices, tapjacking uses touch events instead of click events.

### Technique


### Mobile-Specific Considerations

- Touch events (`touchstart`, `touchend`) can be intercepted
- Some mobile browsers have additional protections against iframe overlays
- iOS Safari blocks cross-origin iframe interactions more aggressively than Android Chrome
- Test with `evaluateRendered` on both iOS and Android user agents
- Pinch-to-zoom can be used to align overlays more precisely

## 13. Testing Methodology

### Automated Detection Flow


### Manual Testing Tools

- **Burp Clickbandit**: Burp Suite extension for automated clickjacking PoC generation
- **Manual iframe injection**: Craft HTML pages with iframe + overlay
- **Browser DevTools**: Inspect frame tree, test sandbox attributes, debug overlay alignment

### Proof of Concept Checklist

- [ ] Target page renders inside iframe (not blocked by headers)
- [ ] Overlay elements align with target's interactive elements
- [ ] Click events on overlay propagate to iframe elements
- [ ] Session cookies are sent in iframe context (SameSite check)
- [ ] CSRF tokens are present in iframe-loaded forms
- [ ] Frame-busting JavaScript is absent or bypassable
- [ ] PoC page works in target browser (Chrome, Firefox, Safari, Edge)

## 14. Anti-Hallucination

- **Do not claim** a page is vulnerable to clickjacking without verifying that it actually renders inside an iframe. Headers may be present but not enforced, or absent but compensated by other protections.
- **Do not assume** frame-busting code exists or works without testing it. Many legacy pages have frame-busting code that is ineffective against modern bypass techniques.
- **Do not report** `X-Frame-Options: ALLOW-FROM` as effective protection — it is deprecated and ignored by most modern browsers.
- **Do not assume** cookies are sent in cross-origin iframes — always verify `SameSite` attribute values from captured headers.
- **Always verify** with `evaluateRendered` that the iframe actually loads the target content, not an error page or redirect.
- **Do not claim** multi-step clickjacking is feasible without testing that session state persists across iframe navigations.
- **Do not assume** all pages on a domain have the same framing policy — test each endpoint individually.

## Trigger Conditions

Activate on state-changing or sensitive pages (password/email change, fund transfer, settings, OAuth consent, payment) where the response lacks `X-Frame-Options` or a CSP `frame-ancestors` directive, or where those headers are misconfigured/inconsistent across routes. Also trigger for drag-and-drop, scrolljacking, and mobile tapjacking on touch interfaces. Do not trigger when both `X-Frame-Options: DENY` and `frame-ancestors 'none'` are enforced, or on purely static informational pages with no actionable elements.

## Detection Approach

First inspect framing headers per endpoint (some routes omit them while others set them). If `X-Frame-Options` is missing or only `SAMEORIGIN` (and an attacker-controlled subdomain on the same eTLD+1 is feasible), and no enforced `frame-ancestors`, the page is likely frameable. Confirm by actually rendering the target inside an iframe via `evaluateRendered` — headers may be present but unenforced, or absent but compensated by effective frame-busting. Then check `SameSite` on session cookies (captured headers): if `Strict`/`Lax`, cross-site iframes won't carry cookies and impact is limited. Test frame-busting bypasses (sandbox attribute, nested frames, `top.location` setter overwrite) only after confirming the page frames. Assess impact by the state-changing action reachable while the victim is authenticated.

## Pitfalls

- Claiming vulnerability from missing headers alone without rendering the page in an iframe — headers may be ignored or compensated by JS frame-busting.
- Assuming `ALLOW-FROM` protects — it is deprecated and ignored by modern browsers.
- Forgetting `SameSite` cookie semantics — cross-site iframes may not send auth cookies, killing the attack.
- Assuming one endpoint's policy applies to all — test each route individually.
- Reporting multi-step clickjacking feasible without proving session persistence across iframe navigations.
- Treating a frame-busting script as effective without testing modern bypasses.

## Verification & Impact

CONFIRMED when `evaluateRendered` shows the target content actually loads inside an iframe (not an error/redirect), overlay events propagate to the target's interactive elements, and — for auth-dependent impact — session cookies are sent (SameSite verified). SUSPECTED when headers are missing but rendering/framing is untested, or cookies are `Strict`/`Lax` — record as candidate. Document impact by the action an attacker could induce (account takeover via email/password change, unwanted consent, fund transfer) and severity scales with the state change reachable while authenticated. Capture the PoC frame setup and rendered proof via `recordEvidence`.
