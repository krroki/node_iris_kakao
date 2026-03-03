// Launch a visible Chromium, let the user login to Naver, auto-handle device prompts,
// then capture cookies and post to KB API. Saves debug screenshots and a text log.
// Env:
//  - KB_URL: KB service base (default http://127.0.0.1:8610)
//  - KB_KEEP_OPEN_MS: keep browser open after finish (default 90000)
//  - KB_DEVICE_AUTO: '1' to auto-click device registration prompts (default 1)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

function ensureDir(p){ try { fs.mkdirSync(p, { recursive: true }); } catch {} }
const logDir = path.join('logs','cookies');
ensureDir(logDir);
const logFile = path.join(logDir, 'run.log');
function log(...a){ const s = a.join(' '); console.log(s); try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${s}\n`);} catch {} }

async function shot(page, label){
  try {
    const name = `${Date.now()}_${label.replace(/[^a-zA-Z0-9_-]/g,'_')}.png`;
    const file = path.join(logDir, name);
    await page.screenshot({ path: file, fullPage: true }).catch(()=>{});
    const title = await page.title().catch(()=>'<no title>');
    log(`[shot] ${label} url=${await page.url()} title=${title} -> ${file}`);
  } catch (e){ log('[shot.error]', e?.message||e) }
}

async function maybeClickAny(page, texts){
  for (const t of texts){
    try {
      const targets = [page, ...page.frames()];
      for (const target of targets){
        const loc = target.locator(`text=${t}`).first();
        if (await loc.count()){
          log(`[click] text=${t}`);
          await loc.click({ timeout: 2000 }).catch(()=>{});
          await target.waitForTimeout(1200);
          return true;
        }
      }
    } catch (e){ log('[click.error]', t, e?.message||e) }
  }
  return false;
}

async function tryHandleDevicePrompt(page){
  if ((process.env.KB_DEVICE_AUTO||'1') !== '1') return false;
  const labels = [
    '등록', '등록안함', '등록하지 않고 계속', 'Continue without', 'Continue this browser',
    'Skip', 'Not now', '다음에', '지금 등록'
  ];
  const clicked = await maybeClickAny(page, labels);
  if (clicked) await shot(page, 'after_device_prompt');
  return clicked;
}

async function main() {
  const apiBase = process.env.KB_URL || 'http://127.0.0.1:8610';
  const keepMs = parseInt(process.env.KB_KEEP_OPEN_MS||'90000',10);
  const userDataDir = 'tmp/playwright-cafe-profile';
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1200, height: 900 },
    channel: 'chrome',
  });
  const page = await browser.newPage();
  let cookieHeader = null;
  try {
    log('[cookie] Opening Naver Cafe login page...');
    await page.goto('https://cafe.naver.com', { waitUntil: 'load', timeout: 60000 });
    await shot(page, 'opened_cafe');
    const started = Date.now();
    let lastShot = 0;
    while (Date.now() - started < 180000) {
      try {
        await tryHandleDevicePrompt(page);
        if (Date.now() - lastShot > 10000) { await shot(page, 'loop'); lastShot = Date.now(); }
        const ck = await browser.cookies();
        const want = ck.filter(c => /(^|\.naver\.com$)|(^|\.naver\.com$)/.test(c.domain));
        const hasLogin = want.some(c => /NID_SES|NID_AUT/.test(c.name));
        try {
          const resp = await page.request.get('https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json?search.clubid=30819883&search.menuid=23&search.page=1&search.perPage=5', {
            headers: { 'Referer':'https://cafe.naver.com', 'Origin':'https://cafe.naver.com', 'Accept':'application/json, text/plain, */*' },
            timeout: 8000
          });
          log('[api.probe]', resp && resp.ok() ? 'ok' : 'not-ok');
        } catch (e){ log('[api.probe.error]', e?.message||e) }
        if (hasLogin) {
          await shot(page, 'login_detected');
          cookieHeader = want.map(c => `${c.name}=${c.value}`).join('; ');
          break;
        }
      } catch (e){ log('[loop.error]', e?.message||e) }
      await page.waitForTimeout(2000);
    }
    if (!cookieHeader) {
      log('[cookie] Login not detected within timeout. Please login and retry.');
      await shot(page, 'login_timeout');
      return;
    }
    log('[cookie] Captured cookies. Posting to KB API...');
    try {
      const resp = await page.request.post(`${apiBase}/cookies`, {
        headers: { 'Content-Type': 'application/json' },
        data: { cookies: cookieHeader },
        timeout: 15000,
      });
      log('[cookie] POST /cookies status=', resp.status());
    } catch (e){ log('[cookie.post.error]', e?.message||e) }
    log('[cookie] Saved to KB. You can close this window.');
  } catch (e) {
    log('[cookie] Failed:', e?.message || e);
    await shot(page, 'error');
  } finally {
    await page.waitForTimeout(keepMs);
    try { await browser.close(); } catch {}
  }
}

main();
