import 'dotenv/config';
import autoLikeFacebook from './scripts/facebook';
import autoLikeYouTube from './scripts/youtube';
import { autoLikeYouTubeViaApi, hasYouTubeApiCredentials } from './scripts/youtubeApi';
import autoLikeInstagram from './scripts/instagram';
import autoLikeThreads from './scripts/threads';
import { validatePlatformSessions, parseUrls, usePersistentProfile, type Platform } from './scripts/utils';
import { syncYouTubeSecretsToGitHub } from './scripts/syncSecrets';

async function main(): Promise<void> {
  console.log(`\n🚀 [${new Date().toLocaleString()}] 開始執行自動按讚...`);

  // 本機執行時，若 .env 的 YT_TARGET_URLS 有異動，自動同步至 GitHub Actions Secrets
  syncYouTubeSecretsToGitHub();

  const skipYouTube = process.env.SKIP_YOUTUBE === 'true';
  const skipMeta = process.env.SKIP_META === 'true';
  const skipFacebook = skipMeta || process.env.SKIP_FACEBOOK === 'true';
  const skipInstagram = skipMeta || process.env.SKIP_INSTAGRAM === 'true';
  const skipThreads = skipMeta || process.env.SKIP_THREADS === 'true';

  const fbUrls = skipFacebook ? [] : parseUrls('FB_TARGET_URLS');
  const ytUrls = skipYouTube ? [] : parseUrls('YT_TARGET_URLS');
  const igUrls = skipInstagram ? [] : parseUrls('IG_TARGET_URLS');
  const threadsUrls = skipThreads ? [] : parseUrls('THREADS_TARGET_URLS');

  const needsBrowserSession =
    fbUrls.length + igUrls.length + threadsUrls.length > 0 ||
    (ytUrls.length > 0 && !hasYouTubeApiCredentials());

  const persistentMode = usePersistentProfile();
  // 僅在無本機 .chrome-profile（例如 CI）且需要瀏覽器 Cookie 時才強制驗證 state.json
  const sessions = needsBrowserSession && !persistentMode ? validatePlatformSessions() : null;

  console.log(
    `📋 目標總覽: FB ${fbUrls.length} 個 | ` +
    `YT ${ytUrls.length} 個 | ` +
    `IG ${igUrls.length} 個 | ` +
    `Threads ${threadsUrls.length} 個`
  );
  if (needsBrowserSession && persistentMode) {
    console.log('🧩 本機模式：使用持久化 Chrome Profile (.chrome-profile/)，單視窗依序執行 FB → IG → Threads。');
  }

  // 有設定目標但登入已失效的平台：直接跳過並在最後讓流程以失敗結束，
  // 避免「默默跑完卻一個讚都沒按」
  const skipped: Platform[] = [];
  const canRun = (platform: Platform, hasTargets: boolean): boolean => {
    if (!hasTargets) return false;
    if (persistentMode) return true;
    if (!sessions || !sessions[platform]) {
      // 若 Threads 尚未有獨立 sessionid 但 Instagram 已登入，允許進入 autoLikeThreads 自動執行 IG 連動登入
      if (platform === 'threads' && sessions?.instagram) {
        return true;
      }
      console.error(`🚫 ${platform} 的登入 Cookie 不存在或已過期，跳過此平台。請重新執行 \`pnpm login-social\` 並更新 STATE_JSON_B64 Secret。`);
      skipped.push(platform);
      return false;
    }
    return true;
  };

  // 嚴格單視窗依序執行：Facebook → Instagram → Threads（→ YouTube），
  // 確保永遠同一時間只開啟 1 個瀏覽器視窗、不共用鎖定衝突，也避免併發請求觸發 Meta 風控。
  if (canRun('facebook', fbUrls.length > 0)) {
    await autoLikeFacebook({ urls: fbUrls, maxScrolls: 30, maxClicks: 120, maxSessionClicks: 120 });
  }

  if (canRun('instagram', igUrls.length > 0)) {
    await autoLikeInstagram({ urls: igUrls, maxScrolls: 30, maxClicks: 100 });
  }

  if (canRun('threads', threadsUrls.length > 0)) {
    await autoLikeThreads({ urls: threadsUrls, maxScrolls: 30, maxClicks: 150, maxSessionClicks: 150 });
  }

  if (ytUrls.length > 0) {
    // 優先走官方 API（refresh token 不過期、不受前端改版影響）；沒設定憑證才退回瀏覽器模擬
    if (hasYouTubeApiCredentials()) {
      console.log('🔑 偵測到 YouTube OAuth 憑證，使用官方 API 模式。');
      await autoLikeYouTubeViaApi({ urls: ytUrls, maxVideos: 100 });
    } else if (canRun('youtube', true)) {
      await autoLikeYouTube({ urls: ytUrls, maxVideos: 100 });
    }
  }

  if (skipped.length > 0) {
    console.error(`\n❌ [${new Date().toLocaleString()}] 執行結束，但以下平台因登入失效被跳過: ${skipped.join(', ')}`);
    console.error('   請在本機執行 `pnpm login-social` 重新登入，再執行 `pnpm export-state` 更新 GitHub Secret。');
    process.exitCode = 1;
    return;
  }

  console.log(`\n✅ [${new Date().toLocaleString()}] 所有按讚任務執行結束！`);
}

main();
