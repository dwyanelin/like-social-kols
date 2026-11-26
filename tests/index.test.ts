import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  autoLikeFacebookMock,
  autoLikeYouTubeMock,
  autoLikeYouTubeViaApiMock,
  hasYouTubeApiCredentialsMock,
  autoLikeInstagramMock,
  autoLikeThreadsMock,
  validatePlatformSessionsMock,
  usePersistentProfileMock,
  syncYouTubeSecretsToGitHubMock,
} = vi.hoisted(() => ({
  autoLikeFacebookMock: vi.fn(),
  autoLikeYouTubeMock: vi.fn(),
  autoLikeYouTubeViaApiMock: vi.fn(),
  hasYouTubeApiCredentialsMock: vi.fn(),
  autoLikeInstagramMock: vi.fn(),
  autoLikeThreadsMock: vi.fn(),
  validatePlatformSessionsMock: vi.fn(),
  usePersistentProfileMock: vi.fn(),
  syncYouTubeSecretsToGitHubMock: vi.fn(),
}));

vi.mock('../scripts/facebook', () => ({ default: autoLikeFacebookMock }));
vi.mock('../scripts/youtube', () => ({ default: autoLikeYouTubeMock }));
vi.mock('../scripts/youtubeApi', () => ({
  autoLikeYouTubeViaApi: autoLikeYouTubeViaApiMock,
  hasYouTubeApiCredentials: hasYouTubeApiCredentialsMock,
}));
vi.mock('../scripts/instagram', () => ({ default: autoLikeInstagramMock }));
vi.mock('../scripts/threads', () => ({ default: autoLikeThreadsMock }));
vi.mock('../scripts/syncSecrets', () => ({
  syncYouTubeSecretsToGitHub: syncYouTubeSecretsToGitHubMock,
}));
vi.mock('../scripts/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scripts/utils')>();
  return {
    ...actual,
    validatePlatformSessions: validatePlatformSessionsMock,
    usePersistentProfile: usePersistentProfileMock,
  };
});

import { main } from '../index';

describe('index.ts main orchestration', () => {
  const originalEnv = { ...process.env };
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SKIP_YOUTUBE;
    delete process.env.SKIP_META;
    delete process.env.SKIP_FACEBOOK;
    delete process.env.SKIP_INSTAGRAM;
    delete process.env.SKIP_THREADS;
    delete process.env.FB_TARGET_URLS;
    delete process.env.YT_TARGET_URLS;
    delete process.env.IG_TARGET_URLS;
    delete process.env.THREADS_TARGET_URLS;
    process.exitCode = undefined;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    autoLikeFacebookMock.mockResolvedValue(undefined);
    autoLikeInstagramMock.mockResolvedValue(undefined);
    autoLikeThreadsMock.mockResolvedValue(undefined);
    autoLikeYouTubeMock.mockResolvedValue(undefined);
    autoLikeYouTubeViaApiMock.mockResolvedValue({ likedCount: 0, quotaExhausted: false, estimatedUnitsUsed: 0 });
    hasYouTubeApiCredentialsMock.mockReturnValue(false);
    usePersistentProfileMock.mockReturnValue(false);
    validatePlatformSessionsMock.mockReturnValue({
      facebook: true,
      youtube: true,
      instagram: true,
      threads: true,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exitCode = originalExitCode;
  });

  it('runs FB -> IG -> Threads in persistent mode without validating state.json and uses YT API when credentials exist', async () => {
    process.env.FB_TARGET_URLS = 'https://fb.com/kol1';
    process.env.IG_TARGET_URLS = 'https://ig.com/kol2';
    process.env.THREADS_TARGET_URLS = 'https://threads.com/@kol3';
    process.env.YT_TARGET_URLS = 'https://youtube.com/@kol4';
    usePersistentProfileMock.mockReturnValue(true);
    hasYouTubeApiCredentialsMock.mockReturnValue(true);

    const callOrder: string[] = [];
    autoLikeFacebookMock.mockImplementation(async () => { callOrder.push('fb'); });
    autoLikeInstagramMock.mockImplementation(async () => { callOrder.push('ig'); });
    autoLikeThreadsMock.mockImplementation(async () => { callOrder.push('threads'); });
    autoLikeYouTubeViaApiMock.mockImplementation(async () => { callOrder.push('yt-api'); });

    await main();

    expect(syncYouTubeSecretsToGitHubMock).toHaveBeenCalledOnce();
    expect(validatePlatformSessionsMock).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['fb', 'ig', 'threads', 'yt-api']);
    expect(autoLikeYouTubeMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('respects SKIP_META and SKIP_YOUTUBE flags', async () => {
    process.env.FB_TARGET_URLS = 'https://fb.com/kol1';
    process.env.IG_TARGET_URLS = 'https://ig.com/kol2';
    process.env.THREADS_TARGET_URLS = 'https://threads.com/@kol3';
    process.env.YT_TARGET_URLS = 'https://youtube.com/@kol4';
    process.env.SKIP_META = 'true';
    process.env.SKIP_YOUTUBE = 'true';

    await main();

    expect(autoLikeFacebookMock).not.toHaveBeenCalled();
    expect(autoLikeInstagramMock).not.toHaveBeenCalled();
    expect(autoLikeThreadsMock).not.toHaveBeenCalled();
    expect(autoLikeYouTubeMock).not.toHaveBeenCalled();
    expect(autoLikeYouTubeViaApiMock).not.toHaveBeenCalled();
    expect(validatePlatformSessionsMock).not.toHaveBeenCalled();
  });

  it('allows Threads when Instagram session is valid even if Threads session is missing', async () => {
    process.env.THREADS_TARGET_URLS = 'https://threads.com/@kol3';
    validatePlatformSessionsMock.mockReturnValue({
      facebook: false,
      youtube: false,
      instagram: true,
      threads: false,
    });

    await main();

    expect(autoLikeThreadsMock).toHaveBeenCalledWith({
      urls: ['https://threads.com/@kol3'],
      maxScrolls: 30,
      maxClicks: 200,
      maxSessionClicks: 200,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('skips platforms with expired sessions and sets process.exitCode = 1', async () => {
    process.env.FB_TARGET_URLS = 'https://fb.com/kol1';
    process.env.YT_TARGET_URLS = 'https://youtube.com/@kol4';
    hasYouTubeApiCredentialsMock.mockReturnValue(false);
    validatePlatformSessionsMock.mockReturnValue({
      facebook: false,
      youtube: true,
      instagram: false,
      threads: false,
    });

    await main();

    expect(autoLikeFacebookMock).not.toHaveBeenCalled();
    expect(autoLikeYouTubeMock).toHaveBeenCalledWith({
      urls: ['https://youtube.com/@kol4'],
      maxVideos: 100,
    });
    expect(process.exitCode).toBe(1);
  });
});
