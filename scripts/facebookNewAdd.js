const { chromium } = require('playwright');
require('dotenv').config();
const fs = require('fs');

async function autoLikeFacebookNewAdd() {
  if (!fs.existsSync('state.json')) {
    console.error('❌ 未找到 state.json，請先執行 `node scripts/login.js` 登入。');
    return;
  }

  const targetUrlsStr = process.env.FB_TARGET_URLS_NEW_ADD;
  if (!targetUrlsStr || targetUrlsStr.includes('target1')) {
    console.log('請先在 .env 中設定 FB_TARGET_URLS_NEW_ADD');
    return;
  }

  const targetUrls = targetUrlsStr.split(',').map(url => url.trim()).filter(url => url);
  console.log(`🤖 啟動 Facebook 自動按讚腳本，共有 ${targetUrls.length} 個目標...`);
  
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
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      
      // Facebook 載入較慢，等待一下頁面首波元素
      console.log('⏳ 正在等待頁面載入內容...');
      await page.waitForTimeout(3000);
      
      // 由於您確認了 Facebook 目前「沒按過的是 讚 (Like)」、「按過的是 移除讚 (Remove Like)」
      // 這樣我們在下面這行選擇器，就「絕對不要」去找「移除讚」和「收回讚」了！
      // 同時為了避免「留言的讚」在我們每次往下滾動時，都被重新抓出來判斷一次（因為它一直都是「讚」）
      // 我們利用 Playwright 的特異功能，用 CSS 偽類 :not([data-checked="true"]) 來排除已經檢查過的！
      
      let clickCount = 0;
      let validPostLikeCount = 0;
      let totalLikeButtonsFound = 0;
      let consecutiveZeroLikes = 0;

      // 改為邊捲動、邊搜尋、邊檢查、邊點擊的完美 Flow
      for (let scroll = 0; scroll < 30; scroll++) {
        if (clickCount >= 300) break; // 若已達標則提早結束迴圈

        console.log(`\n⬇️ 進行第 ${scroll + 1} 次頁面掃描與捲動...`);
        let likesThisScroll = 0;
        
        // 試圖尋找當下畫面中可見，且「名字是 讚/Like」、「還沒被我們檢查過」的按鈕！
        const likeButtons = await page.$$('div[aria-label="讚"][role="button"]:not([data-checked="true"]), div[aria-label="Like"][role="button"]:not([data-checked="true"])');
        
        totalLikeButtonsFound += likeButtons.length;

        for (const btn of likeButtons) {
          if (clickCount >= 300) break;

          try {
            // 第一步：一抓到這個按鈕，馬上幫它貼上一個「我們看過了」的隱形標籤
            // 這樣下一次迴圈 page.$$() 就絕對不會再把它抓出來了！
            await btn.evaluate(el => el.setAttribute('data-checked', 'true'));

            // 利用 boundingBox 檢查當前是否可見，以及大小
            const box = await btn.boundingBox();
            if (!box) continue; // 如果元素不可見就跳過
            
            if (box.height < 25) {
               // console.log('ℹ️ 尺寸過小的按讚，判定為留言，跳過...');
               continue; 
            }

            validPostLikeCount++; // 確認是我們想找的「貼文的讚」

            // 因為我們前面 $$ 已經完全排除掉「移除讚 (Remove Like)」了，
            // 只要它是大於 25px 的「讚」，它「100% 就是還沒按讚的貼文」！
            // 所以我們可以直接點擊，不需要再去驗證 isLiked 藍色或各種奇怪屬性了！
            
            // 將元素捲動到畫面中央 (確保真的能被點到，不會被 top bar 蓋住)
            await btn.scrollIntoViewIfNeeded();
            await btn.hover();
            await page.waitForTimeout(500);
            await btn.click();
            clickCount++;
            likesThisScroll++;
            console.log(`👍 成功點擊第 ${clickCount} 個新貼文的讚`);
            
            // 加入延遲，避免短時間大量點擊被 Facebook 封鎖
            const delay = parseInt(process.env.DELAY_MS) || 2000;
            await page.waitForTimeout(delay);

          } catch (err) {
            // 元素在操作瞬間消失 (Virtual DOM) 或者被擋住
            console.log('⚠️ 處理按鈕時發生錯誤或元素已失效，跳過。');
          }
        } // end of likeButtons loop

        if (likesThisScroll === 0) {
          consecutiveZeroLikes++;
        } else {
          consecutiveZeroLikes = 0;
        }

        if (consecutiveZeroLikes >= 3) {
          console.log('ℹ️ 連續 3 次捲動都沒有按到任何一個讚，判斷近期貼文皆已按過，提早結束...');
          break;
        }

        // 在這一輪檢查完後，往下捲動 1000px 讓新貼文載入，並等待渲染
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(2500);
      } // end of scroll loop
      
      console.log(`\n📊 總結本次執行:`);
      console.log(`   - 累計掃描到的讚物件 (含留言，💯不會重複): ${totalLikeButtonsFound}`);
      console.log(`   - 經過尺寸篩選，符合「尚未按讚的貼文」數量: ${validPostLikeCount}`);
      console.log(`   - 實際發生新按讚點擊數量: ${clickCount}`);

      if (clickCount === 0) {
        console.log('ℹ️ 該目標未找到新的按讚按鍵，可能這 30 次捲動範圍內的貼文都已經按過或者是選擇器失效。');
      }
    }
  } catch (error) {
    console.error('❌ Facebook 腳本發生錯誤:', error);
  } finally {
    await browser.close();
    console.log('✅ Facebook 任務結束');
  }
}

module.exports = autoLikeFacebookNewAdd;

// 若直接執行此檔案
if (require.main === module) {
  autoLikeFacebookNewAdd();
}
