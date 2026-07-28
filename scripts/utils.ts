import { chromium, type Browser, type BrowserContext } from 'playwright';
import fs from 'fs';

export type Platform = 'facebook' | 'youtube' | 'instagram' | 'threads';

interface Cookie {
  name: string;
  domain: string;
  expires: number;
}

/** 各平台判斷「登入是否有效」的關鍵 Cookie */
const PLATFORM_AUTH_COOKIES: Record<Platform, { domainPattern: RegExp; names: string[] }> = {
  facebook: { domainPattern: /facebook\.com$/, names: ['c_user', 'xs'] },
  youtube: { domainPattern: /(youtube|google)\.com$/, names: ['SAPISID', '__Secure-3PAPISID'] },
  instagram: { domainPattern: /instagram\.com$/, names: ['sessionid'] },
  threads: { domainPattern: /threads\.(com|net)$/, names: ['sessionid'] },
};

function readState(): { cookies: Cookie[] } | null {
  if (!fs.existsSync('state.json')) {
    console.error('❌ 未找到 state.json，請先執行 `pnpm login-social` 登入。');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync('state.json', 'utf8'));
  } catch (e) {
    console.error('❌ state.json 格式異常:', (e as Error).message);
    return null;
  }
}

/**
 * 逐平台驗證 state.json 中的登入 Cookie 是否存在且未過期。
 * 回傳每個平台的有效性；state.json 缺失或損毀時回傳 null。
 */
export function validatePlatformSessions(): Record<Platform, boolean> | null {
  const state = readState();
  if (!state) return null;

  const cookies = state.cookies || [];
  if (cookies.length === 0) {
    console.error('❌ state.json 中沒有任何 Cookie，請重新執行 `pnpm login-social` 登入。');
    return null;
  }

  const now = Date.now() / 1000;
  const result = {} as Record<Platform, boolean>;

  for (const [platform, rule] of Object.entries(PLATFORM_AUTH_COOKIES)) {
    const found = rule.names.map(name =>
      cookies.find(c => c.name === name && rule.domainPattern.test(c.domain.replace(/^\./, '')))
    );
    // 至少要找到一個關鍵 Cookie，且找到的全部都不能過期
    const anyFound = found.some(Boolean);
    const anyExpired = found.some(c => c && c.expires > 0 && c.expires < now);
    result[platform as Platform] = anyFound && !anyExpired;
  }

  return result;
}

/** 建立 Playwright 瀏覽器實例 */
export async function createBrowser(): Promise<Browser> {
  // 預設走「有頭 + 真 Chrome」：headless 指紋與 Playwright 自帶 Chromium 的 UA
  // 是 Meta 最容易辨識的自動化訊號。CI 上以 xvfb 提供虛擬顯示器即可跑有頭模式。
  // 僅在明確設定 HEADLESS=true 時才無頭（不建議對 Meta 使用）。
  const channel = process.env.BROWSER_CHANNEL || 'chrome';
  return chromium.launch({
    headless: process.env.HEADLESS === 'true',
    channel,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });
}

/** 建立已載入登入狀態的瀏覽器 Context */
export async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    storageState: 'state.json',
    locale: 'zh-TW',
    // 與 zh-TW 語系一致，避免「台灣語系卻在 UTC 機房時區」這種自相矛盾的指紋
    timezoneId: 'Asia/Taipei',
    viewport: { width: 1280, height: 900 },
  });
}

/** 從環境變數解析 URL 陣列 */
export function parseUrls(envVar: string): string[] {
  const str = process.env[envVar];
  if (!str || str.includes('your-target')) return [];
  return str.split(',').map(url => url.trim()).filter(url => url);
}

/**
 * 每次按讚之間的「擬人化」隨機間隔（毫秒）。
 * 固定間隔的機械節奏是自動化偵測的明顯特徵，改為在 [DELAY_MIN_MS, DELAY_MAX_MS]
 * 之間隨機取值（預設 2~5 秒）。
 */
export function humanDelayMs(): number {
  const min = parseInt(process.env.DELAY_MIN_MS || '', 10) || 2000;
  const max = parseInt(process.env.DELAY_MAX_MS || '', 10) || 5000;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** 在基準值附近加入 ±ratio 抖動，用於捲動距離、等待時間等原本寫死的數值。 */
export function jitter(baseMs: number, ratio = 0.4): number {
  const delta = baseMs * ratio;
  return Math.round(baseMs - delta + Math.random() * delta * 2);
}

/** 隨機睡眠一段時間（毫秒），供腳本插入不規律停頓。 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
