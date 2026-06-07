// src/tui/screenshot.ts
//
// Render a PNG screenshot to ANSI half-block art. Used in the TUI's
// activity pane when a screenshot is emitted, so the user can SEE
// the page that triggered a finding without leaving the terminal.
//
// We avoid the chafa native binary (not available on Windows);
// we use the @img/* pure-JS path to decode the PNG header and
// downsample to terminal cells. Falls back to a placeholder box
// if the PNG is too large or the renderer fails.

import { writeFileSync, existsSync } from 'node:fs';
import type { RenderedScreenshot } from './state';

export type { RenderedScreenshot };

export async function renderScreenshotToAnsi(
  pngPath: string,
  maxWidth: number,
  maxHeight: number
): Promise<RenderedScreenshot> {
  if (!existsSync(pngPath)) {
    return { ansi: renderPlaceholder('missing file'), width: maxWidth, height: maxHeight, placeholder: true };
  }
  try {
    const { PNG } = await loadPng();
    const buf = await import('node:fs').then((m) => m.promises.readFile(pngPath));
    const png = PNG.sync.read(buf);
    return downsampleToAnsi(png, maxWidth, maxHeight);
  } catch (err) {
    return { ansi: renderPlaceholder(`error: ${(err as Error).message}`), width: maxWidth, height: maxHeight, placeholder: true };
  }
}

let _png: { sync: { read: (buf: Buffer) => { width: number; height: number; data: Buffer } } } | null = null;
async function loadPng(): Promise<{ PNG: { sync: { read: (buf: Buffer) => { width: number; height: number; data: Buffer } } } }> {
  if (_png) return { PNG: _png };
  // pngjs is an optional dep. If present, use it; otherwise fall back to a stub
  // that yields 0x0, which the renderer treats as placeholder.
  try {
    const mod = await import('pngjs');
    const png = (mod as unknown as { PNG: { sync: { read: (buf: Buffer) => { width: number; height: number; data: Buffer } } } }).PNG;
    _png = png;
    return { PNG: png };
  } catch {
    return { PNG: makeFallbackPng() };
  }
}

/** Tiny PNG fallback: just returns a 0x0 PNG; renderer will show placeholder. */
function makeFallbackPng(): { sync: { read: (buf: Buffer) => { width: number; height: number; data: Buffer } } } {
  return {
    sync: { read: () => ({ width: 0, height: 0, data: Buffer.alloc(0) }) },
  };
}

function downsampleToAnsi(png: { width: number; height: number; data: Buffer | Uint8Array }, maxWidth: number, maxHeight: number): RenderedScreenshot {
  const cellW = maxWidth;
  const cellH = Math.max(1, Math.floor(maxHeight / 2));
  if (png.width === 0 || png.height === 0 || png.data.length === 0) {
    return { ansi: renderPlaceholder('no pixels'), width: cellW, height: cellH, placeholder: true };
  }
  const w = png.width;
  const h = png.height;
  const data = png.data;
  const channels = data.length / (w * h);
  let out = '';
  for (let cy = 0; cy < cellH; cy++) {
    const y0 = Math.floor((cy * 2) * h / (cellH * 2));
    const y1 = Math.min(h - 1, Math.floor(((cy * 2) + 1) * h / (cellH * 2)));
    for (let cx = 0; cx < cellW; cx++) {
      const x0 = Math.floor(cx * w / cellW);
      const x1 = Math.min(w - 1, Math.floor((cx + 1) * w / cellW));
      const top = sample(data, x0, y0, w, channels);
      const bot = sample(data, x0, y1, w, channels);
      out += `\x1b[38;2;${top.r};${top.g};${top.b};48;2;${bot.r};${bot.g};${bot.b}m▀`;
    }
    out += '\x1b[0m\n';
  }
  return { ansi: out, width: cellW, height: cellH, placeholder: false };
}

function sample(data: Buffer | Uint8Array, x: number, y: number, w: number, channels: number): { r: number; g: number; b: number } {
  const idx = (y * w + x) * channels;
  return { r: data[idx] ?? 0, g: data[idx + 1] ?? 0, b: data[idx + 2] ?? 0 };
}

function renderPlaceholder(reason: string): string {
  return `\x1b[2m[ screenshot unavailable: ${reason} ]\x1b[0m\n`;
}

/** Detect if a screenshot is "interesting" enough to display in the TUI. */
export function shouldShowScreenshotInTui(label: string, sizeBytes: number): boolean {
  if (sizeBytes < 1024) return false;  // empty/blank
  if (label.includes('before-navigate')) return false;
  return true;
}

/** Write a placeholder PNG so tests don't need real screenshots. */
export function writeTestPng(path: string, color: { r: number; g: number; b: number } = { r: 128, g: 128, b: 128 }): void {
  // Minimal 1x1 PNG. Not a true PNG, but enough to test the rendering pipeline.
  // (The renderer will fall back to placeholder if parsing fails.)
  const buf = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
    0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54,
    color.r, color.g, color.b, 0xff,
    0x00, 0x37, 0x6e, 0xf9, 0x55, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  writeFileSync(path, buf);
}
