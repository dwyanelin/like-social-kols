import {
  createBrowser,
  createContext,
  saveStorageState,
  parseUrls,
  validatePlatformSessions,
  humanDelayMs,
  jitter,
} from './utils';
import 'dotenv/config';

export interface FacebookOptions {
  urls: string[];
  /** 最大捲動次數 */
  maxScrolls?: number;
  /** 單一帳號最大按讚數 */
  maxClicks?: number;
  /** 單次執行總按讚安全上限 */
  maxSessionClicks?: number;
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

export async function autoLikeFacebook({
  urls,
  maxScrolls = 8,
  maxClicks = 15,
  maxSessionClicks,
}: FacebookOptions): Promise<void> {
  if (!urls || urls.length === 0) {
    console.log('ℹ️ 沒有 Facebook 目標 URL，跳過。');
    return;
  }

  const sessionCap =
    maxSessionClicks ?? (parseInt(process.env.FB_MAX_LIKES_PER_RUN || '', 10) || 200);

  console.log(
    `🤖 啟動 Facebook 自動按讚，共 ${urls.length} 個目標 (每帳號最多捲動 ${maxScrolls} 次、按 ${maxClicks} 讚；單次執行安全上限 ${sessionCap} 讚)...`
  );

  const browser = await createBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  // 監聽 Facebook 後端 GraphQL 回應是否包含風控攔截 (sentry_block_data / 1404078 / 368)
  let lastLikeApiError: string | null = null;
  page.on('response', async res => {
    try {
      const url = res.url();
      if (res.request().method() === 'POST' && url.includes('/api/graphql')) {
        const status = res.status();
        if (status === 429 || status === 400 || status === 403) {
          lastLikeApiError = `HTTP ${status}`;
          return;
        }
        const text = await res.text();
        if (
          text.includes('"sentry_block_data"') ||
          text.includes('1404078') ||
          text.includes('"code":368')
        ) {
          lastLikeApiError = 'Facebook GraphQL 暫時封鎖操作 (sentry_block_data)';
        }
      }
    } catch {
      // 忽略讀取回應失敗
    }
  });

  let totalSessionClicks = 0;
  let consecutiveBlockedClicks = 0;
  let rateLimitedAbort = false;

  try {
    for (let uIdx = 0; uIdx < urls.length; uIdx++) {
      if (rateLimitedAbort) break;
      if (totalSessionClicks >= sessionCap) {
        console.log(
          `\n🛡️ [FB] 已達單次執行安全按讚上限 (${totalSessionClicks}/${sessionCap} 讚)，為保護帳號不觸發 Meta 防刷風控，主動結束本次任務。`
        );
        break;
      }

      const targetUrl = urls[uIdx];
      console.log(`\n➡️ [FB] 目前目標 (${uIdx + 1}/${urls.length}): ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      console.log('⏳ [FB] 正在等待頁面載入內容...');
      await page.waitForTimeout(3000);

      // 未登入 / 風控 Checkpoint 偵測：
      const currentUrl = page.url();
      const isCheckpoint = /\/(checkpoint|login|recover|two_step_verification)\b/i.test(currentUrl);
      const loginWall = await page.$(
        'input[name="email"], div[role="dialog"] input[name="pass"], [aria-label="登入"][role="button"], [aria-label="Log In"][role="button"]'
      );
      if (isCheckpoint || loginWall) {
        if (isCheckpoint) {
          console.error(
            `🚫 [FB] 偵測到 Meta 安全驗證 (Checkpoint: ${currentUrl})！為保護帳號立即中止 Facebook 任務。`
          );
        } else {
          console.error('🚫 [FB] 偵測到登入頁！Facebook session 已失效，中止 Facebook 任務。');
        }
        console.error(
          '   請在本機重新執行 `pnpm login-social`，再用 `pnpm export-state` 更新 STATE_JSON_B64 Secret。'
        );
        process.exitCode = 1;
        break;
      }

      let clickCount = 0;
      let validPostLikeCount = 0;
      let totalLikeButtonsFound = 0;
      let consecutiveZeroLikes = 0;

      for (let scroll = 0; scroll < maxScrolls; scroll++) {
        if (clickCount >= maxClicks || totalSessionClicks >= sessionCap || rateLimitedAbort) {
          break;
        }

        console.log(`\n⬇️ [FB] 進行第 ${scroll + 1} 次頁面掃描與捲動...`);
        let likesThisScroll = 0;

        const likeButtons = await page.$$(LIKE_BUTTON_SELECTOR);
        totalLikeButtonsFound += likeButtons.length;

        for (const btn of likeButtons) {
          if (clickCount >= maxClicks || totalSessionClicks >= sessionCap || rateLimitedAbort) {
            break;
          }

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

            lastLikeApiError = null;
            await btn.click();

            // 關鍵驗證：等待 1.8 秒確認按鈕狀態是否已變更為「移除讚 / 收回讚」，且無跳出限制對話框
            await page.waitForTimeout(1800);

            const verifyResult = await btn.evaluate(el => {
              const afterLabel = el.getAttribute('aria-label') || '';
              const dialogs = Array.from(
                document.querySelectorAll('div[role="dialog"], div[role="alert"]')
              ).map(d => d.textContent || '');
              const hasErrorDialog = dialogs.some(t =>
                /系統暫時封鎖|我們限制了某些活動|請稍後再試|發生錯誤|Temporarily Blocked|We restrict certain activity|Try Again Later/i.test(
                  t
                )
              );
              return { afterLabel, hasErrorDialog };
            });

            const isStillUnliked =
              verifyResult.afterLabel === '讚' ||
              verifyResult.afterLabel === 'Like' ||
              verifyResult.afterLabel.includes('表示讚');

            const isLikedConfirmed =
              !isStillUnliked && !verifyResult.hasErrorDialog && !lastLikeApiError;

            if (isLikedConfirmed) {
              consecutiveBlockedClicks = 0;
              clickCount++;
              totalSessionClicks++;
              likesThisScroll++;
              console.log(
                `👍 [FB] 成功點擊並確認第 ${clickCount} 個新貼文的讚 (本次總累計: ${totalSessionClicks}/${sessionCap})`
              );
              await page.waitForTimeout(humanDelayMs());
            } else {
              consecutiveBlockedClicks++;
              const reason =
                lastLikeApiError ||
                (verifyResult.hasErrorDialog
                  ? '畫面出現「系統暫時封鎖 / 限制活動」提示'
                  : `按讚狀態未變更 (${verifyResult.afterLabel})`);
              console.warn(
                `⚠️ [FB] 按讚未生效！原因: ${reason} [連續被拒 ${consecutiveBlockedClicks}/2]`
              );

              if (consecutiveBlockedClicks >= 2) {
                console.error(
                  '\n🛑 [FB] 偵測到 Meta 暫時限制 Facebook 按讚功能（按讚被彈回 / Rate Limit）！'
                );
                console.error(
                  '   保護機制已啟動：立即停止點擊（避免繼續點擊延長冷卻時間），請靜置數小時後再執行。'
                );
                rateLimitedAbort = true;
                break;
              }
              await page.waitForTimeout(5000);
            }
          } catch {
            console.log('⚠️ [FB] 處理按鈕時發生錯誤或元素已失效，跳過。');
          }
        }

        if (clickCount >= maxClicks || totalSessionClicks >= sessionCap || rateLimitedAbort) {
          break;
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

      console.log(`\n📊 [FB] 總結本次目標執行:`);
      console.log(`   - 累計掃描到的讚物件 (含留言，不重複): ${totalLikeButtonsFound}`);
      console.log(`   - 經過尺寸篩選，符合「尚未按讚的貼文」數量: ${validPostLikeCount}`);
      console.log(`   - 實際確認生效的新按讚數量: ${clickCount}`);

      if (clickCount === 0 && !rateLimitedAbort) {
        console.log(
          `ℹ️ [FB] 該目標未找到新的按讚按鍵，可能這 ${maxScrolls} 次捲動範圍內的貼文都已經按過或選擇器失效。`
        );
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
    console.log(`✅ Facebook 任務結束 (本次執行共成功按讚 ${totalSessionClicks} 則)`);
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
