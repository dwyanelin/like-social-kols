import { createBrowser, createContext, parseUrls, validatePlatformSessions, humanDelayMs, jitter } from './utils';
import 'dotenv/config';

export interface InstagramOptions {
  urls: string[];
  /** 每個帳號最多處理幾則貼文 */
  maxPosts?: number;
}

// IG 貼文頁的主按讚按鈕是 24x24 的 svg[aria-label="讚"]（已按過 = 「收回讚」），
// 留言的讚是 16x16 小 svg，用尺寸過濾
const MAIN_LIKE_MIN_SIZE = 20;

export async function autoLikeInstagram({ urls, maxPosts = 10 }: InstagramOptions): Promise<void> {
  if (!urls || urls.length === 0) {
    console.log('ℹ️ 沒有 Instagram 目標 URL，跳過。');
    return;
  }

  console.log(`🤖 啟動 Instagram 自動按讚，共 ${urls.length} 個目標 (每帳號最多 ${maxPosts} 則貼文)...`);

  const browser = await createBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    for (const targetUrl of urls) {
      console.log(`\n➡️ [IG] 目前目標: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      console.log('⏳ [IG] 正在等待頁面載入內容...');
      try {
        await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 15000 });
      } catch {
        // 交給下方的數量檢查來回報
      }
      await page.waitForTimeout(2000);

      // 未登入偵測
      const loginForm = await page.$('input[name="username"]');
      if (loginForm) {
        console.error('🚫 [IG] 偵測到登入頁！Instagram session 已失效，中止 Instagram 任務。');
        console.error('   請在本機重新執行 `pnpm login-social`，再用 `pnpm export-state` 更新 STATE_JSON_B64 Secret。');
        process.exitCode = 1;
        break;
      }

      // 從個人頁的格狀清單收集貼文/Reel 連結（依頁面順序 = 新到舊）
      const postHrefs: string[] = await page.$$eval('a[href*="/p/"], a[href*="/reel/"]', els => {
        const seen = new Set<string>();
        const hrefs: string[] = [];
        for (const el of els) {
          const href = el.getAttribute('href');
          if (!href || seen.has(href)) continue;
          seen.add(href);
          hrefs.push(href);
        }
        return hrefs;
      });

      console.log(`🖼️ [IG] 頁面上找到 ${postHrefs.length} 則貼文，準備處理前 ${maxPosts} 則...`);
      const targets = postHrefs.slice(0, maxPosts);

      if (targets.length === 0) {
        console.log('⚠️ [IG] 在個人頁面上找不到任何貼文，可能是選擇器失效或帳號不公開。');
        continue;
      }

      let likeCount = 0;
      let alreadyLikedConsecutive = 0;

      for (let i = 0; i < targets.length; i++) {
        console.log(`▶️ [IG] 準備進入第 ${i + 1} 則貼文...`);
        await page.goto(new URL(targets[i], 'https://www.instagram.com').href, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(jitter(3000));

        // 找出「主」按讚按鈕（尺寸夠大的那顆），排除留言區的小讚
        const state = await page.evaluate((minSize) => {
          const pick = (labels: string[]) => {
            for (const label of labels) {
              for (const svg of document.querySelectorAll(`svg[aria-label="${label}"]`)) {
                const r = svg.getBoundingClientRect();
                if (r.width >= minSize && r.height >= minSize) return svg;
              }
            }
            return null;
          };
          const unliked = pick(['讚', 'Like']);
          if (unliked) {
            (unliked.closest('[role="button"], button') as HTMLElement | null)?.setAttribute('data-ig-like-target', 'true');
            return 'unliked';
          }
          return pick(['收回讚', 'Unlike']) ? 'liked' : 'notfound';
        }, MAIN_LIKE_MIN_SIZE);

        if (state === 'unliked') {
          try {
            console.log(`👍 [IG] 正在點擊第 ${i + 1} 則貼文的讚...`);
            await page.click('[data-ig-like-target="true"]', { timeout: 5000 });
            await page.waitForTimeout(humanDelayMs());
            console.log(`🎉 [IG] 第 ${i + 1} 則貼文按讚成功！`);
            likeCount++;
            alreadyLikedConsecutive = 0;
          } catch (e) {
            console.log(`⚠️ [IG] 點擊失敗: ${(e as Error).message}`);
          }
        } else if (state === 'liked') {
          console.log(`ℹ️ [IG] 第 ${i + 1} 則貼文已經按過讚了。`);
          alreadyLikedConsecutive++;
          if (alreadyLikedConsecutive >= 3) {
            console.log('ℹ️ [IG] 連續 3 則貼文皆已按過讚，判斷後面無新貼文，提早結束此目標...');
            break;
          }
        } else {
          console.log(`⚠️ [IG] 第 ${i + 1} 則貼文找不到按讚按鈕，可能是選擇器失效。`);
        }
      }

      console.log(`\n📊 [IG] 目標 [${targetUrl}] 結束，共實際按了 ${likeCount} 個讚`);
    }
  } catch (error) {
    console.error('❌ Instagram 腳本發生錯誤:', error);
  } finally {
    if (!process.exitCode) {
      await context.storageState({ path: 'state.json' }).catch(() => {});
    }
    await browser.close();
    console.log('✅ Instagram 任務結束');
  }
}

export default autoLikeInstagram;

// 若直接執行此檔案
if (require.main === module) {
  const sessions = validatePlatformSessions();
  if (!sessions || !sessions.instagram) {
    console.error('❌ Instagram 登入已失效，請重新執行 `pnpm login-social`。');
    process.exit(1);
  }
  autoLikeInstagram({ urls: parseUrls('IG_TARGET_URLS') });
}
