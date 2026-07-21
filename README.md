# LikeFbAndYoutube

自動對你支持的 KOL 在 Facebook、YouTube、Instagram、Threads 上按讚，節省每天手動按讚的時間。

## 功能

- **Facebook** — 自動捲動粉專/個人頁，對尚未按讚的貼文按讚
- **YouTube** — 自動進入頻道最新影片，逐一按讚
- **Instagram** — 自動進入帳號最新貼文/Reel，逐一按讚
- **Threads** — 自動捲動個人頁，對尚未按讚的貼文按讚
- **智慧停止** — 連續 3 次找不到新內容就提早結束，不浪費時間
- **登入檢測** — 每個平台的 Cookie 失效時明確報錯（而不是默默按不到讚）
- **排程執行** — 透過 GitHub Actions 每天台灣時間中午 12:00 自動跑一次

## 前置需求

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 11+（`npm install -g pnpm`）
- 系統已安裝 Google Chrome（本機登入用）
- Facebook / Google / Instagram / Threads 帳號

## 安裝

```bash
git clone <your-repo-url>
cd likeFbAndYoutube
pnpm install
pnpm exec playwright install chromium   # 下載 Playwright 內建瀏覽器（本機第一次執行需要）
```

## 設定

### 1. 設定目標 URL

複製 `.env.example` 為 `.env`，填入你要按讚的目標：

```bash
cp .env.example .env
```

| 變數 | 說明 |
|---|---|
| `FB_TARGET_URLS` | Facebook 目標，每次最多捲動 10 次、按 30 個讚 |
| `YT_TARGET_URLS` | YouTube 目標，每頻道最多處理 10 支影片 |
| `IG_TARGET_URLS` | Instagram 目標，每帳號最多處理 10 則貼文 |
| `THREADS_TARGET_URLS` | Threads 目標，每次最多捲動 10 次、按 30 個讚 |
| `*_NEW_ADD` | 各平台「新增目標」，會掃更深按更多（補完歷史內容後移回上面） |
| `HEADLESS` | `true` = 背景執行（看不到瀏覽器），`false` = 可見模式 |
| `DELAY_MS` | 每次按讚間隔（毫秒），避免被平台封鎖 |
| `BROWSER_CHANNEL` | 設為 `chrome` 使用系統 Chrome，留空使用 Playwright 內建 Chromium |

多個網址用逗號分隔。

### 2. 登入帳號

首次使用或 Cookie 過期時，需要手動登入一次：

```bash
pnpm login
```

會開啟瀏覽器視窗，依序手動登入 Facebook → Instagram → Threads → YouTube（不用的平台直接按 Enter 跳過），登入狀態會儲存到 `state.json`。

> ⚠️ **Facebook 的登入 Cookie 約 90 天過期**，其他平台通常更久。過期時執行結果會明確告訴你哪個平台需要重新登入。

## 使用

### 本機執行

```bash
pnpm start              # 執行全部目標（四平台並行）
pnpm like:fb            # 只跑 Facebook
pnpm like:yt            # 只跑 YouTube
pnpm like:ig            # 只跑 Instagram
pnpm like:threads       # 只跑 Threads
pnpm typecheck          # TypeScript 型別檢查
```

### GitHub Actions 自動排程

此專案已設定 GitHub Actions，**每天台灣時間中午 12:00** 自動執行一次。

#### 設定步驟

1. **產生 state.json 密鑰**（在本機執行）：

   ```bash
   pnpm export-state
   ```

   會輸出 `state.b64` 並顯示各平台登入狀態。接著更新 Secret：

   ```bash
   gh secret set STATE_JSON_B64 < state.b64
   # 或 pbcopy < state.b64 後手動貼到 GitHub
   ```

2. **到 GitHub Repo → Settings → Secrets and variables → Actions**，新增以下 Secrets：

   | Secret 名稱 | 值 |
   |---|---|
   | `STATE_JSON_B64` | 上一步產生的內容 |
   | `FB_TARGET_URLS` | Facebook 目標 URL（逗號分隔） |
   | `YT_TARGET_URLS` | YouTube 目標 URL（逗號分隔） |
   | `IG_TARGET_URLS` | Instagram 目標 URL（逗號分隔） |
   | `THREADS_TARGET_URLS` | Threads 目標 URL（逗號分隔） |
   | `*_TARGET_URLS_NEW_ADD` | （選填）各平台新增目標 |

3. 也可以到 **Actions** 頁面手動點 **Run workflow** 立即觸發。

#### ⚠️ Cookie 過期

社群平台的登入 Cookie 有時效性（FB 約 90 天，其他平台數月）。當某平台 Cookie 失效時，**workflow 會以失敗結束並在 log 指出是哪個平台**，此時：

```bash
pnpm login          # 重新登入失效的平台
pnpm export-state   # 重新產生 state.b64
gh secret set STATE_JSON_B64 < state.b64
```

## 專案結構

```
├── index.ts              # 主入口，四平台並行執行
├── scripts/
│   ├── utils.ts          # 共用工具（逐平台 Cookie 驗證、瀏覽器建立）
│   ├── facebook.ts       # Facebook 按讚邏輯
│   ├── youtube.ts        # YouTube 按讚邏輯
│   ├── instagram.ts      # Instagram 按讚邏輯
│   ├── threads.ts        # Threads 按讚邏輯
│   ├── login.ts          # 手動登入腳本
│   └── exportState.ts    # 產生 GitHub Secret 用的 state.b64
├── .env.example          # 環境變數範本
├── .github/workflows/
│   └── auto-like.yml     # GitHub Actions 排程設定
├── tsconfig.json
└── package.json
```

## 注意事項

- 本工具僅供個人使用，請勿濫用以免帳號被封鎖
- `DELAY_MS` 建議至少 2000ms，太快可能觸發平台風控
- `state.json` / `state.b64` 包含你的登入憑證，**絕對不要提交到 Git**（已在 .gitignore）
