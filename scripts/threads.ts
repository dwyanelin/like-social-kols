import { createBrowser, createContext, saveStorageState, parseUrls, validatePlatformSessions, humanDelayMs, jitter } from './utils';
import 'dotenv/config';

export interface ThreadsOptions {
  urls: string[];
  /** 最大捲動次數 */
  maxScrolls?: number;
  /** 最大按讚數 */
  maxClicks?: number;
}

const LOGGED_IN_SELECTOR = [
  'a[href="/activity"]',
  'a[href="/liked/"]',
  'svg[aria-label="通知"]',
  'svg[aria-label="Notifications"]',
  'svg[aria-label="訊息"]',
  'svg[aria-label="Messages"]',
  'svg[aria-label="首頁"]',
  'svg[aria-label="Home"]',
].join(', ');

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
      try {
        await page.waitForSelector('div[data-pressable-container="true"]', { timeout: 10000 });
      } catch {
        // 交給下方檢查處理
      }
      await page.waitForTimeout(2500);

      // 未登入偵測：若找不到已登入導覽列，先區分「帳號不存在/未開通(404)」與「真的未登入」
      let loggedIn = await page.$(LOGGED_IN_SELECTOR);
      if (!loggedIn) {
        const hasLoginLink = await page.$('a[href*="/login"]');
        const hasPosts = await page.$('div[data-pressable-container="true"]');
        if (!hasLoginLink && !hasPosts) {
          console.log('⚠️ [Threads] 此帳號可能尚未開通 Threads 或網址不存在，跳過。');
          continue;
        }

        console.log('🔄 [Threads] 偵測到尚未登入，嘗試使用 Instagram 連動一鍵登入...');
        try {
          await page.goto('https://www.threads.com/login', { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(4000);
          // 若導向 /login 後自動跳回首頁且已出現登入導覽列，代表其實處於已登入狀態
          if (await page.$(LOGGED_IN_SELECTOR)) {
            loggedIn = await page.$(LOGGED_IN_SELECTOR);
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('div[data-pressable-container="true"]', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(2000);
          } else {
            // 尋找 Instagram SSO 連動按鈕（包含 IG 帳號名稱）
            const ssoClicked = await page.evaluate(() => {
              const btns = document.querySelectorAll('div[role="button"]');
              for (const b of btns) {
                const txt = (b.textContent || '').trim();
                if (txt && txt !== '登入' && txt !== 'Log in' && txt !== '回報問題' && txt !== 'Report a problem') {
                  (b as HTMLElement).click();
                  return true;
                }
              }
              return false;
            });
            if (ssoClicked) {
              await page.waitForTimeout(7000);
              await saveStorageState(context);
              await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
              await page.waitForSelector('div[data-pressable-container="true"]', { timeout: 10000 }).catch(() => {});
              await page.waitForTimeout(2500);
              loggedIn = await page.$(LOGGED_IN_SELECTOR);
            }
          }
        } catch {
          // 交給下方報錯處理
        }
      }

      if (!loggedIn) {
        console.error('🚫 [Threads] 偵測到未登入狀態！Threads session 已失效，中止 Threads 任務。');
        console.error('   請在本機重新執行 `pnpm login-social`，再用 `pnpm export-state` 更新 STATE_JSON_B64 Secret。');
        process.exitCode = 1;
        break;
      }

      let clickCount = 0;
      let validPostLikeCount = 0;
      let totalPostsScanned = 0;
      let consecutiveZeroLikes = 0;

      for (let scroll = 0; scroll < maxScrolls; scroll++) {
        if (clickCount >= maxClicks) break;

        console.log(`\n⬇️ [Threads] 進行第 ${scroll + 1} 次頁面掃描與捲動...`);
        let likesThisScroll = 0;

        // 每則貼文容器內的第一顆「讚」svg（支援 <svg><title>讚</title></svg> 與 svg[aria-label="讚"]）
        const scanResult = await page.evaluate(() => {
          let scanned = 0;
          let marked = 0;
          const posts = document.querySelectorAll('div[data-pressable-container="true"]:not([data-checked="true"])');
          for (const post of posts) {
            post.setAttribute('data-checked', 'true');
            scanned++;
            const svgs = post.querySelectorAll('svg');
            for (const svg of svgs) {
              const titleEl = svg.querySelector('title');
              const label = ((titleEl ? titleEl.textContent : null) || svg.getAttribute('aria-label') || '').trim();
              if (label === '讚' || label === 'Like') {
                const btn = svg.closest('[role="button"], button');
                if (btn) {
                  btn.setAttribute('data-threads-like-target', 'true');
                  marked++;
                }
                break;
              }
              if (label === '收回讚' || label === 'Unlike') {
                break;
              }
            }
          }
          return { scanned, marked };
        });

        totalPostsScanned += scanResult.scanned;
        validPostLikeCount += scanResult.marked;

        if (scroll === 0 && scanResult.scanned === 0) {
          console.log('⚠️ [Threads] 在個人頁面上找不到任何串文，可能是尚未發文或帳號不存在。');
          break;
        }

        for (let i = 0; i < scanResult.marked && clickCount < maxClicks; i++) {
          const btn = await page.$('[data-threads-like-target="true"]');
          if (!btn) break;

          try {
            await btn.evaluate(el => el.removeAttribute('data-threads-like-target'));
            await btn.scrollIntoViewIfNeeded();
            await btn.hover();
            await page.waitForTimeout(jitter(600));
            await btn.click();
            clickCount++;
            likesThisScroll++;
            console.log(`👍 [Threads] 成功點擊第 ${clickCount} 個新貼文的讚`);
            await page.waitForTimeout(humanDelayMs());
          } catch {
            console.log('⚠️ [Threads] 處理按鈕時發生錯誤或元素已失效，跳過。');
          }
        }

        if (clickCount >= maxClicks) break;

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

      console.log(`\n📊 [Threads] 總結本次執行:`);
      console.log(`   - 累計掃描到的串文 (不重複): ${totalPostsScanned}`);
      console.log(`   - 符合「尚未按讚的串文」數量: ${validPostLikeCount}`);
      console.log(`   - 實際發生新按讚點擊數量: ${clickCount}`);

      if (clickCount === 0) {
        console.log(`ℹ️ [Threads] 該目標未找到新的按讚按鍵，可能這 ${maxScrolls} 次捲動範圍內的貼文都已經按過或尚無貼文。`);
      }
    }
  } catch (error) {
    console.error('❌ Threads 腳本發生錯誤:', error);
    process.exitCode = 1;
  } finally {
    if (!process.exitCode) {
      await saveStorageState(context);
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
