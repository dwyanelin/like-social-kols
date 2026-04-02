const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log('正在啟動瀏覽器進行手動登入...');
  // 啟動一個有介面的瀏覽器
  // 加入 channel: 'chrome' 和隱藏自動化標記的參數，來繞過 Google 的安全檢查
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chrome', // 使用系統安裝的真實 Chrome，而不是預設的開源 Chromium
    args: ['--disable-blink-features=AutomationControlled'] // 隱藏 WebDriver 標記
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 首先前往 Facebook 登入
  console.log('請在開啟的視窗中手動登入 Facebook。登入成功後我們再前往 YouTube。');
  await page.goto('https://www.facebook.com');

  // 等待使用者在控制台按 Enter 鍵表示登入完成
  console.log('👉 [Facebook] 登入完成後，請在此終端機按下 Enter 繼續...');
  await waitForKeyPress();

  // 前往 YouTube 登入
  console.log('請接著手動登入 YouTube (Google 帳號)。');
  await page.goto('https://www.youtube.com');
  console.log('👉 [YouTube] 登入完成後，請在此終端機再次按下 Enter 繼續...');
  await waitForKeyPress();

  // 儲存狀態
  console.log('正在儲存瀏覽器狀態 (Cookies, Session) 至 state.json...');
  await context.storageState({ path: 'state.json' });
  console.log('🎉 狀態已成功儲存！之後的程式可以直接延用此登入狀態。');

  await browser.close();
  process.exit(0);
})();

function waitForKeyPress() {
  return new Promise((resolve) => {
    process.stdin.once('data', function () {
      resolve();
    });
  });
}
