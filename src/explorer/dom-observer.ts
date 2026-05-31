import type { Page } from 'playwright';
import * as crypto from 'crypto';

const TAKE_SNAPSHOT_SRC = `(function() {
function buildSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  var dt = el.getAttribute('data-testid');
  if (dt) return '[data-testid="' + CSS.escape(dt) + '"]';
  var tag = el.tagName.toLowerCase();
  var parent = el.parentElement;
  if (parent) {
    var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; });
    if (siblings.length > 1) {
      var idx = siblings.indexOf(el) + 1;
      return tag + ':nth-of-type(' + idx + ')';
    }
  }
  if (el.className && typeof el.className === 'string') {
    var cls = el.className.trim().split(/\\s+/).slice(0, 3).map(function(c) { return CSS.escape(c); }).join('.');
    return tag + '.' + cls;
  }
  return tag;
}
var forms = [];
var interactive = [];
var dialogs = [];
var overlays = [];
var inputs = [];
var iframes = [];
document.querySelectorAll('iframe').forEach(function(el) {
  var src = el.getAttribute('src');
  if (src) iframes.push({ src: src });
});
document.querySelectorAll('form').forEach(function(form, fi) {
  var fields = [];
  form.querySelectorAll('input, select, textarea').forEach(function(el) {
    fields.push({ name: el.name || el.id || 'field_' + fi + '_' + fields.length, type: (el.type || el.tagName.toLowerCase()), placeholder: (el.placeholder || ''), required: el.required || el.hasAttribute('required') });
  });
  forms.push({ selector: 'form:nth-of-type(' + (fi + 1) + ')', action: (form.action || ''), method: (form.method || 'get'), fields: fields });
});
/* Standalone inputs outside forms — common in SPAs, search bars, chat inputs, inline editors */
document.querySelectorAll('input:not(form input):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea:not(form textarea), [contenteditable]:not(form [contenteditable]):not([contenteditable="false"])').forEach(function(el) {
  var nearBtn = null;
  var parent = el.parentElement;
  if (parent) {
    var siblingBtn = parent.querySelector('button, input[type="submit"], input[type="button"], [role="button"]');
    if (siblingBtn) {
      nearBtn = buildSelector(siblingBtn);
    } else if (parent.parentElement) {
      var uncleBtn = parent.parentElement.querySelector('button, input[type="submit"], input[type="button"], [role="button"]');
      if (uncleBtn) nearBtn = buildSelector(uncleBtn);
    }
  }
  inputs.push({
    selector: buildSelector(el),
    name: el.getAttribute('name') || el.id || '',
    type: el.getAttribute('type') || (el.tagName.toLowerCase() === 'textarea' ? 'textarea' : el.getAttribute('contenteditable') ? 'contenteditable' : 'text'),
    placeholder: el.getAttribute('placeholder') || '',
    nearButton: nearBtn,
  });
});
document.querySelectorAll('a[href], button, input[type="submit"], input[type="button"], [role="button"]').forEach(function(el) {
  var tag = el.tagName.toLowerCase();
  var text = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').trim().slice(0, 100);
  interactive.push({ tag: tag, text: text, selector: buildSelector(el), href: el.tagName === 'A' ? el.getAttribute('href') : null, type: el.getAttribute('type') });
});
document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]').forEach(function(el) {
  dialogs.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', text: (el.textContent || '').trim().slice(0, 200), selector: buildSelector(el), isVisible: el.checkVisibility() });
});
document.querySelectorAll('div[class*="overlay"], div[class*="modal"], div[class*="popup"], div[class*="banner"], div[class*="cookie"], div[class*="consent"], [data-testid*="cookie"], [data-testid*="consent"], [data-testid*="modal"], [role="presentation"], [class*="backdrop"], [class*="mask"], [class*="dialog-wrapper"]').forEach(function(el) {
  var rect = el.getBoundingClientRect();
  if (rect.width > 100 && rect.height > 50) overlays.push({ selector: buildSelector(el), text: (el.textContent || '').trim().slice(0, 150), tag: el.tagName.toLowerCase() });
});
/* Position-based scan: fixed/absolute elements covering > 50% viewport */
(function() {
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var all = document.querySelectorAll('body > div, body > section, body > aside');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cs = window.getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    var z = parseInt(cs.zIndex, 10);
    if (isNaN(z) || z < 100) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width < vw * 0.3 || rect.height < vh * 0.3) continue;
    if (rect.left > vw || rect.top > vh || rect.right < 0 || rect.bottom < 0) continue;
    var existing = overlays.some(function(o) { return o.selector === buildSelector(el); });
    if (!existing) overlays.push({ selector: buildSelector(el), text: (el.textContent || '').trim().slice(0, 150), tag: el.tagName.toLowerCase() });
  }
})();
return { url: window.location.href, title: document.title, forms: forms, inputs: inputs, interactive: interactive, dialogs: dialogs, overlays: overlays, textContent: (document.body && document.body.innerText || '').slice(0, 10000), iframes: iframes };
})();`;

const FRAME_SNAPSHOT_SRC = `(function() {
function buildSelectorLocal(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  var tag = el.tagName.toLowerCase();
  var parent = el.parentElement;
  if (parent) {
    var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; });
    if (siblings.length > 1) {
      var idx = siblings.indexOf(el) + 1;
      return tag + ':nth-of-type(' + idx + ')';
    }
  }
  return tag;
}
var forms = [];
var interactive = [];
document.querySelectorAll('form').forEach(function(form, fi) {
  var fields = [];
  form.querySelectorAll('input, select, textarea').forEach(function(el) {
    fields.push({ name: el.name || el.id || 'field_' + fi + '_' + fields.length, type: (el.type || el.tagName.toLowerCase()), placeholder: (el.placeholder || ''), required: el.required || el.hasAttribute('required') });
  });
  forms.push({ selector: 'iframe form:nth-of-type(' + (fi + 1) + ')', action: (form.action || ''), method: (form.method || 'get'), fields: fields });
});
document.querySelectorAll('a[href], button').forEach(function(el) {
  var tag = el.tagName.toLowerCase();
  var text = (el.textContent || '').trim().slice(0, 100);
  interactive.push({ tag: tag, text: text, selector: 'iframe ' + buildSelectorLocal(el), href: el.tagName === 'A' ? el.getAttribute('href') : null, type: null });
});
return { forms: forms, interactive: interactive };
})();`;

export interface DOMSnapshot {
  url: string;
  title: string;
  forms: Array<{
    selector: string;
    action: string;
    method: string;
    fields: Array<{ name: string; type: string; placeholder: string; required: boolean }>;
  }>;
  inputs: Array<{
    selector: string;
    name: string;
    type: string;
    placeholder: string;
    nearButton: string | null;
    resolvedParam?: string;
  }>;
  interactive: Array<{
    tag: string;
    text: string;
    selector: string;
    href: string | null;
    type: string | null;
  }>;
  dialogs: Array<{
    tag: string;
    role: string;
    text: string;
    selector: string;
    isVisible: boolean;
  }>;
  overlays: Array<{
    selector: string;
    text: string;
    tag: string;
  }>;
  textContent: string;
  hash: string;
  iframes: Array<{ src: string }>;
}

function hashSnapshot(data: Omit<DOMSnapshot, 'hash'>): string {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex').slice(0, 12);
}

export async function takeSnapshot(page: Page): Promise<DOMSnapshot> {
  const raw: any = await page.evaluate(TAKE_SNAPSHOT_SRC);
  const base: Omit<DOMSnapshot, 'hash'> = {
    url: raw.url,
    title: raw.title,
    forms: raw.forms,
    inputs: raw.inputs,
    interactive: raw.interactive,
    dialogs: raw.dialogs,
    overlays: raw.overlays,
    textContent: raw.textContent,
    iframes: raw.iframes || [],
  };

  return {
    ...base,
    hash: hashSnapshot(base),
  };
}

export function isSamePage(a: DOMSnapshot, b: DOMSnapshot): boolean {
  return a.hash === b.hash;
}

// ── DOM Diff Engine ──

export interface SnapshotDiff {
  urlChanged: { from: string; to: string } | null;
  newForms: DOMSnapshot['forms'];
  removedForms: Array<{ selector: string; action: string }>;
  newDialogs: DOMSnapshot['dialogs'];
  removedDialogs: Array<{ selector: string; role: string }>;
  newInteractive: DOMSnapshot['interactive'];
  removedInteractive: Array<{ selector: string; tag: string }>;
  textChanged: boolean;
  hashChanged: boolean;
}

export function diffSnapshots(before: DOMSnapshot, after: DOMSnapshot): SnapshotDiff {
  const urlChanged = before.url !== after.url ? { from: before.url, to: after.url } : null;
  const hashChanged = before.hash !== after.hash;
  const textChanged = before.textContent !== after.textContent;

  const beforeFormKeys = new Set(before.forms.map(f => `${f.selector}:${f.action}`));
  const afterFormKeys = new Set(after.forms.map(f => `${f.selector}:${f.action}`));
  const newForms = after.forms.filter(f => !beforeFormKeys.has(`${f.selector}:${f.action}`));
  const removedForms = before.forms
    .filter(f => !afterFormKeys.has(`${f.selector}:${f.action}`))
    .map(f => ({ selector: f.selector, action: f.action }));

  const beforeDialogKeys = new Set(before.dialogs.map(d => d.selector));
  const afterDialogKeys = new Set(after.dialogs.map(d => d.selector));
  const newDialogs = after.dialogs.filter(d => !beforeDialogKeys.has(d.selector));
  const removedDialogs = before.dialogs
    .filter(d => !afterDialogKeys.has(d.selector))
    .map(d => ({ selector: d.selector, role: d.role }));

  const beforeInteractiveKeys = new Set(before.interactive.map(i => i.selector));
  const afterInteractiveKeys = new Set(after.interactive.map(i => i.selector));
  const newInteractive = after.interactive.filter(i => !beforeInteractiveKeys.has(i.selector));
  const removedInteractive = before.interactive
    .filter(i => !afterInteractiveKeys.has(i.selector))
    .map(i => ({ selector: i.selector, tag: i.tag }));

  return { urlChanged, newForms, removedForms, newDialogs, removedDialogs, newInteractive, removedInteractive, textChanged, hashChanged };
}

export function formatDiff(diff: SnapshotDiff): string {
  const parts: string[] = [];
  if (diff.urlChanged) {
    parts.push(`Navigated: ${diff.urlChanged.from} → ${diff.urlChanged.to}`);
  }
  if (diff.newForms.length > 0) {
    parts.push(`${diff.newForms.length} new form(s) appeared`);
  }
  if (diff.removedForms.length > 0) {
    parts.push(`${diff.removedForms.length} form(s) removed`);
  }
  if (diff.newDialogs.length > 0) {
    const visibleDialogs = diff.newDialogs.filter(d => d.isVisible);
    if (visibleDialogs.length > 0) {
      parts.push(`${visibleDialogs.length} new dialog(s)/modal(s) visible`);
    }
  }
  if (diff.removedDialogs.length > 0) {
    parts.push(`${diff.removedDialogs.length} dialog(s)/modal(s) dismissed`);
  }
  if (diff.newInteractive.length > 0) {
    parts.push(`${diff.newInteractive.length} new interactive elements`);
  }
  if (diff.removedInteractive.length > 0) {
    parts.push(`${diff.removedInteractive.length} interactive elements removed`);
  }
  if (diff.textChanged && !diff.urlChanged) {
    parts.push('Page content changed without navigation');
  }
  return parts.length > 0 ? parts.join('; ') : 'No significant changes detected';
}

// ── iframe + Shadow DOM support ──

export async function takeSnapshotDeep(page: import('playwright').Page): Promise<DOMSnapshot> {
  const main = await takeSnapshot(page);

  const frames = page.frames();
  if (frames.length <= 1) return main;

  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    try {
      const frameUrl = frame.url();
      // Check if this frame's URL matches an iframe src from the main snapshot
      const matchingIframe = main.iframes.find(i => frameUrl.endsWith(i.src) || i.src.endsWith(frameUrl));
      if (matchingIframe) {
        matchingIframe.src = frameUrl;
      } else if (!main.iframes.some(i => i.src === frameUrl)) {
        main.iframes.push({ src: frameUrl });
      }

      const frameSnapshot = await frame.evaluate(FRAME_SNAPSHOT_SRC);

      var fs = frameSnapshot as { forms: any[]; interactive: any[] };
      main.forms.push(...fs.forms);
      main.interactive.push(...fs.interactive);
    } catch { /* cross-origin iframe — skip */ }
  }

  main.hash = hashSnapshot({ url: main.url, title: main.title, forms: main.forms, inputs: main.inputs, interactive: main.interactive, dialogs: main.dialogs, overlays: main.overlays, textContent: main.textContent, iframes: main.iframes });
  return main;
}


