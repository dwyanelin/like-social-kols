import { createBrowser, createContext, saveStorageState, parseUrls, validatePlatformSessions, humanDelayMs, jitter } from './utils';
import 'dotenv/config';

export interface InstagramOptions {
  urls: string[];
  /** 最大捲動次數 */
  maxScrolls?: number;
  /** 最大按讚數 */
  maxClicks?: number;
  /** (相容舊參數) 每個帳號最多處理幾則貼文 */
  maxPosts?: number;
}

// IG 貼文視窗的主按讚按鈕是 24x24 的 svg[aria-label="讚"]（已按過 = 「收回讚」），
// 留言的讚是 12x12 小 svg，用尺寸 >= 20 過濾
const MAIN_LIKE_MIN_SIZE = 20;

export async function autoLikeInstagram({
  urls,
  maxScrolls = 10,
  maxClicks = 30,
  maxPosts,
}: InstagramOptions): Promise<void> {
  if (!urls || urls.length === 0) {
    console.log('ℹ️ 沒有 Instagram 目標 URL，跳過。');
    return;
  }

  const effectiveMaxClicks = maxPosts ?? maxClicks;

  console.log(`🤖 啟動 Instagram 自動按讚，共 ${urls.length} 個目標 (最多捲動 ${maxScrolls} 次、按 ${effectiveMaxClicks} 個讚)...`);

  const browser = await createBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    for (const targetUrl of urls) {
      console.log(`\n➡️ [IG] 目前目標: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      console.log('⏳ [IG] 正在等待頁面載入內容...');
      try {
        await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 10000 });
      } catch {
        // 交給下方檢查處理
      }
      await page.waitForTimeout(2000);

      // 未登入 / 風控 Checkpoint 偵測
      const currentUrl = page.url();
      const isCheckpoint = /\/(challenge|accounts\/login|checkpoint|two_factor)\b/i.test(currentUrl);
      const loginForm = await page.$('input[name="username"]');
      const loggedInNav = await page.$('svg[aria-label="首頁"], svg[aria-label="Home"], a[href="/direct/inbox/"]');

      if (isCheckpoint || (loginForm && !loggedInNav)) {
        if (isCheckpoint) {
          console.error(`🚫 [IG] 偵測到安全驗證或登入轉址 (${currentUrl})！為保護帳號立即中止 Instagram 任務。`);
        } else {
          console.error('🚫 [IG] 偵測到登入頁！Instagram session 已失效，中止 Instagram 任務。');
        }
        console.error('   請在本機重新執行 `pnpm login-social`，再用 `pnpm export-state` 更新 STATE_JSON_B64 Secret。');
        process.exitCode = 1;
        break;
      }

      const seenHrefs = new Set<string>();
      let clickCount = 0;
      let validPostLikeCount = 0;
      let totalPostsScanned = 0;
      let consecutiveZeroLikes = 0;

      for (let scroll = 0; scroll < maxScrolls; scroll++) {
        if (clickCount >= effectiveMaxClicks) break;

        console.log(`\n⬇️ [IG] 進行第 ${scroll + 1} 次頁面掃描與捲動...`);
        let likesThisScroll = 0;
        let alreadyLikedUnpinnedInScroll = 0;

        // 收集目前個人頁格狀清單上的貼文/Reel 連結
        const currentHrefs: string[] = await page.$$eval('a[href*="/p/"], a[href*="/reel/"]', els => {
          const hrefs: string[] = [];
          for (const el of els) {
            const href = el.getAttribute('href');
            if (href && !hrefs.includes(href)) {
              hrefs.push(href);
            }
          }
          return hrefs;
        });

        const newHrefs = currentHrefs.filter(href => !seenHrefs.has(href));

        if (scroll === 0 && newHrefs.length === 0) {
          console.log('⚠️ [IG] 在個人頁面上找不到任何貼文，可能是帳號不公開、網址失效或尚無貼文。');
          break;
        }

        for (const href of newHrefs) {
          if (clickCount >= effectiveMaxClicks) break;

          const postLink = await page.$(`a[href="${href}"]`);
          if (!postLink) continue;

          seenHrefs.add(href);
          totalPostsScanned++;

          try {
            // 檢查是否為置頂貼文（置頂貼文常是舊文，若已按過讚不計入「連續已按讚」提早中止計數）
            const isPinned = (await postLink.$('svg[aria-label*="置頂"], svg[aria-label*="Pinned"]')) !== null;

            await postLink.scrollIntoViewIfNeeded();
            await postLink.hover();
            await page.waitForTimeout(jitter(400));
            await postLink.click();

            // 輪詢等待貼文視窗 (div[role="dialog"]) 內 24x24 的主按讚按鈕渲染完成（最長約 7.5 秒）
            let state: 'unliked' | 'liked' | 'notfound' = 'notfound';
            for (let attempt = 0; attempt < 30; attempt++) {
              state = await page.evaluate((minSize) => {
                const prev = document.querySelector('[data-ig-like-target="true"]');
                if (prev) prev.removeAttribute('data-ig-like-target');

                const dialog = document.querySelector('div[role="dialog"]');
                const root = dialog || (/\/(p|reel)\//.test(location.pathname) ? document : null);
                if (!root) return 'notfound';

                const svgs = root.querySelectorAll('svg[aria-label]');
                for (const svg of svgs) {
                  const label = svg.getAttribute('aria-label');
                  const r = svg.getBoundingClientRect();
                  if (r.width >= minSize && r.height >= minSize) {
                    if (label === '讚' || label === 'Like') {
                      const btn = svg.closest('[role="button"], button');
                      if (btn) {
                        btn.setAttribute('data-ig-like-target', 'true');
                        return 'unliked';
                      }
                    }
                    if (label === '收回讚' || label === 'Unlike') {
                      return 'liked';
                    }
                  }
                }
                return 'notfound';
              }, MAIN_LIKE_MIN_SIZE);

              if (state !== 'notfound') break;
              await page.waitForTimeout(250);
            }

            if (state === 'unliked') {
              validPostLikeCount++;
              await page.waitForTimeout(jitter(400));
              await page.click('[data-ig-like-target="true"]', { timeout: 5000 });
              clickCount++;
              likesThisScroll++;
              alreadyLikedUnpinnedInScroll = 0;
              console.log(`👍 [IG] 成功點擊第 ${clickCount} 個新貼文的讚`);
              await page.waitForTimeout(humanDelayMs());
            } else if (state === 'liked') {
              if (!isPinned) {
                alreadyLikedUnpinnedInScroll++;
              }
            }
          } catch {
            console.log('⚠️ [IG] 處理貼文時發生錯誤或元素已失效，跳過。');
          } finally {
            // 關閉貼文視窗回到個人頁格狀清單，保留捲動位置
            const hasDialog = (await page.$('div[role="dialog"]')) !== null;
            if (hasDialog) {
              await page.keyboard.press('Escape').catch(() => {});
              await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 3000 }).catch(async () => {
                const closeBtn = await page.$('svg[aria-label="關閉"], svg[aria-label="Close"]');
                if (closeBtn) await closeBtn.click().catch(() => {});
                await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 2000 }).catch(() => {});
              });
            } else if (/\/(p|reel)\//.test(page.url())) {
              await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
            }
            await page.waitForTimeout(jitter(500));
          }

          // 若本次捲動尚未按到任何新讚，且已連續遇到 3 則非置頂貼文都按過讚，結束本次捲動掃描並往下捲
          if (likesThisScroll === 0 && alreadyLikedUnpinnedInScroll >= 3) {
            break;
          }
        }

        if (clickCount >= effectiveMaxClicks) break;

        if (likesThisScroll === 0) {
          consecutiveZeroLikes++;
        } else {
          consecutiveZeroLikes = 0;
        }

        if (consecutiveZeroLikes >= 3) {
          console.log('ℹ️ [IG] 連續 3 次捲動都沒有按到任何一個讚，判斷近期貼文皆已按過，提早結束...');
          break;
        }

        await page.evaluate(dist => window.scrollBy(0, dist), jitter(1000));
        await page.waitForTimeout(jitter(2500));
      }

      console.log(`\n📊 [IG] 總結本次執行:`);
      console.log(`   - 累計掃描到的貼文 (不重複): ${totalPostsScanned}`);
      console.log(`   - 符合「尚未按讚的貼文」數量: ${validPostLikeCount}`);
      console.log(`   - 實際發生新按讚點擊數量: ${clickCount}`);

      if (clickCount === 0) {
        console.log(`ℹ️ [IG] 該目標未找到新的按讚按鍵，可能這 ${maxScrolls} 次捲動範圍內的貼文都已經按過或尚無貼文。`);
      }
    }
  } catch (error) {
    console.error('❌ Instagram 腳本發生錯誤:', error);
    process.exitCode = 1;
  } finally {
    if (!process.exitCode) {
      await saveStorageState(context);
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
