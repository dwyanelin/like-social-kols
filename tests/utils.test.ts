import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

const { launchMock, launchPersistentContextMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
  launchPersistentContextMock: vi.fn(),
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: launchMock,
    launchPersistentContext: launchPersistentContextMock,
  },
}));

import {
  PROFILE_DIR,
  PAGE_INIT_SCRIPT,
  usePersistentProfile,
  validatePlatformSessions,
  createBrowser,
  createContext,
  createSession,
  saveStorageState,
  parseUrls,
  humanDelayMs,
  jitter,
  sleep,
  formatLogTimestamp,
} from '../scripts/utils';

describe('scripts/utils', () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.useRealTimers();
  });

  describe('usePersistentProfile', () => {
    it('returns true locally when .chrome-profile exists', () => {
      delete process.env.GITHUB_ACTIONS;
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === PROFILE_DIR);
      expect(usePersistentProfile()).toBe(true);
    });

    it('returns false in GITHUB_ACTIONS even if profile dir exists', () => {
      process.env.GITHUB_ACTIONS = 'true';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      expect(usePersistentProfile()).toBe(false);
    });

    it('returns false when profile dir does not exist', () => {
      delete process.env.GITHUB_ACTIONS;
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(usePersistentProfile()).toBe(false);
    });
  });

  describe('validatePlatformSessions', () => {
    it('returns null when state.json does not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(validatePlatformSessions()).toBeNull();
    });

    it('returns null when state.json contains invalid JSON', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('{invalid json');
      expect(validatePlatformSessions()).toBeNull();
    });

    it('returns null when cookies array is empty', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ cookies: [] }));
      expect(validatePlatformSessions()).toBeNull();
    });

    it('validates each platform based on cookie existence and expiration', () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      const past = Math.floor(Date.now() / 1000) - 3600;

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify({
          cookies: [
            // facebook: c_user valid, xs expired -> false
            { name: 'c_user', domain: '.facebook.com', expires: future },
            { name: 'xs', domain: '.facebook.com', expires: past },
            // youtube: session cookie (expires = -1) -> true
            { name: 'SAPISID', domain: '.google.com', expires: -1 },
            // instagram: valid -> true
            { name: 'sessionid', domain: '.instagram.com', expires: future },
            // threads: missing -> false
          ],
        }),
      );

      expect(validatePlatformSessions()).toEqual({
        facebook: false,
        youtube: true,
        instagram: true,
        threads: false,
      });
    });

    it('supports threads.net and threads.com domains', () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify({
          cookies: [
            { name: 'sessionid', domain: '.threads.net', expires: future },
          ],
        }),
      );

      expect(validatePlatformSessions()).toEqual({
        facebook: false,
        youtube: false,
        instagram: false,
        threads: true,
      });
    });
  });

  describe('createBrowser & createContext', () => {
    it('launches chrome with linux --no-sandbox when on linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.HEADLESS = 'true';
      process.env.BROWSER_CHANNEL = 'chromium';
      const fakeBrowser = { close: vi.fn() };
      launchMock.mockResolvedValue(fakeBrowser);

      const browser = await createBrowser();
      expect(browser).toBe(fakeBrowser);
      expect(launchMock).toHaveBeenCalledWith({
        headless: true,
        channel: 'chromium',
        chromiumSandbox: false,
        args: ['--no-sandbox'],
      });
    });

    it('launches headed chrome without warning-bar flags on macOS by default', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      delete process.env.HEADLESS;
      delete process.env.BROWSER_CHANNEL;
      const fakeBrowser = { close: vi.fn() };
      launchMock.mockResolvedValue(fakeBrowser);

      await createBrowser();
      expect(launchMock).toHaveBeenCalledWith({
        headless: false,
        channel: 'chrome',
        chromiumSandbox: true,
        args: [],
      });
    });

    it('creates context with zh-TW locale and PAGE_INIT_SCRIPT (hiding webdriver and __name)', async () => {
      const fakeContext = { addInitScript: vi.fn().mockResolvedValue(undefined) };
      const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext) } as any;

      const ctx = await createContext(fakeBrowser);
      expect(ctx).toBe(fakeContext);
      expect(fakeBrowser.newContext).toHaveBeenCalledWith({
        storageState: 'state.json',
        locale: 'zh-TW',
        timezoneId: 'Asia/Taipei',
        viewport: { width: 1280, height: 900 },
      });
      expect(fakeContext.addInitScript).toHaveBeenCalledWith(PAGE_INIT_SCRIPT);
      expect(PAGE_INIT_SCRIPT).toContain('window.__name');
      expect(PAGE_INIT_SCRIPT).toContain('webdriver');
    });
  });

  describe('createSession', () => {
    it('uses launchPersistentContext when persistent profile is available', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      delete process.env.GITHUB_ACTIONS;
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === PROFILE_DIR);
      const fakePage = { id: 'existing-page' };
      const fakeContext = {
        addInitScript: vi.fn().mockResolvedValue(undefined),
        pages: vi.fn().mockReturnValue([fakePage]),
        newPage: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      launchPersistentContextMock.mockResolvedValue(fakeContext);

      const session = await createSession();
      expect(launchPersistentContextMock).toHaveBeenCalledWith(
        PROFILE_DIR,
        expect.objectContaining({ chromiumSandbox: true }),
      );
      expect(session.context).toBe(fakeContext);
      expect(session.page).toBe(fakePage);
      await session.close();
      expect(fakeContext.close).toHaveBeenCalledOnce();
    });

    it('creates a new page in persistent context when pages() is empty', async () => {
      delete process.env.GITHUB_ACTIONS;
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === PROFILE_DIR);
      const createdPage = { id: 'new-page' };
      const fakeContext = {
        addInitScript: vi.fn().mockResolvedValue(undefined),
        pages: vi.fn().mockReturnValue([]),
        newPage: vi.fn().mockResolvedValue(createdPage),
        close: vi.fn().mockResolvedValue(undefined),
      };
      launchPersistentContextMock.mockResolvedValue(fakeContext);

      const session = await createSession();
      expect(session.page).toBe(createdPage);
    });

    it('falls back to standard browser + context when persistent profile is unavailable', async () => {
      process.env.GITHUB_ACTIONS = 'true';
      const fakePage = { id: 'ci-page' };
      const fakeContext = {
        addInitScript: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue(fakePage),
      };
      const fakeBrowser = {
        newContext: vi.fn().mockResolvedValue(fakeContext),
        close: vi.fn().mockResolvedValue(undefined),
      };
      launchMock.mockResolvedValue(fakeBrowser);

      const session = await createSession();
      expect(session.context).toBe(fakeContext);
      expect(session.page).toBe(fakePage);
      await session.close();
      expect(fakeBrowser.close).toHaveBeenCalledOnce();
    });
  });

  describe('saveStorageState', () => {
    it('merges new cookies with existing state.json without losing other domains', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify({
          cookies: [
            { name: 'c_user', domain: '.facebook.com', path: '/', value: 'old', expires: 100 },
            { name: 'sessionid', domain: '.instagram.com', path: '/', value: 'ig1', expires: 200 },
          ],
          origins: [{ origin: 'https://www.instagram.com' }],
        }),
      );
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const fakeContext = {
        cookies: vi.fn().mockResolvedValue([
          { name: 'c_user', domain: '.facebook.com', path: '/', value: 'new', expires: 300 },
        ]),
      } as any;

      await saveStorageState(fakeContext);

      expect(writeSpy).toHaveBeenCalledOnce();
      const written = JSON.parse(writeSpy.mock.calls[0][1] as string);
      expect(written.origins).toEqual([{ origin: 'https://www.instagram.com' }]);
      expect(written.cookies).toEqual([
        { name: 'c_user', domain: '.facebook.com', path: '/', value: 'new', expires: 300 },
        { name: 'sessionid', domain: '.instagram.com', path: '/', value: 'ig1', expires: 200 },
      ]);
    });

    it('creates state.json from scratch when file does not exist', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const fakeContext = {
        cookies: vi.fn().mockResolvedValue([
          { name: 'a', domain: '.example.com', value: '1', expires: -1 },
        ]),
      } as any;

      await saveStorageState(fakeContext);

      const written = JSON.parse(writeSpy.mock.calls[0][1] as string);
      expect(written).toEqual({
        cookies: [{ name: 'a', domain: '.example.com', value: '1', expires: -1 }],
        origins: [],
      });
    });

    it('swallows non-fatal errors when saving fails', async () => {
      const fakeContext = {
        cookies: vi.fn().mockRejectedValue(new Error('context closed')),
      } as any;

      await expect(saveStorageState(fakeContext)).resolves.toBeUndefined();
    });
  });

  describe('parseUrls', () => {
    it('splits, trims, and filters empty values', () => {
      process.env.TEST_URLS = ' https://a.com , , https://b.com/path ';
      expect(parseUrls('TEST_URLS')).toEqual(['https://a.com', 'https://b.com/path']);
    });

    it('returns empty array when env var is missing or contains placeholder', () => {
      delete process.env.TEST_URLS;
      expect(parseUrls('TEST_URLS')).toEqual([]);

      process.env.TEST_URLS = 'https://facebook.com/your-target-page';
      expect(parseUrls('TEST_URLS')).toEqual([]);
    });
  });

  describe('humanDelayMs, jitter, sleep', () => {
    it('returns default 2000~5000ms delay when env vars are unset', () => {
      delete process.env.DELAY_MIN_MS;
      delete process.env.DELAY_MAX_MS;
      vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(humanDelayMs()).toBe(2000);

      vi.spyOn(Math, 'random').mockReturnValue(0.999999);
      expect(humanDelayMs()).toBe(5000);
    });

    it('handles swapped DELAY_MIN_MS and DELAY_MAX_MS gracefully', () => {
      process.env.DELAY_MIN_MS = '3000';
      process.env.DELAY_MAX_MS = '1000';
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      expect(humanDelayMs()).toBe(2000);
    });

    it('applies ±ratio jitter around baseMs', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(jitter(1000, 0.4)).toBe(600);

      vi.spyOn(Math, 'random').mockReturnValue(1);
      expect(jitter(1000, 0.4)).toBe(1400);

      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      expect(jitter(1000)).toBe(1000);
    });

    it('resolves sleep after specified ms', async () => {
      vi.useFakeTimers();
      const promise = sleep(250);
      vi.advanceTimersByTime(250);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('formatLogTimestamp', () => {
    it('formats a Date as zero-padded YYYY-MM-DD HH:mm:ss in local time', () => {
      const date = new Date(2026, 2, 5, 8, 4, 9); // 2026-03-05 08:04:09 local
      expect(formatLogTimestamp(date)).toBe('2026-03-05 08:04:09');
    });

    it('handles double-digit months, days, and afternoon 24-hour times', () => {
      const date = new Date(2026, 10, 28, 16, 35, 59); // 2026-11-28 16:35:59 local
      expect(formatLogTimestamp(date)).toBe('2026-11-28 16:35:59');
    });

    it('defaults to the current time when no argument is provided', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 10, 28, 9, 0, 5));
      expect(formatLogTimestamp()).toBe('2026-11-28 09:00:05');
    });
  });
});
