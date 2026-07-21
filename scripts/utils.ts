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
    console.error('❌ 未找到 state.json，請先執行 `pnpm login` 登入。');
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
    console.error('❌ state.json 中沒有任何 Cookie，請重新執行 `pnpm login` 登入。');
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
  const channel = process.env.BROWSER_CHANNEL || undefined;
  return chromium.launch({
    headless: process.env.HEADLESS === 'true',
    ...(channel ? { channel } : {}),
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

/** 建立已載入登入狀態的瀏覽器 Context */
export async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    storageState: 'state.json',
    locale: 'zh-TW',
    viewport: { width: 1280, height: 900 },
  });
}

/** 從環境變數解析 URL 陣列 */
export function parseUrls(envVar: string): string[] {
  const str = process.env[envVar];
  if (!str || str.includes('your-target')) return [];
  return str.split(',').map(url => url.trim()).filter(url => url);
}

/** 每次按讚間隔（毫秒） */
export function likeDelayMs(): number {
  return parseInt(process.env.DELAY_MS || '', 10) || 2000;
}
