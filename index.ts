import 'dotenv/config';
import autoLikeFacebook from './scripts/facebook';
import autoLikeYouTube from './scripts/youtube';
import { autoLikeYouTubeViaApi, hasYouTubeApiCredentials } from './scripts/youtubeApi';
import autoLikeInstagram from './scripts/instagram';
import autoLikeThreads from './scripts/threads';
import { validatePlatformSessions, parseUrls, type Platform } from './scripts/utils';
import { syncYouTubeSecretsToGitHub } from './scripts/syncSecrets';

async function main(): Promise<void> {
  console.log(`\n🚀 [${new Date().toLocaleString()}] 開始執行自動按讚...`);

  // 本機執行時，若 .env 的 YT_TARGET_URLS 有異動，自動同步至 GitHub Actions Secrets
  syncYouTubeSecretsToGitHub();

  const skipYouTube = process.env.SKIP_YOUTUBE === 'true';
  const skipMeta = process.env.SKIP_META === 'true';

  const fbUrls = skipMeta ? [] : parseUrls('FB_TARGET_URLS');
  const fbNewAddUrls = skipMeta ? [] : parseUrls('FB_TARGET_URLS_NEW_ADD');
  const ytUrls = skipYouTube ? [] : parseUrls('YT_TARGET_URLS');
  const ytNewAddUrls = skipYouTube ? [] : parseUrls('YT_TARGET_URLS_NEW_ADD');
  const igUrls = skipMeta ? [] : parseUrls('IG_TARGET_URLS');
  const igNewAddUrls = skipMeta ? [] : parseUrls('IG_TARGET_URLS_NEW_ADD');
  const threadsUrls = skipMeta ? [] : parseUrls('THREADS_TARGET_URLS');
  const threadsNewAddUrls = skipMeta ? [] : parseUrls('THREADS_TARGET_URLS_NEW_ADD');

  const needsBrowserSession =
    fbUrls.length + fbNewAddUrls.length +
    igUrls.length + igNewAddUrls.length +
    threadsUrls.length + threadsNewAddUrls.length > 0 ||
    (ytUrls.length + ytNewAddUrls.length > 0 && !hasYouTubeApiCredentials());

  // 僅在有平台需要瀏覽器 Cookie 時才驗證 state.json；純 YT API 模式不需要 state.json
  const sessions = needsBrowserSession ? validatePlatformSessions() : null;

  console.log(
    `📋 目標總覽: FB ${fbUrls.length}+${fbNewAddUrls.length} 個 | ` +
    `YT ${ytUrls.length}+${ytNewAddUrls.length} 個 | ` +
    `IG ${igUrls.length}+${igNewAddUrls.length} 個 | ` +
    `Threads ${threadsUrls.length}+${threadsNewAddUrls.length} 個`
  );

  // 有設定目標但登入已失效的平台：直接跳過並在最後讓流程以失敗結束，
  // 避免「默默跑完卻一個讚都沒按」
  const skipped: Platform[] = [];
  const canRun = (platform: Platform, hasTargets: boolean): boolean => {
    if (!hasTargets) return false;
    if (!sessions || !sessions[platform]) {
      console.error(`🚫 ${platform} 的登入 Cookie 不存在或已過期，跳過此平台。請重新執行 \`pnpm login-social\` 並更新 STATE_JSON_B64 Secret。`);
      skipped.push(platform);
      return false;
    }
    return true;
  };

  // 各平台並行執行；同平台內 regular → new-add 依序執行
  await Promise.all([
    (async () => {
      if (canRun('facebook', fbUrls.length + fbNewAddUrls.length > 0)) {
        if (fbUrls.length > 0) await autoLikeFacebook({ urls: fbUrls, maxScrolls: 10, maxClicks: 30 });
        if (fbNewAddUrls.length > 0) await autoLikeFacebook({ urls: fbNewAddUrls, maxScrolls: 30, maxClicks: 300 });
      }
    })(),
    (async () => {
      if (ytUrls.length + ytNewAddUrls.length === 0) return;
      // 優先走官方 API（refresh token 不過期、不受前端改版影響）；沒設定憑證才退回瀏覽器模擬
      if (hasYouTubeApiCredentials()) {
        console.log('🔑 偵測到 YouTube OAuth 憑證，使用官方 API 模式。');
        if (ytUrls.length > 0) await autoLikeYouTubeViaApi({ urls: ytUrls, maxVideos: 10 });
        if (ytNewAddUrls.length > 0) await autoLikeYouTubeViaApi({ urls: ytNewAddUrls, maxVideos: 50 });
      } else if (canRun('youtube', true)) {
        if (ytUrls.length > 0) await autoLikeYouTube({ urls: ytUrls, maxVideos: 10 });
        if (ytNewAddUrls.length > 0) await autoLikeYouTube({ urls: ytNewAddUrls, maxVideos: 50 });
      }
    })(),
    (async () => {
      if (canRun('instagram', igUrls.length + igNewAddUrls.length > 0)) {
        if (igUrls.length > 0) await autoLikeInstagram({ urls: igUrls, maxPosts: 10 });
        if (igNewAddUrls.length > 0) await autoLikeInstagram({ urls: igNewAddUrls, maxPosts: 50 });
      }
    })(),
    (async () => {
      if (canRun('threads', threadsUrls.length + threadsNewAddUrls.length > 0)) {
        if (threadsUrls.length > 0) await autoLikeThreads({ urls: threadsUrls, maxScrolls: 10, maxClicks: 30 });
        if (threadsNewAddUrls.length > 0) await autoLikeThreads({ urls: threadsNewAddUrls, maxScrolls: 30, maxClicks: 300 });
      }
    })(),
  ]);

  if (skipped.length > 0) {
    console.error(`\n❌ [${new Date().toLocaleString()}] 執行結束，但以下平台因登入失效被跳過: ${skipped.join(', ')}`);
    console.error('   請在本機執行 `pnpm login-social` 重新登入，再執行 `pnpm export-state` 更新 GitHub Secret。');
    process.exitCode = 1;
    return;
  }

  console.log(`\n✅ [${new Date().toLocaleString()}] 所有按讚任務執行結束！`);
}

main();
