import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // 方案 A：聚焦於「有實際商業邏輯、狀態判斷、API 整合與系統設定」的核心模組；
      // Playwright 社群爬蟲與互動式登入腳本（facebook/instagram/threads/youtube/login/youtubeAuth）
      // 高度依賴外部平台即時 DOM 與人工登入，不強制追 line coverage（若有純邏輯應抽離出來測）。
      include: [
        'index.ts',
        'scripts/utils.ts',
        'scripts/youtubeApi.ts',
        'scripts/syncSecrets.ts',
        'scripts/setupLaunchd.ts',
        'scripts/exportState.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
