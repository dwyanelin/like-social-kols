const { createBrowser, createContext, parseUrls, validateSession } = require('./utils');
require('dotenv').config();

/**
 * YouTube 自動按讚
 * @param {Object} options
 * @param {string[]} options.urls - 目標頻道 URL 陣列
 * @param {number} [options.maxVideos=10] - 每個頻道最多處理幾支影片
 */
async function autoLikeYouTube({ urls, maxVideos = 10 }) {
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
      console.log(`\n➡️ 目前目標: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      console.log('⏳ 正在等待頁面載入內容...');
      await page.waitForTimeout(3000);

      // 如果需要超過 30 支影片，先捲動頁面載入更多
      if (maxVideos > 30) {
        await page.evaluate(() => window.scrollBy(0, 2000));
        await page.waitForTimeout(1500);
      }

      const videoThumbnails = await page.$$('ytd-rich-item-renderer a#video-title-link');
      console.log(`🎥 頁面上找到 ${videoThumbnails.length} 支影片，準備處理前 ${maxVideos} 支...`);
      const topVideos = videoThumbnails.slice(0, maxVideos);

      if (topVideos.length === 0) {
        console.log('⚠️ 在頻道頁面上找不到任何影片。');
        continue;
      }

      // 先收集 URL（避免跳轉後元素遺失）
      const videoHrefs = [];
      for (const thumb of topVideos) {
        const href = await thumb.getAttribute('href');
        if (href) videoHrefs.push(href);
      }

      let likeCount = 0;
      let notLikedConsecutiveCount = 0;

      for (let i = 0; i < videoHrefs.length; i++) {
        console.log(`\n▶️ 準備進入第 ${i + 1} 支影片...`);
        await page.goto('https://www.youtube.com' + videoHrefs[i], { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const likeButton = await page.$('ytd-watch-metadata like-button-view-model button[aria-pressed="false"]');

        if (likeButton) {
          try {
            console.log(`👍 正在點擊第 ${i + 1} 支影片的讚...`);

            try {
              await likeButton.scrollIntoViewIfNeeded({ timeout: 3000 });
              await page.waitForTimeout(500);
              await likeButton.click({ timeout: 5000 });
            } catch (err) {
              console.log('   (真實點擊受阻或超時，改用 JS 強制點擊...)');
              await likeButton.evaluate(b => b.click());
            }

            await page.waitForTimeout(2000);
            console.log(`🎉 第 ${i + 1} 支 YouTube 影片按讚成功！`);
            likeCount++;
            notLikedConsecutiveCount = 0;
          } catch (e) {
            console.log(`⚠️ 點擊失敗: ${e.message}`);
          }
        } else {
          console.log(`ℹ️ 未找到第 ${i + 1} 支影片的按讚按鈕，可能已經按過讚了。`);
          notLikedConsecutiveCount++;

          if (notLikedConsecutiveCount >= 3) {
            console.log('ℹ️ 連續 3 支影片皆已按過讚，判斷後面無新片，提早結束此目標...');
            break;
          }
        }
      }

      console.log(`\n📊 目標 [${targetUrl}] 結束，共實際按了 ${likeCount} 個讚`);
    }
  } catch (error) {
    console.error('❌ YouTube 腳本發生錯誤:', error);
  } finally {
    await browser.close();
    console.log('✅ YouTube 任務結束');
  }
}

module.exports = autoLikeYouTube;

// 若直接執行此檔案
if (require.main === module) {
  if (!validateSession()) process.exit(1);
  const urls = parseUrls('YT_TARGET_URLS');
  autoLikeYouTube({ urls });
}
