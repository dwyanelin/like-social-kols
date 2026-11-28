import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'fs';

export const PROFILE_DIR = '.chrome-profile';

export type Platform = 'facebook' | 'youtube' | 'instagram' | 'threads';

/** 本機環境是否可使用持久化 Chrome Profile（不影響日常 Chrome，且保留完整指紋與快取） */
export function usePersistentProfile(): boolean {
  return process.env.GITHUB_ACTIONS !== 'true' && fs.existsSync(PROFILE_DIR);
}

interface Cookie {
  name: string;
  value?: string;
  domain: string;
  path?: string;
  expires: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** 各平台判斷「登入是否有效」的關鍵 Cookie */
const PLATFORM_AUTH_COOKIES: Record<Platform, { domainPattern: RegExp; names: string[] }> = {
  facebook: { domainPattern: /facebook\.com$/, names: ['c_user', 'xs'] },
  youtube: { domainPattern: /(youtube|google)\.com$/, names: ['SAPISID', '__Secure-3PAPISID'] },
  instagram: { domainPattern: /instagram\.com$/, names: ['sessionid'] },
  threads: { domainPattern: /threads\.(com|net)$/, names: ['sessionid'] },
};

function readState(): { cookies: Cookie[]; origins?: unknown[] } | null {
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

/**
 * 注入至每個頁面的初始化腳本：
 * 1. 防止 tsx / esbuild 編譯時注入的 __name 在 page.evaluate 瀏覽器環境中拋出 ReferenceError
 * 2. 改由 JS 隱藏 navigator.webdriver，取代會觸發 Chrome 警告列的 --disable-blink-features=AutomationControlled
 */
export const PAGE_INIT_SCRIPT = [
  'window.__name = (fn) => fn;',
  "Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true });",
].join('\n');

/** 組合 Chrome 啟動參數：僅在 Linux CI/容器環境才加 --no-sandbox，macOS 本機保持完整沙盒且不傳入會觸發 Chrome 警告列的旗標 */
function getChromeArgs(): string[] {
  return process.platform === 'linux' ? ['--no-sandbox'] : [];
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
    chromiumSandbox: process.platform !== 'linux',
    args: getChromeArgs(),
  });
}

/** 建立已載入登入狀態的瀏覽器 Context */
export async function createContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: 'state.json',
    locale: 'zh-TW',
    // 與 zh-TW 語系一致，避免「台灣語系卻在 UTC 機房時區」這種自相矛盾的指紋
    timezoneId: 'Asia/Taipei',
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(PAGE_INIT_SCRIPT);
  return context;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

/**
 * 建立瀏覽器 Session：
 * - 本機模式（存在 .chrome-profile）：使用 launchPersistentContext，保留完整快取、IndexedDB 與裝置指紋，
 *   大幅延長 Meta 登入壽命，且與使用者日常 Chrome 完全隔離互不干擾。
 * - CI / 無 profile 模式：退回一般 launch + state.json。
 */
export async function createSession(): Promise<BrowserSession> {
  if (usePersistentProfile()) {
    const channel = process.env.BROWSER_CHANNEL || 'chrome';
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: process.env.HEADLESS === 'true',
      channel,
      chromiumSandbox: process.platform !== 'linux',
      args: getChromeArgs(),
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      viewport: { width: 1280, height: 900 },
    });
    await context.addInitScript(PAGE_INIT_SCRIPT);
    const page = context.pages()[0] ?? await context.newPage();
    return {
      context,
      page,
      close: () => context.close(),
    };
  }

  const browser = await createBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();
  return {
    context,
    page,
    close: () => browser.close(),
  };
}

/**
 * 將目前 BrowserContext 的 Cookie 與磁碟上的 state.json 合併寫回，
 * 避免多平台平行執行時互相覆蓋其他平台的最新 Cookie。
 */
export async function saveStorageState(context: BrowserContext): Promise<void> {
  try {
    const currentCookies = await context.cookies();
    const existing = fs.existsSync('state.json')
      ? JSON.parse(fs.readFileSync('state.json', 'utf8'))
      : { cookies: [], origins: [] };

    const cookieMap = new Map<string, Cookie>();
    for (const c of existing.cookies || []) {
      cookieMap.set(`${c.domain}|${c.path || '/'}|${c.name}`, c);
    }
    for (const c of currentCookies || []) {
      cookieMap.set(`${c.domain}|${c.path || '/'}|${c.name}`, c);
    }

    const merged = {
      cookies: Array.from(cookieMap.values()),
      origins: existing.origins || [],
    };
    fs.writeFileSync('state.json', JSON.stringify(merged, null, 2));
  } catch {
    // 忽略儲存過程中的非致命錯誤
  }
}

/** 從環境變數解析 URL 陣列 */
export function parseUrls(envVar: string): string[] {
  const str = process.env[envVar];
  if (!str || str.includes('your-target')) return [];
  return str.split(',').map(url => url.trim()).filter(url => url);
}

/**
 * 每次按讚之間的「擬人化」隨機間隔（毫秒）。
 * 預設為 2~5 秒，可透過環境變數 DELAY_MIN_MS / DELAY_MAX_MS 調整。
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

/**
 * 產生本機時區的固定寬度時間戳（YYYY-MM-DD HH:mm:ss），
 * 方便在 launchd.log 中直接觀察每次按讚之間的實際秒數間隔。
 */
export function formatLogTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
