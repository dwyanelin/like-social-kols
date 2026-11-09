import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

// 在 macOS 設定 launchd 定時排程（每天中午 12:00 自動在本機執行 Meta 平台：FB / IG / Threads）。
// 優點：
// 1. 使用本機真實住宅 IP + macOS 真 Chrome，100% 避開雲端機房 IP 造成的 Meta 風控與強制改密碼
// 2. 若中午 12:00 電腦處於闔蓋休眠狀態，macOS launchd 會在喚醒電腦時自動補跑

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
    <string>sleep $((RANDOM % 300)) &amp;&amp; pnpm start:meta</string>
  </array>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>12</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>

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
console.log('   - 執行時間：每天中午 12:00（若電腦休眠，喚醒後會自動補跑）');
console.log('   - 執行範圍：Facebook / Instagram / Threads (pnpm start:meta)');
console.log(`   - 執行日誌：${path.join(logDir, 'launchd.log')}`);
console.log(`   - 手動立即測試：launchctl kickstart -k gui/${uid}/${LABEL}`);
