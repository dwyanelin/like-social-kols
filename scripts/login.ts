import { chromium } from 'playwright';

const LOGIN_STEPS: Array<{ name: string; url: string }> = [
  { name: 'Facebook', url: 'https://www.facebook.com' },
  { name: 'Instagram', url: 'https://www.instagram.com' },
  { name: 'Threads', url: 'https://www.threads.com' },
  { name: 'YouTube (Google)', url: 'https://www.youtube.com' },
];

(async () => {
  console.log('正在啟動瀏覽器進行手動登入...');
  // 使用系統 Chrome 並隱藏自動化標記，繞過 Google 的安全檢查
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const step of LOGIN_STEPS) {
    console.log(`\n請在開啟的視窗中手動登入 ${step.name}（已登入的話直接按 Enter 跳過）。`);
    await page.goto(step.url);
    console.log(`👉 [${step.name}] 登入完成後，請在此終端機按下 Enter 繼續...`);
    await waitForKeyPress();
  }

  console.log('\n正在儲存瀏覽器狀態 (Cookies, Session) 至 state.json...');
  await context.storageState({ path: 'state.json' });
  console.log('🎉 狀態已成功儲存！');
  console.log('📤 若要更新 GitHub Actions，請接著執行 `pnpm export-state` 並依指示更新 Secret。');

  await browser.close();
  process.exit(0);
})();

function waitForKeyPress(): Promise<void> {
  return new Promise(resolve => {
    process.stdin.once('data', () => resolve());
  });
}
