import { parseUrls } from './utils';
import 'dotenv/config';

// YouTube 官方 API 模式：用 OAuth refresh token 換 access token 後呼叫 videos.rate。
// 相比瀏覽器模擬：refresh token 不會像 cookie 一樣過期、不受前端改版影響，
// 且配額內的正常使用不會觸發風控（videos.rate 每次 50 單位，預設每日配額 10,000）。

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/youtube/v3';

export interface YouTubeApiOptions {
  urls: string[];
  /** 每個頻道最多處理幾支影片 */
  maxVideos?: number;
}

export function hasYouTubeApiCredentials(): boolean {
  return !!(
    process.env.YT_OAUTH_CLIENT_ID &&
    process.env.YT_OAUTH_CLIENT_SECRET &&
    process.env.YT_OAUTH_REFRESH_TOKEN
  );
}

async function getAccessToken(): Promise<string> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YT_OAUTH_CLIENT_ID!,
      client_secret: process.env.YT_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.YT_OAUTH_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth token 更新失敗 (${res.status}): ${await res.text()}\n` +
      '   請確認 YT_OAUTH_CLIENT_ID / YT_OAUTH_CLIENT_SECRET / YT_OAUTH_REFRESH_TOKEN，' +
      '必要時重新執行 `pnpm auth:yt` 取得新的 refresh token。');
  }
  return (await res.json() as { access_token: string }).access_token;
}

async function apiFetch(token: string, method: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<any> {
  const url = `${API_BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`YouTube API ${method} ${path} 失敗 (${res.status}): ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** 從頻道 URL 解析出 channels.list 的查詢參數（支援 @handle 與 /channel/UC... 兩種格式） */
function channelParamsFromUrl(targetUrl: string): Record<string, string> | null {
  const path = new URL(targetUrl).pathname;
  const handleMatch = path.match(/^\/(@[^/]+)/);
  if (handleMatch) return { forHandle: handleMatch[1] };
  const idMatch = path.match(/^\/channel\/([^/]+)/);
  if (idMatch) return { id: idMatch[1] };
  return null;
}

export async function autoLikeYouTubeViaApi({ urls, maxVideos = 10 }: YouTubeApiOptions): Promise<void> {
  if (!urls || urls.length === 0) {
    console.log('ℹ️ 沒有 YouTube 目標 URL，跳過。');
    return;
  }

  console.log(`🤖 啟動 YouTube 自動按讚 (官方 API 模式)，共 ${urls.length} 個目標 (每頻道最多 ${maxVideos} 支影片)...`);

  let token: string;
  try {
    token = await getAccessToken();
  } catch (e) {
    console.error(`🚫 [YT-API] ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  for (const targetUrl of urls) {
    console.log(`\n➡️ [YT-API] 目前目標: ${targetUrl}`);
    try {
      const params = channelParamsFromUrl(targetUrl);
      if (!params) {
        console.log(`⚠️ [YT-API] 無法從 URL 解析頻道（支援 youtube.com/@handle 或 /channel/UC...）: ${targetUrl}`);
        continue;
      }

      // 頻道 → 上傳清單 → 最新影片
      const channels = await apiFetch(token, 'GET', '/channels', { part: 'contentDetails,snippet', ...params });
      const channel = channels.items?.[0];
      if (!channel) {
        console.log('⚠️ [YT-API] 找不到頻道。');
        continue;
      }
      const uploadsPlaylist: string = channel.contentDetails.relatedPlaylists.uploads;

      const playlist = await apiFetch(token, 'GET', '/playlistItems', {
        part: 'contentDetails',
        playlistId: uploadsPlaylist,
        maxResults: String(Math.min(maxVideos, 50)),
      });
      const videoIds: string[] = (playlist.items || []).map((i: any) => i.contentDetails.videoId).slice(0, maxVideos);
      console.log(`🎥 [YT-API] 頻道「${channel.snippet.title}」最新 ${videoIds.length} 支影片，檢查按讚狀態...`);

      if (videoIds.length === 0) continue;

      // 查詢哪些還沒按過讚
      const ratings = await apiFetch(token, 'GET', '/videos/getRating', { id: videoIds.join(',') });
      const notLiked: string[] = (ratings.items || [])
        .filter((r: any) => r.rating !== 'like')
        .map((r: any) => r.videoId);

      if (notLiked.length === 0) {
        console.log('ℹ️ [YT-API] 這些影片全都按過讚了，跳到下一個目標。');
        continue;
      }

      let likeCount = 0;
      for (const videoId of notLiked) {
        await apiFetch(token, 'POST', '/videos/rate', { id: videoId, rating: 'like' });
        likeCount++;
        console.log(`🎉 [YT-API] https://youtu.be/${videoId} 按讚成功！(${likeCount}/${notLiked.length})`);
        await new Promise(r => setTimeout(r, 300));
      }

      console.log(`📊 [YT-API] 目標 [${targetUrl}] 結束，共實際按了 ${likeCount} 個讚`);
    } catch (e) {
      console.error(`❌ [YT-API] 處理 ${targetUrl} 時發生錯誤: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }

  console.log('✅ YouTube (API) 任務結束');
}

export default autoLikeYouTubeViaApi;

// 若直接執行此檔案
if (require.main === module) {
  if (!hasYouTubeApiCredentials()) {
    console.error('❌ 缺少 YT_OAUTH_CLIENT_ID / YT_OAUTH_CLIENT_SECRET / YT_OAUTH_REFRESH_TOKEN，請先執行 `pnpm auth:yt`。');
    process.exit(1);
  }
  autoLikeYouTubeViaApi({ urls: parseUrls('YT_TARGET_URLS') });
}
