import 'dotenv/config';
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// 將本機 .env 的 YouTube 目標網址自動同步至 GitHub Actions Secrets，
// 達成「所有平台（FB / IG / Threads / YT）統一只改本機 .env 單一檔案」的管理體驗。

const HASH_FILE = path.resolve(__dirname, '../logs/.yt-secrets.hash');
const KEYS = ['YT_TARGET_URLS', 'YT_TARGET_URLS_NEW_ADD'] as const;

function findGhBin(): string {
  const candidates = [
    path.join(os.homedir(), '.local/bin/gh'),
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    'gh',
  ];
  for (const c of candidates) {
    if (c === 'gh' || fs.existsSync(c)) return c;
  }
  return 'gh';
}

export function syncYouTubeSecretsToGitHub(force = false): void {
  // 在 GitHub Actions runner 內執行時不需逆向同步
  if (process.env.GITHUB_ACTIONS === 'true') return;

  const payload = JSON.stringify(
    Object.fromEntries(KEYS.map(k => [k, (process.env[k] || '').trim()]))
  );
  const currentHash = crypto.createHash('sha256').update(payload).digest('hex');

  if (!force && fs.existsSync(HASH_FILE)) {
    const lastHash = fs.readFileSync(HASH_FILE, 'utf8').trim();
    if (lastHash === currentHash) return;
  }

  const gh = findGhBin();
  console.log('🔄 偵測到本機 .env 的 YouTube 目標網址變更，正在同步至 GitHub Actions Secrets...');

  try {
    for (const key of KEYS) {
      const val = (process.env[key] || '').trim();
      if (val) {
        execFileSync(gh, ['secret', 'set', key, '--body', val], { stdio: 'inherit' });
      } else {
        // 若 .env 中清空（例如 NEW_ADD 處理完畢清空），設為空空白字元覆蓋，避免舊網址殘留
        execFileSync(gh, ['secret', 'set', key, '--body', ' '], { stdio: 'ignore' });
      }
    }
    fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
    fs.writeFileSync(HASH_FILE, currentHash, 'utf8');
    console.log('✅ 已將本機 .env 的 YouTube 目標網址同步至 GitHub Secrets！');
  } catch (e) {
    console.warn('⚠️ 同步 YouTube 目標至 GitHub Secrets 失敗（請確認 gh auth status）:', (e as Error).message);
  }
}

if (require.main === module) {
  syncYouTubeSecretsToGitHub(true);
}
