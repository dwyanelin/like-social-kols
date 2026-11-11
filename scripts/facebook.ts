import { createBrowser, createContext, saveStorageState, parseUrls, validatePlatformSessions, humanDelayMs, jitter } from './utils';
import 'dotenv/config';

export interface FacebookOptions {
  urls: string[];
  /** 最大捲動次數 */
  maxScrolls?: number;
  /** 最大按讚數 */
  maxClicks?: number;
}

// FB 貼文動作列的按讚按鈕 aria-label 已改版：
// - 未按過: 「對{粉專名}的貼文表示讚」 / 英文 "Like this post..."
// - 已按過: 「從{粉專名}的貼文移除讚」（自然被排除）
// - 留言的讚仍是 aria-label="讚" 的 16x16 小按鈕，用尺寸過濾
const LIKE_BUTTON_SELECTOR = [
  'div[role="button"][aria-label*="表示讚"]:not([data-checked="true"])',
  'div[aria-label="讚"][role="button"]:not([data-checked="true"])',
  'div[aria-label="Like"][role="button"]:not([data-checked="true"])',
].join(', ');

export async function autoLikeFacebook({ urls, maxScrolls = 10, maxClicks = 30 }: FacebookOptions): Promise<void> {
  if (!urls || urls.length === 0) {
    console.log('ℹ️ 沒有 Facebook 目標 URL，跳過。');
    return;
  }

  console.log(`🤖 啟動 Facebook 自動按讚，共 ${urls.length} 個目標 (最多捲動 ${maxScrolls} 次、按 ${maxClicks} 個讚)...`);

  const browser = await createBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    for (const targetUrl of urls) {
      console.log(`\n➡️ [FB] 目前目標: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      console.log('⏳ [FB] 正在等待頁面載入內容...');
      await page.waitForTimeout(3000);

      // 未登入 / 風控 Checkpoint 偵測：
      // 1. 若被導向 /checkpoint/、/login/、/recover/，代表觸發 Meta 安全驗證或被強制登出
      // 2. 若頁面出現 email 登入欄或頂部「登入」按鈕，代表 session 已失效
      // 必須立即中止，否則繼續連刷後面十幾個粉專會大幅加重帳號風控！
      const currentUrl = page.url();
      const isCheckpoint = /\/(checkpoint|login|recover|two_step_verification)\b/i.test(currentUrl);
      const loginWall = await page.$(
        'input[name="email"], div[role="dialog"] input[name="pass"], [aria-label="登入"][role="button"], [aria-label="Log In"][role="button"]'
      );
      if (isCheckpoint || loginWall) {
        if (isCheckpoint) {
          console.error(`🚫 [FB] 偵測到 Meta 安全驗證 (Checkpoint: ${currentUrl})！為保護帳號立即中止 Facebook 任務。`);
        } else {
          console.error('🚫 [FB] 偵測到登入頁！Facebook session 已失效，中止 Facebook 任務。');
        }
        console.error('   請在本機重新執行 `pnpm login-social`，再用 `pnpm export-state` 更新 STATE_JSON_B64 Secret。');
        process.exitCode = 1;
        break;
      }

      let clickCount = 0;
      let validPostLikeCount = 0;
      let totalLikeButtonsFound = 0;
      let consecutiveZeroLikes = 0;

      for (let scroll = 0; scroll < maxScrolls; scroll++) {
        if (clickCount >= maxClicks) break;

        console.log(`\n⬇️ [FB] 進行第 ${scroll + 1} 次頁面掃描與捲動...`);
        let likesThisScroll = 0;

        const likeButtons = await page.$$(LIKE_BUTTON_SELECTOR);
        totalLikeButtonsFound += likeButtons.length;

        for (const btn of likeButtons) {
          if (clickCount >= maxClicks) break;

          try {
            // 標記為已檢查，避免重複處理
            await btn.evaluate(el => el.setAttribute('data-checked', 'true'));

            const box = await btn.boundingBox();
            if (!box) continue;

            // 尺寸過小 = 留言的讚，跳過（貼文動作列按鈕高度約 32px）
            if (box.height < 25) continue;

            validPostLikeCount++;

            await btn.scrollIntoViewIfNeeded();
            await btn.hover();
            await page.waitForTimeout(jitter(600));
            await btn.click();
            clickCount++;
            likesThisScroll++;
            console.log(`👍 [FB] 成功點擊第 ${clickCount} 個新貼文的讚`);

            await page.waitForTimeout(humanDelayMs());
          } catch {
            console.log('⚠️ [FB] 處理按鈕時發生錯誤或元素已失效，跳過。');
          }
        }

        if (likesThisScroll === 0) {
          consecutiveZeroLikes++;
        } else {
          consecutiveZeroLikes = 0;
        }

        if (consecutiveZeroLikes >= 3) {
          console.log('ℹ️ [FB] 連續 3 次捲動都沒有按到任何一個讚，判斷近期貼文皆已按過，提早結束...');
          break;
        }

        await page.evaluate(dist => window.scrollBy(0, dist), jitter(1000));
        await page.waitForTimeout(jitter(2500));
      }

      console.log(`\n📊 [FB] 總結本次執行:`);
      console.log(`   - 累計掃描到的讚物件 (含留言，不重複): ${totalLikeButtonsFound}`);
      console.log(`   - 經過尺寸篩選，符合「尚未按讚的貼文」數量: ${validPostLikeCount}`);
      console.log(`   - 實際發生新按讚點擊數量: ${clickCount}`);

      if (clickCount === 0) {
        console.log(`ℹ️ [FB] 該目標未找到新的按讚按鍵，可能這 ${maxScrolls} 次捲動範圍內的貼文都已經按過或選擇器失效。`);
      }
    }
  } catch (error) {
    console.error('❌ Facebook 腳本發生錯誤:', error);
    process.exitCode = 1;
  } finally {
    if (!process.exitCode) {
      await saveStorageState(context);
    }
    await browser.close();
    console.log('✅ Facebook 任務結束');
  }
}

export default autoLikeFacebook;

// 若直接執行此檔案
if (require.main === module) {
  const sessions = validatePlatformSessions();
  if (!sessions || !sessions.facebook) {
    console.error('❌ Facebook 登入已失效，請重新執行 `pnpm login-social`。');
    process.exit(1);
  }
  autoLikeFacebook({ urls: parseUrls('FB_TARGET_URLS') });
}
