import fs from 'fs';
import zlib from 'zlib';
import { validatePlatformSessions } from './utils';

// 把 state.json 壓縮成 GitHub Secret `STATE_JSON_B64` 需要的格式（gzip + base64），
// 對應 workflow 的還原指令: echo "$SECRET" | base64 -d | gunzip > state.json

const sessions = validatePlatformSessions();
if (!sessions) process.exit(1);

console.error('各平台登入狀態:');
for (const [platform, ok] of Object.entries(sessions)) {
  console.error(`  ${ok ? '✅' : '❌'} ${platform}`);
}

const b64 = zlib.gzipSync(fs.readFileSync('state.json')).toString('base64');
fs.writeFileSync('state.b64', b64);

console.error('\n📤 已輸出到 state.b64（已被 .gitignore 排除）。更新 Secret 的方式：');
console.error('  方法一 (GitHub CLI): gh secret set STATE_JSON_B64 < state.b64');
console.error('  方法二 (手動):       pbcopy < state.b64，再貼到 Repo → Settings → Secrets → STATE_JSON_B64');
