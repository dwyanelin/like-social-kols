import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { syncYouTubeSecretsToGitHub } from '../scripts/syncSecrets';

describe('scripts/syncSecrets', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GITHUB_ACTIONS;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does nothing when running inside GITHUB_ACTIONS', () => {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.YT_TARGET_URLS = 'https://youtube.com/@a';

    syncYouTubeSecretsToGitHub(true);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('skips syncing when hash matches and force is false', () => {
    process.env.YT_TARGET_URLS = 'https://youtube.com/@a';
    const expectedHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ YT_TARGET_URLS: 'https://youtube.com/@a' }))
      .digest('hex');

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`${expectedHash}\n`);

    syncYouTubeSecretsToGitHub(false);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('syncs secret and updates hash file when value changed', () => {
    process.env.YT_TARGET_URLS = ' https://youtube.com/@new ';
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === '/opt/homebrew/bin/gh');
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    syncYouTubeSecretsToGitHub(false);

    expect(execFileSyncMock).toHaveBeenCalledWith(
      '/opt/homebrew/bin/gh',
      ['secret', 'set', 'YT_TARGET_URLS', '--body', 'https://youtube.com/@new'],
      { stdio: 'inherit' },
    );
    expect(mkdirSpy).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledOnce();
  });

  it('writes single space when YT_TARGET_URLS is empty and falls back to gh in PATH', () => {
    process.env.YT_TARGET_URLS = '   ';
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    syncYouTubeSecretsToGitHub(true);

    expect(execFileSyncMock).toHaveBeenCalledWith(
      'gh',
      ['secret', 'set', 'YT_TARGET_URLS', '--body', ' '],
      { stdio: 'ignore' },
    );
  });

  it('warns without throwing when gh CLI fails', () => {
    process.env.YT_TARGET_URLS = 'https://youtube.com/@fail';
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    execFileSyncMock.mockImplementation(() => {
      throw new Error('gh not logged in');
    });

    expect(() => syncYouTubeSecretsToGitHub(true)).not.toThrow();
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
