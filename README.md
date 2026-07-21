# LikeFbAndYoutube

自動對你支持的 KOL 在 Facebook 和 YouTube 上按讚，節省每天手動按讚的時間。

## 功能

- **Facebook** — 自動捲動粉專/個人頁，對尚未按讚的貼文按讚
- **YouTube** — 自動進入頻道最新影片，逐一按讚
- **智慧停止** — 連續 3 次找不到新內容就提早結束，不浪費時間
- **排程執行** — 透過 GitHub Actions 每天中午自動跑一次

## 前置需求

- [Node.js](https://nodejs.org/) 20+
- 系統已安裝 Google Chrome（本機執行用）
- Facebook 和 YouTube (Google) 帳號

## 安裝

```bash
git clone <your-repo-url>
cd likeFbAndYoutube
npm install
```

## 設定

### 1. 設定目標 URL

複製 `.env.example` 為 `.env`，填入你要按讚的目標：

```bash
cp .env.example .env
```

編輯 `.env`：

```env
# 每天固定按讚的目標（多個用逗號分隔）
FB_TARGET_URLS=https://www.facebook.com/SomeKOL,https://www.facebook.com/AnotherKOL
YT_TARGET_URLS=https://www.youtube.com/@SomeChannel/videos

# 新加入的目標（會掃更深，按更多讚，補完歷史貼文後移到上面）
FB_TARGET_URLS_NEW_ADD=
YT_TARGET_URLS_NEW_ADD=

HEADLESS=true
DELAY_MS=2000
BROWSER_CHANNEL=chrome
```

| 變數 | 說明 |
|---|---|
| `FB_TARGET_URLS` | Facebook 目標，每次最多捲動 10 次、按 30 個讚 |
| `FB_TARGET_URLS_NEW_ADD` | Facebook 新增目標，最多捲動 30 次、按 300 個讚 |
| `YT_TARGET_URLS` | YouTube 目標，每頻道最多處理 10 支影片 |
| `YT_TARGET_URLS_NEW_ADD` | YouTube 新增目標，每頻道最多 50 支影片 |
| `HEADLESS` | `true` = 背景執行（看不到瀏覽器），`false` = 可見模式 |
| `DELAY_MS` | 每次按讚間隔（毫秒），避免被平台封鎖 |
| `BROWSER_CHANNEL` | 設為 `chrome` 使用系統 Chrome，留空使用 Playwright 內建 Chromium |

### 2. 登入帳號

首次使用或 Cookie 過期時，需要手動登入一次：

```bash
npm run login
```

會開啟瀏覽器視窗，依序手動登入 Facebook 和 YouTube，登入完成後在終端按 Enter 確認。登入狀態會儲存到 `state.json`。

## 使用

### 本機執行

```bash
# 執行全部目標（FB + YT 並行）
npm start

# 只跑 Facebook
npm run like:fb

# 只跑 YouTube
npm run like:yt
```

### GitHub Actions 自動排程

此專案已設定 GitHub Actions，**每天台灣時間中午 12:00** 自動執行一次。

#### 設定步驟

1. **產生 state.json 密鑰**（在本機執行）：

   ```bash
   cat state.json | gzip | base64 | pbcopy
   ```

   這會把壓縮後的內容複製到剪貼簿。

2. **到 GitHub Repo → Settings → Secrets and variables → Actions**，新增以下 Secrets：

   | Secret 名稱 | 值 |
   |---|---|
   | `STATE_JSON_B64` | 上一步複製的內容 |
   | `FB_TARGET_URLS` | 你的 Facebook 目標 URL（逗號分隔） |
   | `YT_TARGET_URLS` | 你的 YouTube 目標 URL（逗號分隔） |
   | `FB_TARGET_URLS_NEW_ADD` | （選填）新增的 FB 目標 |
   | `YT_TARGET_URLS_NEW_ADD` | （選填）新增的 YT 目標 |

3. 也可以到 **Actions** 頁面手動點 **Run workflow** 立即觸發。

#### ⚠️ Cookie 過期

社群平台的登入 Cookie 有時效性（通常數週到數月）。當 GitHub Actions 執行失敗時，需要在本機重新 `npm run login`，然後更新 `STATE_JSON_B64` Secret。

## 專案結構

```
├── index.js              # 主入口，並行執行 FB + YT
├── scripts/
│   ├── utils.js          # 共用工具（Cookie 驗證、瀏覽器建立）
│   ├── facebook.js       # Facebook 按讚邏輯
│   ├── youtube.js        # YouTube 按讚邏輯
│   └── login.js          # 手動登入腳本
├── .env.example          # 環境變數範本
├── .github/
│   └── workflows/
│       └── auto-like.yml # GitHub Actions 排程設定
└── package.json
```

## 注意事項

- 本工具僅供個人使用，請勿濫用以免帳號被封鎖
- `DELAY_MS` 建議至少 2000ms，太快可能觸發平台風控
- `state.json` 包含你的登入憑證，**絕對不要提交到 Git**
