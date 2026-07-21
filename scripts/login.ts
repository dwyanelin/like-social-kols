import { chromium, type BrowserContext } from 'playwright';

// 使用專用的常駐 Chrome profile（.chrome-profile/，已被 .gitignore 排除）：
// 第一次需要手動登入各平台，之後 session 會一直活在 profile 裡，
// 再次執行時已登入的平台自動跳過，只需重新匯出 state.json。
// （無法直接用日常的 Chrome 視窗：Chrome 136+ 禁止對正式 profile 進行遠端控制）
const PROFILE_DIR = '.chrome-profile';

interface LoginStep {
  name: string;
  url: string;
  /** 判斷已登入的關鍵 Cookie */
  cookie: { domainPattern: RegExp; name: string };
}

const LOGIN_STEPS: LoginStep[] = [
  { name: 'Facebook', url: 'https://www.facebook.com', cookie: { domainPattern: /facebook\.com$/, name: 'c_user' } },
  { name: 'Instagram', url: 'https://www.instagram.com', cookie: { domainPattern: /instagram\.com$/, name: 'sessionid' } },
  { name: 'Threads', url: 'https://www.threads.com', cookie: { domainPattern: /threads\.(com|net)$/, name: 'sessionid' } },
  { name: 'YouTube (Google)', url: 'https://www.youtube.com', cookie: { domainPattern: /(youtube|google)\.com$/, name: 'SAPISID' } },
];

async function isLoggedIn(context: BrowserContext, step: LoginStep): Promise<boolean> {
  const cookies = await context.cookies();
  return cookies.some(c => c.name === step.cookie.name && step.cookie.domainPattern.test(c.domain.replace(/^\./, '')));
}

(async () => {
  console.log(`正在啟動瀏覽器（使用常駐 profile: ${PROFILE_DIR}/，已登入的平台會自動跳過）...`);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome', // 使用系統 Chrome 並隱藏自動化標記，繞過 Google 的安全檢查
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? await context.newPage();

  for (const step of LOGIN_STEPS) {
    if (await isLoggedIn(context, step)) {
      console.log(`✅ [${step.name}] 已登入，跳過。`);
      continue;
    }

    console.log(`\n👉 [${step.name}] 尚未登入，請在開啟的視窗中手動登入（不用這個平台可直接按 Enter 跳過）...`);
    await page.goto(step.url);

    // 每 2 秒偵測一次登入 Cookie，出現就自動繼續；按 Enter 可跳過此平台
    const skipped = await Promise.race([
      (async () => {
        while (true) {
          try {
            if (await isLoggedIn(context, step)) return false;
          } catch {
            return true; // context 已關閉，結束輪詢
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      })(),
      waitForKeyPress().then(() => true),
    ]);

    console.log(skipped && !(await isLoggedIn(context, step))
      ? `⏭️ [${step.name}] 已跳過。`
      : `✅ [${step.name}] 偵測到登入成功！`);
  }

  console.log('\n正在儲存瀏覽器狀態 (Cookies, Session) 至 state.json...');
  await context.storageState({ path: 'state.json' });
  console.log('🎉 狀態已成功儲存！');
  console.log('📤 若要更新 GitHub Actions，請接著執行 `pnpm export-state` 並依指示更新 Secret。');
  console.log('💡 下次 Cookie 過期時再跑一次本指令即可：profile 裡的登入通常還活著，全程不用輸入帳密。');

  await context.close();
  process.exit(0);
})();

function waitForKeyPress(): Promise<void> {
  return new Promise(resolve => {
    process.stdin.once('data', () => resolve());
  });
}
