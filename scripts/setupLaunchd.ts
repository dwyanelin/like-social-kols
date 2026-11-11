import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

// 在 macOS 設定 launchd 定時排程（每天中午 12:00 起，一天最多成功執行一次 Meta 平台：FB / IG / Threads）。
// 行為保證：
// 1. 早上 (< 12:00) 喚醒電腦：不會觸發
// 2. 中午 12:00 電腦醒著：12:00 整準時執行一次（無隨機延遲）
// 3. 中午已跑過，下午/晚上再喚醒：看到今日已完成紀錄，不會再重複執行
// 4. 中午休眠沒跑過（或闔蓋 DarkWake 斷網失敗），下午/晚上喚醒電腦：等 Wi-Fi 連通後立即補跑一次

const LABEL = 'com.dwyanelin.like-social-kols';
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

// 產生 12:00 ~ 23:00 的日曆觸發點，搭配每日成功鎖定檔 (logs/last-success-date.txt)：
// - 確保中午 12:00 整準時觸發
// - 若中午休眠（或發生無網路的闔蓋 DarkWake），下午/晚上任何時刻喚醒都會立即補觸發，且一天最多只成功跑一次
const calendarIntervals = Array.from({ length: 12 }, (_, idx) => {
  const hour = 12 + idx;
  return `    <dict>
      <key>Hour</key>
      <integer>${hour}</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>`;
}).join('\n');

const stampFile = path.join(logDir, 'last-success-date.txt');
const runnerCmd = [
  'TODAY=$(date +%Y-%m-%d)',
  'HOUR=$(date +%H)',
  // 1. 早上 12:00 前絕不執行（防止跨日休眠在早上補跑）
  'if [ "$HOUR" -lt 12 ]; then exit 0; fi',
  // 2. 今天已經成功執行過就直接跳過（保證一天最多跑一次）
  `if [ -f "${stampFile}" ] && [ "$(cat "${stampFile}")" = "$TODAY" ]; then exit 0; fi`,
  // 3. 剛從休眠喚醒時等待 Wi-Fi 連通（每 3 秒檢查一次，最多等 2 分鐘）
  'ONLINE=0; for i in {1..40}; do if curl -s --head --request GET https://www.facebook.com --max-time 4 >/dev/null; then ONLINE=1; break; fi; sleep 3; done',
  'if [ "$ONLINE" -ne 1 ]; then exit 1; fi',
  // 4. 立即執行（無隨機等待），成功後寫入今日完成標記
  `pnpm start:meta && echo "$TODAY" > "${stampFile}"`,
].join('; ');

const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

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
    <string>${runnerCmd.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</string>
  </array>

  <key>StartCalendarInterval</key>
  <array>
${calendarIntervals}
  </array>

  <key>StandardOutPath</key>
  <string>${path.join(logDir, 'launchd.log')}</string>

  <key>StandardErrorPath</key>
  <string>${path.join(logDir, 'launchd.error.log')}</string>
</dict>
</plist>
`;

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
console.log('   - 執行時間：每天中午 12:00（無隨機延遲；若中午休眠，下午/晚上喚醒連網後自動補跑，一天最多一次）');
console.log('   - 執行範圍：Facebook / Instagram / Threads (pnpm start:meta)');
console.log(`   - 執行日誌：${path.join(logDir, 'launchd.log')}`);
console.log(`   - 手動立即測試：launchctl kickstart -k gui/${uid}/${LABEL}`);
