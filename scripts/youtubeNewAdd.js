const { chromium } = require('playwright');
require('dotenv').config();
const fs = require('fs');

async function autoLikeYouTubeNewAdd() {
  if (!fs.existsSync('state.json')) {
    console.error('❌ 未找到 state.json，請先執行 `node scripts/login.js` 登入。');
    return;
  }

  const targetUrlsStr = process.env.YT_TARGET_URLS_NEW_ADD;
  if (!targetUrlsStr || targetUrlsStr.includes('target1')) {
    console.log('請先在 .env 中設定 YT_TARGET_URLS_NEW_ADD');
    return;
  }

  const targetUrls = targetUrlsStr.split(',').map(url => url.trim()).filter(url => url);
  console.log(`🤖 啟動 YouTube 自動按讚 (NewAdd) 腳本，共有 ${targetUrls.length} 個目標...`);
  
  const browser = await chromium.launch({
    headless: process.env.HEADLESS === 'true',
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const context = await browser.newContext({
    storageState: 'state.json',
  });
  
  const page = await context.newPage();

  try {
    for (let targetUrl of targetUrls) {
      console.log(`\n➡️ 目前目標: ${targetUrl}`);
      // 進入使用者頻道影片列表
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      
      // 由於一開始只會載入 20-30 支，要拿到 50 支影片我們需要至少捲動一次頁面到底部
      console.log('⏳ 正在等待與捲動載入 50 支以上影片...');
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.scrollBy(0, 2000));
      await page.waitForTimeout(1500);
      
      // 選取前 50 支影片的連結
      const videoThumbnails = await page.$$('ytd-rich-item-renderer a#video-title-link');
      console.log(`🎥 頁面上找到 ${videoThumbnails.length} 支影片縮圖，準備處理前 50 支...`);
      const topVideos = videoThumbnails.slice(0, 50); // 取前 50 支
      
      if (topVideos.length > 0) {
        console.log(`🎥 成功拿到 ${topVideos.length} 支影片連結，準備輪流處理...`);
        
        // 收集要前往的網址（先收集起來，避免跳轉頁面後元素遺失）
        const videoHrefs = [];
        for (let thumb of topVideos) {
          const href = await thumb.getAttribute('href');
          if (href) videoHrefs.push(href);
        }

        let likeCount = 0;
        let notLikedConsecutiveCount = 0;

        for (let i = 0; i < videoHrefs.length; i++) {
          console.log(`\n▶️ 準備進入第 ${i + 1} 支影片...`);
          await page.goto('https://www.youtube.com' + videoHrefs[i], { waitUntil: 'domcontentloaded' });
          
          await page.waitForTimeout(3000);
          
          // 尋找主播放器下方尚未被按下的讚按鈕
          const likeButton = await page.$('ytd-watch-metadata like-button-view-model button[aria-pressed="false"]');
          
          if (likeButton) {
             try {
               console.log(`👍 正在點擊第 ${i + 1} 支影片的讚...`);
               
               // 先嘗試真實滑鼠點擊，被擋住才換 JS 強制點擊 (平衡做法)
               try {
                 await likeButton.scrollIntoViewIfNeeded({ timeout: 3000 });
                 await page.waitForTimeout(500);
                 await likeButton.click({ timeout: 5000 });
               } catch (err) {
                 console.log('   (真實點擊受阻或超時，改用 JS 強制點擊...)');
                 await likeButton.evaluate(b => b.click());
               }
               
               await page.waitForTimeout(2000); // 留給系統記錄點讚狀態的時間
               console.log(`🎉 第 ${i + 1} 支 YouTube 影片按讚成功！`);
               likeCount++;
               notLikedConsecutiveCount = 0;
             } catch (e) {
                 console.log(`⚠️ 點擊失敗: ${e.message}`);
             }
          } else {
             console.log(`ℹ️ 未找到有效的按讚按鈕，這支影片可能已經按過讚了。`);
             notLikedConsecutiveCount++;
             
             // 如果連續 3 支影片都發現已經按過讚，判斷沒有新影片，提早跳出
             if (notLikedConsecutiveCount >= 3) {
                console.log('ℹ️ 連續 3 支影片皆已按過讚，判斷後面無新片，提早結束此目標...');
                break;
             }
          }
        }

        console.log(`\n📊 目標 [${targetUrl}] 結束，共實際按了 ${likeCount} 個讚`);

      } else {
         console.log('⚠️ 在頻道頁面上找不到任何影片。');
      }
    }

  } catch (error) {
    console.error('❌ YouTube 腳本發生錯誤:', error);
  } finally {
    await browser.close();
    console.log('✅ YouTube 任務結束');
  }
}

module.exports = autoLikeYouTubeNewAdd;

// 若直接執行此檔案
if (require.main === module) {
  autoLikeYouTubeNewAdd();
}
