import { createBrowser, createContext, parseUrls, validatePlatformSessions, likeDelayMs } from './utils';
import 'dotenv/config';

export interface YouTubeOptions {
  urls: string[];
  /** 每個頻道最多處理幾支影片 */
  maxVideos?: number;
}

// YouTube 頻道頁的影片清單經歷過多次改版，新舊 DOM 都要支援：
// - 舊版: ytd-rich-item-renderer a#video-title-link
// - 2025+ 新版: yt-lockup-view-model 內的 a[href*="/watch?v="]
const VIDEO_LINK_SELECTOR = [
  'ytd-rich-item-renderer a[href*="/watch?v="]',
  'yt-lockup-view-model a[href*="/watch?v="]',
  'ytd-grid-video-renderer a[href*="/watch?v="]',
].join(', ');

const LIKE_BUTTON_SELECTOR =
  'ytd-watch-metadata like-button-view-model button[aria-pressed="false"], ' +
  'ytd-watch-metadata segmented-like-dislike-button-view-model button[aria-pressed="false"]';

export async function autoLikeYouTube({ urls, maxVideos = 10 }: YouTubeOptions): Promise<void> {
  if (!urls || urls.length === 0) {
    console.log('ℹ️ 沒有 YouTube 目標 URL，跳過。');
    return;
  }

  console.log(`🤖 啟動 YouTube 自動按讚，共 ${urls.length} 個目標 (每頻道最多 ${maxVideos} 支影片)...`);

  const browser = await createBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    for (const targetUrl of urls) {
      console.log(`\n➡️ [YT] 目前目標: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      console.log('⏳ [YT] 正在等待頁面載入內容...');
      try {
        await page.waitForSelector(VIDEO_LINK_SELECTOR, { timeout: 15000 });
      } catch {
        // 交給下方的數量檢查來回報
      }
      await page.waitForTimeout(2000);

      // 未登入偵測：頁面出現「登入」按鈕且沒有頭像。
      // 未登入時點讚只會跳出登入視窗、讚不會真的送出，繼續跑只是假成功
      const signedOut = await page.evaluate(() => {
        const avatar = document.querySelector('#avatar-btn');
        const signInLink = document.querySelector('a[href*="accounts.google.com/ServiceLogin"]');
        return !avatar && !!signInLink;
      });
      if (signedOut) {
        console.error('🚫 [YT] 偵測到未登入狀態！YouTube session 已失效，中止 YouTube 任務。');
        console.error('   請在本機重新執行 `pnpm login`，再用 `pnpm export-state` 更新 STATE_JSON_B64 Secret。');
        process.exitCode = 1;
        break;
      }

      // 如果需要超過 30 支影片，先捲動頁面載入更多
      if (maxVideos > 30) {
        await page.evaluate(() => window.scrollBy(0, 2000));
        await page.waitForTimeout(1500);
      }

      // 一個影片卡片內會有多個連結（縮圖 + 標題），用 watch id 去重
      const videoHrefs: string[] = await page.$$eval(VIDEO_LINK_SELECTOR, els => {
        const seen = new Set<string>();
        const hrefs: string[] = [];
        for (const el of els) {
          const href = el.getAttribute('href');
          if (!href) continue;
          const id = new URLSearchParams(href.split('?')[1] || '').get('v');
          if (!id || seen.has(id)) continue;
          seen.add(id);
          hrefs.push(href);
        }
        return hrefs;
      });

      console.log(`🎥 [YT] 頁面上找到 ${videoHrefs.length} 支影片，準備處理前 ${maxVideos} 支...`);
      const targets = videoHrefs.slice(0, maxVideos);

      if (targets.length === 0) {
        console.log('⚠️ [YT] 在頻道頁面上找不到任何影片，可能是選擇器失效或頁面未載入。');
        continue;
      }

      let likeCount = 0;
      let notLikedConsecutiveCount = 0;

      for (let i = 0; i < targets.length; i++) {
        console.log(`▶️ [YT] 準備進入第 ${i + 1} 支影片...`);
        await page.goto(new URL(targets[i], 'https://www.youtube.com').href, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const likeButton = await page.$(LIKE_BUTTON_SELECTOR);

        if (likeButton) {
          try {
            console.log(`👍 [YT] 正在點擊第 ${i + 1} 支影片的讚...`);
            try {
              await likeButton.scrollIntoViewIfNeeded({ timeout: 3000 });
              await page.waitForTimeout(500);
              await likeButton.click({ timeout: 5000 });
            } catch {
              console.log('   (真實點擊受阻或超時，改用 JS 強制點擊...)');
              await likeButton.evaluate(b => (b as HTMLElement).click());
            }

            await page.waitForTimeout(likeDelayMs());
            console.log(`🎉 [YT] 第 ${i + 1} 支影片按讚成功！`);
            likeCount++;
            notLikedConsecutiveCount = 0;
          } catch (e) {
            console.log(`⚠️ [YT] 點擊失敗: ${(e as Error).message}`);
          }
        } else {
          console.log(`ℹ️ [YT] 未找到第 ${i + 1} 支影片的按讚按鈕，可能已經按過讚了。`);
          notLikedConsecutiveCount++;

          if (notLikedConsecutiveCount >= 3) {
            console.log('ℹ️ [YT] 連續 3 支影片皆已按過讚，判斷後面無新片，提早結束此目標...');
            break;
          }
        }
      }

      console.log(`\n📊 [YT] 目標 [${targetUrl}] 結束，共實際按了 ${likeCount} 個讚`);
    }
  } catch (error) {
    console.error('❌ YouTube 腳本發生錯誤:', error);
  } finally {
    await browser.close();
    console.log('✅ YouTube 任務結束');
  }
}

export default autoLikeYouTube;

// 若直接執行此檔案
if (require.main === module) {
  const sessions = validatePlatformSessions();
  if (!sessions || !sessions.youtube) {
    console.error('❌ YouTube 登入已失效，請重新執行 `pnpm login`。');
    process.exit(1);
  }
  autoLikeYouTube({ urls: parseUrls('YT_TARGET_URLS') });
}
