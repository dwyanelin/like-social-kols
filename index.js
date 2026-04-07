const autoLikeFacebook = require('./scripts/facebook');
const autoLikeYouTube = require('./scripts/youtube');

async function main() {
  const now = new Date().toLocaleString();
  console.log(`\n🚀 [${now}] 開始手動執行自動按讚腳本...`);

  console.log('👉 同時啟動 Facebook 與 YouTube...');
  
  // 並行執行 (Parallel Execution)
  await Promise.all([
    autoLikeFacebook(),
    autoLikeYouTube()
  ]);

  console.log(`✅ [${new Date().toLocaleString()}] 所有按讚任務執行結束！`);
}

main();
