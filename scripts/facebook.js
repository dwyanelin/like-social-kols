const { createBrowser, createContext, parseUrls, validateSession } = require('./utils');
require('dotenv').config();

/**
 * Facebook 自動按讚
 * @param {Object} options
 * @param {string[]} options.urls - 目標 URL 陣列
 * @param {number} [options.maxScrolls=10] - 最大捲動次數
 * @param {number} [options.maxClicks=30] - 最大按讚數
 */
async function autoLikeFacebook({ urls, maxScrolls = 10, maxClicks = 30 }) {
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
      console.log(`\n➡️ 目前目標: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      console.log('⏳ 正在等待頁面載入內容...');
      await page.waitForTimeout(3000);

      let clickCount = 0;
      let validPostLikeCount = 0;
      let totalLikeButtonsFound = 0;
      let consecutiveZeroLikes = 0;

      for (let scroll = 0; scroll < maxScrolls; scroll++) {
        if (clickCount >= maxClicks) break;

        console.log(`\n⬇️ 進行第 ${scroll + 1} 次頁面掃描與捲動...`);
        let likesThisScroll = 0;

        // 尋找「讚 / Like」按鈕，排除「移除讚」和已檢查過的
        const likeButtons = await page.$$('div[aria-label="讚"][role="button"]:not([data-checked="true"]), div[aria-label="Like"][role="button"]:not([data-checked="true"])');
        totalLikeButtonsFound += likeButtons.length;

        for (const btn of likeButtons) {
          if (clickCount >= maxClicks) break;

          try {
            // 標記為已檢查，避免重複處理
            await btn.evaluate(el => el.setAttribute('data-checked', 'true'));

            const box = await btn.boundingBox();
            if (!box) continue;

            // 尺寸過小 = 留言的讚，跳過
            if (box.height < 25) continue;

            validPostLikeCount++;

            await btn.scrollIntoViewIfNeeded();
            await btn.hover();
            await page.waitForTimeout(500);
            await btn.click();
            clickCount++;
            likesThisScroll++;
            console.log(`👍 成功點擊第 ${clickCount} 個新貼文的讚`);

            const delay = parseInt(process.env.DELAY_MS) || 2000;
            await page.waitForTimeout(delay);
          } catch (err) {
            console.log('⚠️ 處理按鈕時發生錯誤或元素已失效，跳過。');
          }
        }

        if (likesThisScroll === 0) {
          consecutiveZeroLikes++;
        } else {
          consecutiveZeroLikes = 0;
        }

        if (consecutiveZeroLikes >= 3) {
          console.log('ℹ️ 連續 3 次捲動都沒有按到任何一個讚，判斷近期貼文皆已按過，提早結束...');
          break;
        }

        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(2500);
      }

      console.log(`\n📊 總結本次執行:`);
      console.log(`   - 累計掃描到的讚物件 (含留言，不重複): ${totalLikeButtonsFound}`);
      console.log(`   - 經過尺寸篩選，符合「尚未按讚的貼文」數量: ${validPostLikeCount}`);
      console.log(`   - 實際發生新按讚點擊數量: ${clickCount}`);

      if (clickCount === 0) {
        console.log(`ℹ️ 該目標未找到新的按讚按鍵，可能這 ${maxScrolls} 次捲動範圍內的貼文都已經按過或選擇器失效。`);
      }
    }
  } catch (error) {
    console.error('❌ Facebook 腳本發生錯誤:', error);
  } finally {
    await browser.close();
    console.log('✅ Facebook 任務結束');
  }
}

module.exports = autoLikeFacebook;

// 若直接執行此檔案
if (require.main === module) {
  if (!validateSession()) process.exit(1);
  const urls = parseUrls('FB_TARGET_URLS');
  autoLikeFacebook({ urls });
}
