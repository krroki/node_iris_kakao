// Usage: node scripts/capture_next_error.js http://localhost:3100 [outfile]
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2] || 'http://localhost:3100';
  const out = process.argv[3] || 'next_error.png';
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // give Next error overlay time to render client-side
    await page.waitForTimeout(1200);
    // Try to detect Next.js error overlay text
    let text = await page.evaluate(() => document.body.innerText.slice(0, 4000));
    const html = await page.content();
    await page.screenshot({ path: out, fullPage: true });
    console.log('URL:', url);
    console.log('STATUS:', resp ? resp.status() : 'no-response');
    console.log('SNIPPET_START');
    console.log(text);
    console.log('SNIPPET_END');
    console.log('HTML_START');
    console.log(html.slice(0, 8000));
    console.log('HTML_END');
  } catch (e) {
    console.error('CAPTURE_FAILED:', e && e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
