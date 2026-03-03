// Naver auto login and cookie capture to stdout
// env: NAVER_ID, NAVER_PW
// opt: KB_LOGIN_HEADLESS(1/0), KB_LOGIN_CHANNEL(chrome|msedge|null)

const { chromium } = require('playwright-core');
const fs = require('fs');

async function main(){
  const id = (process.env.NAVER_ID||'').trim();
  const pw = (process.env.NAVER_PW||'').trim();
  if(!id || !pw){
    console.error('missing NAVER_ID/NAVER_PW');
    process.exit(2);
  }
  const headless = (process.env.KB_LOGIN_HEADLESS||'1') !== '0';
  const channel = process.env.KB_LOGIN_CHANNEL || undefined; // 'chrome' | 'msedge'

  let browser;
  try {
    browser = await chromium.launch({ headless, channel });
  } catch (e) {
    try { browser = await chromium.launch({ headless, channel: 'msedge' }); }
    catch { browser = await chromium.launch({ headless }); }
  }
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  try{
    await page.goto('https://nid.naver.com/nidlogin.login?mode=form', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const idSel = ['#id', '#id_input', 'input[name="id"]', 'input#id'];
    const pwSel = ['#pw', '#pw_input', 'input[name="pw"]', 'input[name="password"]', 'input#pw'];
    let ok=false;
    for(const s of idSel){ if(await page.$(s)) { await page.fill(s, id); ok=true; break; } }
    if(!ok) throw new Error('id_input_not_found');
    ok = false;
    for(const s of pwSel){ if(await page.$(s)) { await page.fill(s, pw); ok=true; break; } }
    if(!ok) throw new Error('pw_input_not_found');
    const btnCandidates = ['#log\\.login', 'button[type="submit"]', '.btn_login', 'text=로그인'];
    let clicked = false;
    for(const b of btnCandidates){ if(await page.$(b)) { await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }).catch(()=>{}),
      page.click(b)
    ]); clicked = true; break; } }
    if (!clicked) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
    }

    // 기기등록 페이지 자동 처리 (등록하지 않음 클릭)
    await page.waitForTimeout(2000);
    const skipDeviceSelectors = [
      'button:has-text("등록하지 않음")',
      'a:has-text("등록하지 않음")',
      '#new\\.dontsave',
      'button:has-text("나중에")',
      'a:has-text("나중에")',
      '.btn_cancel',
      'button[type="button"]:has-text("취소")',
    ];
    for (const sel of skipDeviceSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          console.log('device_registration_skip:', sel);
          await btn.click();
          await page.waitForTimeout(1500);
          break;
        }
      } catch {}
    }

    // up to 90s for login detection
    const started = Date.now();
    let got = null;
    while (Date.now() - started < 90000) {
      try {
        await page.goto('https://cafe.naver.com', { waitUntil: 'load', timeout: 60000 }).catch(()=>{});
        const ck = await ctx.cookies();
        const want = ck.filter(c => /(^|\.)naver\.com$/.test(c.domain));
        const api = await page.request.get('https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json?search.clubid=30819883&search.menuid=23&search.page=1&search.perPage=5', { headers: { 'Referer':'https://cafe.naver.com', 'Origin':'https://cafe.naver.com', 'Accept':'application/json, text/plain, */*' }, timeout: 8000 }).catch(()=>null);
        const okApi = !!(api && api.ok());
        const hasLogin = want.some(c => /NID_SES|NID_AUT|NVME/.test(c.name));
        if (hasLogin || okApi) {
          got = want.map(c => `${c.name}=${c.value}`).join('; ');
          break;
        }
      } catch {}
      await page.waitForTimeout(2000);
    }
    if (!got) {
      console.error('login_not_detected');
      process.exit(3);
    }
    if (process.env.COOKIE_OUT) {
      try { fs.writeFileSync(process.env.COOKIE_OUT, got, 'utf8'); } catch (e) { console.error('write_cookie_failed', e); }
    }
    console.log('COOKIE: ' + got);
    await browser.close();
    process.exit(0);
  }catch(e){
    console.error('auto_login_failed:', e?.message || e);
    try{ await browser.close(); }catch{}
    process.exit(1);
  }
}

main();
