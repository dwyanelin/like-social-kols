import http from 'http';
import { exec } from 'child_process';
import 'dotenv/config';

// 一次性 OAuth 授權流程：取得 YouTube API 的 refresh token。
// 前置：在 Google Cloud Console 建立專案 → 啟用「YouTube Data API v3」→
// 建立 OAuth 用戶端（類型選「電腦版應用程式」），把 client id/secret 填進 .env。

const PORT = 8321;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

const clientId = process.env.YT_OAUTH_CLIENT_ID;
const clientSecret = process.env.YT_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('❌ 請先在 .env 填入 YT_OAUTH_CLIENT_ID 與 YT_OAUTH_CLIENT_SECRET。');
  console.error('   取得方式: https://console.cloud.google.com/apis/credentials');
  console.error('   1. 建立專案 → 啟用「YouTube Data API v3」');
  console.error('   2. OAuth 同意畫面：User type 選「外部」，測試使用者加入自己的 Google 帳號');
  console.error('   3. 建立憑證 → OAuth 用戶端 ID → 類型選「電腦版應用程式」');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', REDIRECT_URI);
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('授權失敗：沒有收到 code。');
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json() as { refresh_token?: string; error_description?: string };

  if (!tokens.refresh_token) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('交換 token 失敗，請看終端機輸出。');
    console.error('❌ 沒有拿到 refresh token:', JSON.stringify(tokens));
    process.exit(1);
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('✅ 授權成功！可以關閉這個分頁，回到終端機。');
  console.log('\n🎉 取得 refresh token 成功！請完成以下兩步：');
  console.log('\n1. 加入 .env：');
  console.log(`   YT_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\n2. 更新 GitHub Secrets（三個都要）：');
  console.log('   gh secret set YT_OAUTH_CLIENT_ID / YT_OAUTH_CLIENT_SECRET / YT_OAUTH_REFRESH_TOKEN');
  console.log('   （或到 Repo → Settings → Secrets and variables → Actions 手動新增）');
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log('請在瀏覽器完成 Google 授權（選擇你要用來按讚的帳號）：\n');
  console.log(authUrl + '\n');
  exec(`open "${authUrl}"`); // macOS 自動開啟瀏覽器
});
