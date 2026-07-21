require('dotenv').config();
const autoLikeFacebook = require('./scripts/facebook');
const autoLikeYouTube = require('./scripts/youtube');
const { validateSession, parseUrls } = require('./scripts/utils');

async function main() {
  const now = new Date().toLocaleString();
  console.log(`\n🚀 [${now}] 開始執行自動按讚...`);

  // 先驗證登入狀態
  if (!validateSession()) {
    process.exit(1);
  }

  // 解析所有目標 URL
  const fbUrls = parseUrls('FB_TARGET_URLS');
  const fbNewAddUrls = parseUrls('FB_TARGET_URLS_NEW_ADD');
  const ytUrls = parseUrls('YT_TARGET_URLS');
  const ytNewAddUrls = parseUrls('YT_TARGET_URLS_NEW_ADD');

  console.log(`📋 目標總覽: FB ${fbUrls.length} 個 | FB(新增) ${fbNewAddUrls.length} 個 | YT ${ytUrls.length} 個 | YT(新增) ${ytNewAddUrls.length} 個`);

  // FB 和 YT 並行執行；同平台內 regular → new-add 依序執行
  await Promise.all([
    (async () => {
      if (fbUrls.length > 0) {
        await autoLikeFacebook({ urls: fbUrls, maxScrolls: 10, maxClicks: 30 });
      }
      if (fbNewAddUrls.length > 0) {
        await autoLikeFacebook({ urls: fbNewAddUrls, maxScrolls: 30, maxClicks: 300 });
      }
    })(),
    (async () => {
      if (ytUrls.length > 0) {
        await autoLikeYouTube({ urls: ytUrls, maxVideos: 10 });
      }
      if (ytNewAddUrls.length > 0) {
        await autoLikeYouTube({ urls: ytNewAddUrls, maxVideos: 50 });
      }
    })(),
  ]);

  console.log(`\n✅ [${new Date().toLocaleString()}] 所有按讚任務執行結束！`);
}

main();
