import {
  createBrowser,
  createContext,
  saveStorageState,
  parseUrls,
  validatePlatformSessions,
  humanLikePauseMs,
  betweenTargetsDelayMs,
  jitter,
} from './utils';
import 'dotenv/config';

export interface ThreadsOptions {
  urls: string[];
  /** 最大捲動次數 */
  maxScrolls?: number;
  /** 單一帳號最大按讚數 */
  maxClicks?: number;
  /** 單次執行總按讚安全上限 */
  maxSessionClicks?: number;
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

export async function autoLikeThreads({
  urls,
  maxScrolls = 5,
  maxClicks = 10,
  maxSessionClicks,
}: ThreadsOptions): Promise<void> {
  if (!urls || urls.length === 0) {
    console.log('ℹ️ 沒有 Threads 目標 URL，跳過。');
    return;
  }

  const sessionCap =
    maxSessionClicks ?? (parseInt(process.env.THREADS_MAX_LIKES_PER_RUN || '', 10) || 100);

  console.log(
    `🤖 啟動 Threads 自動按讚，共 ${urls.length} 個目標 (每帳號最多捲動 ${maxScrolls} 次、按 ${maxClicks} 讚；單次執行安全上限 ${sessionCap} 讚)...`
  );

  const browser = await createBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  // 監聽 Threads 後端 GraphQL 按讚回應，捕捉頻率限制或錯誤
  let lastLikeApiError: string | null = null;
  page.on('response', async res => {
    try {
      const url = res.url();
      if (
        res.request().method() === 'POST' &&
        (url.includes('/api/graphql') || url.includes('/graphql/query'))
      ) {
        const status = res.status();
        if (status === 429 || status === 400 || status === 403) {
          lastLikeApiError = `HTTP ${status}`;
          return;
        }
        const text = await res.text();
        if (
          text.includes('"xdt_mark_post_like":null') ||
          text.includes('"xig_media_like":null') ||
          text.includes('"feedback_required"') ||
          text.includes('"spam":true') ||
          text.includes('5004002')
        ) {
          lastLikeApiError = text.includes('5004002')
            ? 'GraphQL 5004002 (頻率限制)'
            : 'API 拒絕按讚 (feedback_required / spam)';
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
          `\n🛡️ [Threads] 已達單次執行安全按讚上限 (${totalSessionClicks}/${sessionCap} 讚)，為保護帳號不觸發 Meta 防刷風控，主動結束本次任務。`
        );
        break;
      }

      const targetUrl = urls[uIdx];
      console.log(`\n➡️ [Threads] 目前目標 (${uIdx + 1}/${urls.length}): ${targetUrl}`);
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
          if (await page.$(LOGGED_IN_SELECTOR)) {
            loggedIn = await page.$(LOGGED_IN_SELECTOR);
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
            await page
              .waitForSelector('div[data-pressable-container="true"]', { timeout: 10000 })
              .catch(() => {});
            await page.waitForTimeout(2000);
          } else {
            const ssoClicked = await page.evaluate(() => {
              const btns = document.querySelectorAll('div[role="button"]');
              for (const b of btns) {
                const txt = (b.textContent || '').trim();
                if (
                  txt &&
                  txt !== '登入' &&
                  txt !== 'Log in' &&
                  txt !== '回報問題' &&
                  txt !== 'Report a problem'
                ) {
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
              await page
                .waitForSelector('div[data-pressable-container="true"]', { timeout: 10000 })
                .catch(() => {});
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
        console.error(
          '   請在本機重新執行 `pnpm login-social`，再用 `pnpm export-state` 更新 STATE_JSON_B64 Secret。'
        );
        process.exitCode = 1;
        break;
      }

      let clickCount = 0;
      let validPostLikeCount = 0;
      let totalPostsScanned = 0;
      let consecutiveZeroLikes = 0;

      for (let scroll = 0; scroll < maxScrolls; scroll++) {
        if (clickCount >= maxClicks || totalSessionClicks >= sessionCap || rateLimitedAbort) {
          break;
        }

        console.log(`\n⬇️ [Threads] 進行第 ${scroll + 1} 次頁面掃描與捲動...`);
        let likesThisScroll = 0;

        // 每則貼文容器內的第一顆「讚」svg（支援 <svg><title>讚</title></svg> 與 svg[aria-label="讚"]）
        const scanResult = await page.evaluate(() => {
          let scanned = 0;
          let marked = 0;
          const posts = document.querySelectorAll(
            'div[data-pressable-container="true"]:not([data-checked="true"])'
          );
          for (const post of posts) {
            post.setAttribute('data-checked', 'true');
            scanned++;
            const svgs = post.querySelectorAll('svg');
            for (const svg of svgs) {
              const titleEl = svg.querySelector('title');
              const label = (
                (titleEl ? titleEl.textContent : null) ||
                svg.getAttribute('aria-label') ||
                ''
              ).trim();
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

        for (
          let i = 0;
          i < scanResult.marked &&
          clickCount < maxClicks &&
          totalSessionClicks < sessionCap &&
          !rateLimitedAbort;
          i++
        ) {
          const btn = await page.$('[data-threads-like-target="true"]');
          if (!btn) break;

          try {
            await btn.evaluate(el => el.removeAttribute('data-threads-like-target'));
            await btn.scrollIntoViewIfNeeded();
            await btn.hover();
            await page.waitForTimeout(jitter(600));

            lastLikeApiError = null;
            await btn.click();

            // 關鍵驗證：等待 1.8 秒確認按鈕是否真正維持「收回讚」，且無跳出錯誤提示
            await page.waitForTimeout(1800);

            const verifyResult = await btn.evaluate(el => {
              const bodyText = document.body ? document.body.innerText : '';
              const hasErrorToast =
                /發生錯誤，請再試一次|請稍後再試|我們限制了某些活動|Try Again Later|We restrict certain activity|Action Blocked/i.test(
                  bodyText
                );
              const svg = el.querySelector('svg');
              let afterLabel = 'notfound';
              if (svg) {
                const titleEl = svg.querySelector('title');
                afterLabel = (
                  (titleEl ? titleEl.textContent : null) ||
                  svg.getAttribute('aria-label') ||
                  ''
                ).trim();
              }
              return { afterLabel, hasErrorToast };
            });

            const isLikedConfirmed =
              (verifyResult.afterLabel === '收回讚' || verifyResult.afterLabel === 'Unlike') &&
              !verifyResult.hasErrorToast &&
              !lastLikeApiError;

            if (isLikedConfirmed) {
              consecutiveBlockedClicks = 0;
              clickCount++;
              totalSessionClicks++;
              likesThisScroll++;
              console.log(
                `👍 [Threads] 成功點擊並確認第 ${clickCount} 個新貼文的讚 (本次總累計: ${totalSessionClicks}/${sessionCap})`
              );
              await page.waitForTimeout(humanLikePauseMs(totalSessionClicks));
            } else {
              consecutiveBlockedClicks++;
              const reason =
                lastLikeApiError ||
                (verifyResult.hasErrorToast
                  ? '畫面出現「發生錯誤 / 限制活動」提示'
                  : `愛心狀態被彈回 (${verifyResult.afterLabel})`);
              console.warn(
                `⚠️ [Threads] 按讚未生效！原因: ${reason} [連續被拒 ${consecutiveBlockedClicks}/2]`
              );

              if (consecutiveBlockedClicks >= 2) {
                console.error(
                  '\n🛑 [Threads] 偵測到 Meta 暫時限制 Threads 按讚功能（愛心彈回 / Rate Limit）！'
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
            console.log('⚠️ [Threads] 處理按鈕時發生錯誤或元素已失效，跳過。');
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
          console.log('ℹ️ [Threads] 連續 3 次捲動都沒有按到任何一個讚，判斷近期貼文皆已按過，提早結束...');
          break;
        }

        await page.evaluate(dist => window.scrollBy(0, dist), jitter(1500));
        await page.waitForTimeout(jitter(2500));
      }

      console.log(`\n📊 [Threads] 總結本次目標執行:`);
      console.log(`   - 累計掃描到的串文 (不重複): ${totalPostsScanned}`);
      console.log(`   - 符合「尚未按讚的串文」數量: ${validPostLikeCount}`);
      console.log(`   - 實際確認生效的新按讚數量: ${clickCount}`);

      if (clickCount === 0 && !rateLimitedAbort) {
        console.log(
          `ℹ️ [Threads] 該目標未找到新的按讚按鍵，可能這 ${maxScrolls} 次捲動範圍內的貼文都已經按過或尚無貼文。`
        );
      }

      if (!rateLimitedAbort && uIdx < urls.length - 1 && totalSessionClicks < sessionCap) {
        await page.waitForTimeout(betweenTargetsDelayMs(clickCount));
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
    console.log(`✅ Threads 任務結束 (本次執行共成功按讚 ${totalSessionClicks} 則)`);
  }
}

export default autoLikeThreads;

// 若直接執行此檔案
if (require.main === module) {
  const sessions = validatePlatformSessions();
  if (!sessions || (!sessions.threads && !sessions.instagram)) {
    console.error('❌ Threads 登入已失效，請重新執行 `pnpm login-social`。');
    process.exit(1);
  }
  autoLikeThreads({ urls: parseUrls('THREADS_TARGET_URLS') });
}
