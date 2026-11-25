import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

// 在 macOS 設定極簡版 launchd 排程：
// - 只要當天連上網路，即自動執行一次 Meta 平台（FB / IG / Threads）
// - 透過 logs/last-success-date.txt 確保一天最多執行一次
// - 透過 logs/last-run-ts.txt 確保距上次執行至少間隔 20 小時（避免跨午夜短時間連跑兩輪觸發 Meta 風控）
// - 透過 logs/.launchd.lock 互斥鎖確保同一時間只會跑一個實例

export const LABEL = 'com.dwyanelin.like-social-kols';
export const CHECK_INTERVAL_SECONDS = 60;
export const MIN_COOLDOWN_SECONDS = 20 * 60 * 60;

export function buildRunnerCommand(
  logDir: string,
  minCooldownSeconds: number = MIN_COOLDOWN_SECONDS
): string {
  const stampFile = path.join(logDir, 'last-success-date.txt');
  const lastRunTsFile = path.join(logDir, 'last-run-ts.txt');
  const lockDir = path.join(logDir, '.launchd.lock');

  return [
    'TODAY=$(date +%Y-%m-%d)',
    'NOW_TS=$(date +%s)',
    // 1. 一天最多跑一次：今天已經連網開跑過就直接跳過
    `if [ -f "${stampFile}" ] && [ "$(cat "${stampFile}")" = "$TODAY" ]; then exit 0; fi`,
    // 2. 最少間隔 20 小時：避免下午跑完、跨午夜 00:00 又立刻開跑，導致 24 小時內翻倍按讚觸發 Meta 風控
    `if [ -s "${lastRunTsFile}" ] && [ $((NOW_TS - $(cat "${lastRunTsFile}"))) -lt ${minCooldownSeconds} ]; then exit 0; fi`,
    // 3. 互斥鎖：確保同一時間永遠只會跑一個實例，絕不重疊
    `if ! mkdir "${lockDir}" 2>/dev/null; then exit 0; fi`,
    `trap 'rmdir "${lockDir}" 2>/dev/null || true' EXIT`,
    // 4. 確認目前有連上網路；若未連網則不寫入今日標記，待下次檢查（60 秒後）重試
    'if ! curl -s --head --request GET https://www.facebook.com --max-time 4 >/dev/null; then exit 0; fi',
    // 5. 連網確認後寫入今日日期與執行時間戳，再依序執行 FB → IG → Threads
    `echo "$TODAY" > "${stampFile}"`,
    `echo "$NOW_TS" > "${lastRunTsFile}"`,
    'pnpm start:meta',
  ].join('; ');
}

export function buildPlistContent(options: {
  label?: string;
  repoDir: string;
  logDir: string;
  userPath: string;
  runnerCmd: string;
  checkIntervalSeconds?: number;
}): string {
  const {
    label = LABEL,
    repoDir,
    logDir,
    userPath,
    runnerCmd,
    checkIntervalSeconds = CHECK_INTERVAL_SECONDS,
  } = options;
  const escapedCmd = runnerCmd.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>WorkingDirectory</key>
  <string>${repoDir}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${userPath}</string>
    <key>SKIP_YOUTUBE</key>
    <string>true</string>
  </dict>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-c</string>
    <string>${escapedCmd}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>StartInterval</key>
  <integer>${checkIntervalSeconds}</integer>

  <key>StandardOutPath</key>
  <string>${path.join(logDir, 'launchd.log')}</string>

  <key>StandardErrorPath</key>
  <string>${path.join(logDir, 'launchd.log')}</string>
</dict>
</plist>
`;
}

export function setupLaunchd(): string {
  const repoDir = path.resolve(__dirname, '..');
  const logDir = path.join(repoDir, 'logs');
  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`);

  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  const userPath = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.local', 'node', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(':');

  const runnerCmd = buildRunnerCommand(logDir);
  const plistContent = buildPlistContent({ repoDir, logDir, userPath, runnerCmd });

  fs.writeFileSync(plistPath, plistContent, 'utf8');
  console.log(`✅ 已寫入 launchd 設定檔: ${plistPath}`);

  const uid = process.getuid ? process.getuid() : 501;
  try {
    execSync(`launchctl bootout gui/${uid}/${LABEL}`, { stdio: 'ignore' });
  } catch {
    // 尚未載入時忽略
  }

  execSync(`launchctl bootstrap gui/${uid} "${plistPath}"`, { stdio: 'inherit' });
  console.log(`🎉 已成功啟用 macOS launchd 排程 (${LABEL})！`);
  console.log(
    `   - 執行規則：只要當天連上網路即執行（每 ${CHECK_INTERVAL_SECONDS} 秒輕量檢查一次，一天最多一次且距上次至少間隔 ${Math.round(MIN_COOLDOWN_SECONDS / 3600)} 小時，具互斥鎖）`
  );
  console.log('   - 執行範圍：Facebook / Instagram / Threads (pnpm start:meta)');
  console.log(`   - 執行日誌：${path.join(logDir, 'launchd.log')}`);
  console.log(`   - 手動立即測試：launchctl kickstart -k gui/${uid}/${LABEL}`);

  return plistPath;
}

if (require.main === module) {
  setupLaunchd();
}
