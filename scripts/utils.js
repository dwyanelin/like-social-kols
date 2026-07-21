const { chromium } = require('playwright');
const fs = require('fs');

/**
 * 驗證 state.json 是否存在且 Cookie 未大量過期
 * @returns {boolean} true = 可以繼續執行
 */
function validateSession() {
  if (!fs.existsSync('state.json')) {
    console.error('❌ 未找到 state.json，請先執行 `npm run login` 登入。');
    return false;
  }

  try {
    const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
    const now = Date.now() / 1000;
    const cookies = state.cookies || [];

    if (cookies.length === 0) {
      console.error('❌ state.json 中沒有任何 Cookie，請重新執行 `npm run login` 登入。');
      return false;
    }

    const expiredCount = cookies.filter(c => c.expires > 0 && c.expires < now).length;

    if (expiredCount > cookies.length * 0.5) {
      console.warn(`⚠️ 超過一半的 Cookie 已過期 (${expiredCount}/${cookies.length})，建議重新執行 \`npm run login\` 登入。`);
      return false;
    }

    return true;
  } catch (e) {
    console.error('❌ state.json 格式異常:', e.message);
    return false;
  }
}

/**
 * 建立 Playwright 瀏覽器實例
 */
async function createBrowser() {
  const channel = process.env.BROWSER_CHANNEL || undefined;
  return chromium.launch({
    headless: process.env.HEADLESS === 'true',
    ...(channel ? { channel } : {}),
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

/**
 * 建立已載入登入狀態的瀏覽器 Context
 */
async function createContext(browser) {
  return browser.newContext({
    storageState: 'state.json',
  });
}

/**
 * 從環境變數解析 URL 陣列
 */
function parseUrls(envVar) {
  const str = process.env[envVar];
  if (!str || str.includes('your-target')) return [];
  return str.split(',').map(url => url.trim()).filter(url => url);
}

module.exports = { validateSession, createBrowser, createContext, parseUrls };
