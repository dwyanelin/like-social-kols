import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: execSyncMock,
}));

import {
  LABEL,
  buildRunnerCommand,
  buildPlistContent,
  setupLaunchd,
} from '../scripts/setupLaunchd';

describe('scripts/setupLaunchd', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('buildRunnerCommand', () => {
    it('includes stamp check, lock dir, network check, and pnpm start:meta', () => {
      const cmd = buildRunnerCommand('/tmp/logs');
      expect(cmd).toContain('TODAY=$(date +%Y-%m-%d)');
      expect(cmd).toContain('/tmp/logs/last-success-date.txt');
      expect(cmd).toContain('/tmp/logs/.launchd.lock');
      expect(cmd).toContain('https://www.facebook.com');
      expect(cmd).toContain('pnpm start:meta');
      expect(cmd).not.toContain('case "$TODAY"');
    });
  });

  describe('buildPlistContent', () => {
    it('escapes XML special characters in runnerCmd', () => {
      const plist = buildPlistContent({
        repoDir: '/repo',
        logDir: '/repo/logs',
        userPath: '/usr/bin',
        runnerCmd: 'a && b > /dev/null < /tmp/in',
      });

      expect(plist).toContain(`<string>${LABEL}</string>`);
      expect(plist).toContain('<string>a &amp;&amp; b &gt; /dev/null &lt; /tmp/in</string>');
      expect(plist).toContain('<string>/repo/logs/launchd.log</string>');
    });
  });

  describe('setupLaunchd', () => {
    it('writes plist and bootstraps launchctl even if bootout throws', () => {
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      execSyncMock.mockImplementationOnce(() => {
        throw new Error('not loaded');
      });

      const plistPath = setupLaunchd();

      expect(plistPath).toContain(`${LABEL}.plist`);
      expect(mkdirSpy).toHaveBeenCalledTimes(2);
      expect(writeSpy).toHaveBeenCalledWith(plistPath, expect.stringContaining(LABEL), 'utf8');
      expect(execSyncMock).toHaveBeenCalledTimes(2);
      expect(execSyncMock.mock.calls[0][0]).toContain('launchctl bootout');
      expect(execSyncMock.mock.calls[1][0]).toContain('launchctl bootstrap');
    });
  });
});
