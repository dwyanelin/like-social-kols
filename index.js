const autoLikeFacebook = require('./scripts/facebook');
const autoLikeYouTube = require('./scripts/youtube');

async function main() {
  const now = new Date().toLocaleString();
  console.log(`\n🚀 [${now}] 開始手動執行自動按讚腳本...`);

  // 先執行 Facebook
  console.log('👉 1. Facebook...');
  await autoLikeFacebook();

  console.log('==========================');
  
  // 再執行 YouTube
  console.log('👉 2. YouTube...');
  await autoLikeYouTube();

  console.log(`✅ [${new Date().toLocaleString()}] 所有按讚任務執行結束！`);
}

main();
