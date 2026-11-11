import { createBrowser, createContext, parseUrls, validatePlatformSessions, humanDelayMs, jitter } from './utils';
import 'dotenv/config';

export interface ThreadsOptions {
  urls: string[];
  /** 最大捲動次數 */
  maxScrolls?: number;
  /** 最大按讚數 */
  maxClicks?: number;
}

export async function autoLikeThreads({ urls, maxScrolls = 10, maxClicks = 30 }: ThreadsOptions): Promise<void> {
  if (!urls || urls.length === 0) {
    console.log('ℹ️ 沒有 Threads 目標 URL，跳過。');
    return;
  }

  console.log(`🤖 啟動 Threads 自動按讚，共 ${urls.length} 個目標 (最多捲動 ${maxScrolls} 次、按 ${maxClicks} 個讚)...`);

  const browser = await createBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    for (const targetUrl of urls) {
      console.log(`\n➡️ [Threads] 目前目標: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      console.log('⏳ [Threads] 正在等待頁面載入內容...');
      await page.waitForTimeout(3000);

      // 未登入偵測：登入狀態下側欄會有「首頁」圖示
      const loggedIn = await page.$('svg[aria-label="首頁"], svg[aria-label="Home"]');
      if (!loggedIn) {
        console.error('🚫 [Threads] 偵測到未登入狀態！Threads session 已失效，中止 Threads 任務。');
        console.error('   請在本機重新執行 `pnpm login-social`，再用 `pnpm export-state` 更新 STATE_JSON_B64 Secret。');
        process.exitCode = 1;
        break;
      }

      let clickCount = 0;
      let consecutiveZeroLikes = 0;

      for (let scroll = 0; scroll < maxScrolls; scroll++) {
        if (clickCount >= maxClicks) break;

        console.log(`\n⬇️ [Threads] 進行第 ${scroll + 1} 次頁面掃描與捲動...`);
        let likesThisScroll = 0;

        // 每則貼文容器內的第一顆「讚」svg（已按過 = 「收回讚」）
        const pending = await page.evaluate(() => {
          let marked = 0;
          for (const post of document.querySelectorAll('div[data-pressable-container="true"]:not([data-checked="true"])')) {
            post.setAttribute('data-checked', 'true');
            const svg = post.querySelector('svg[aria-label="讚"], svg[aria-label="Like"]');
            const btn = svg?.closest('[role="button"], button') as HTMLElement | null;
            if (btn) {
              btn.setAttribute('data-threads-like-target', 'true');
              marked++;
            }
          }
          return marked;
        });

        for (let i = 0; i < pending && clickCount < maxClicks; i++) {
          const btn = await page.$('[data-threads-like-target="true"]');
          if (!btn) break;

          try {
            await btn.evaluate(el => el.removeAttribute('data-threads-like-target'));
            await btn.scrollIntoViewIfNeeded();
            await page.waitForTimeout(jitter(600));
            await btn.click();
            clickCount++;
            likesThisScroll++;
            console.log(`👍 [Threads] 成功點擊第 ${clickCount} 個貼文的讚`);
            await page.waitForTimeout(humanDelayMs());
          } catch {
            console.log('⚠️ [Threads] 處理按鈕時發生錯誤或元素已失效，跳過。');
          }
        }

        if (likesThisScroll === 0) {
          consecutiveZeroLikes++;
        } else {
          consecutiveZeroLikes = 0;
        }

        if (consecutiveZeroLikes >= 3) {
          console.log('ℹ️ [Threads] 連續 3 次捲動都沒有按到任何一個讚，判斷近期貼文皆已按過，提早結束...');
          break;
        }

        await page.evaluate(dist => window.scrollBy(0, dist), jitter(1500));
        await page.waitForTimeout(jitter(2500));
      }

      console.log(`\n📊 [Threads] 目標 [${targetUrl}] 結束，共實際按了 ${clickCount} 個讚`);
    }
  } catch (error) {
    console.error('❌ Threads 腳本發生錯誤:', error);
    process.exitCode = 1;
  } finally {
    if (!process.exitCode) {
      await context.storageState({ path: 'state.json' }).catch(() => {});
    }
    await browser.close();
    console.log('✅ Threads 任務結束');
  }
}

export default autoLikeThreads;

// 若直接執行此檔案
if (require.main === module) {
  const sessions = validatePlatformSessions();
  if (!sessions || !sessions.threads) {
    console.error('❌ Threads 登入已失效，請重新執行 `pnpm login-social`。');
    process.exit(1);
  }
  autoLikeThreads({ urls: parseUrls('THREADS_TARGET_URLS') });
}
