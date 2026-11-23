import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  YouTubeApiError,
  isQuotaExceededError,
  isPlaylistNotFoundError,
  hasYouTubeApiCredentials,
  channelParamsFromUrl,
  autoLikeYouTubeViaApi,
} from '../scripts/youtubeApi';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('scripts/youtubeApi', () => {
  const originalEnv = { ...process.env };
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      YT_OAUTH_CLIENT_ID: 'cid',
      YT_OAUTH_CLIENT_SECRET: 'csecret',
      YT_OAUTH_REFRESH_TOKEN: 'rtoken',
    };
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exitCode = originalExitCode;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('pure helpers', () => {
    it('detects YouTube API credentials presence', () => {
      expect(hasYouTubeApiCredentials()).toBe(true);
      delete process.env.YT_OAUTH_REFRESH_TOKEN;
      expect(hasYouTubeApiCredentials()).toBe(false);
    });

    it('parses @handle and /channel/UC... URLs', () => {
      expect(channelParamsFromUrl('https://www.youtube.com/@SomeKOL/videos')).toEqual({
        forHandle: '@SomeKOL',
      });
      expect(channelParamsFromUrl('https://www.youtube.com/%40%E4%B8%AD%E6%96%87')).toEqual({
        forHandle: '@中文',
      });
      expect(channelParamsFromUrl('https://www.youtube.com/channel/UC123456')).toEqual({
        id: 'UC123456',
      });
      expect(channelParamsFromUrl('https://www.youtube.com/watch?v=abc')).toBeNull();
    });

    it('identifies quotaExceeded errors for both YouTubeApiError and generic Error', () => {
      expect(
        isQuotaExceededError(new YouTubeApiError('POST', '/videos/rate', 403, 'quotaExceeded')),
      ).toBe(true);
      expect(
        isQuotaExceededError(new YouTubeApiError('GET', '/channels', 403, 'dailyLimitExceeded')),
      ).toBe(true);
      expect(
        isQuotaExceededError(new YouTubeApiError('GET', '/channels', 403, 'youtube.quota')),
      ).toBe(true);
      expect(
        isQuotaExceededError(new YouTubeApiError('GET', '/channels', 403, 'forbidden')),
      ).toBe(false);
      expect(isQuotaExceededError(new Error('HTTP 403 quotaExceeded'))).toBe(true);
      expect(isQuotaExceededError(new Error('HTTP 500 internal'))).toBe(false);
    });

    it('identifies playlistNotFound errors for both YouTubeApiError and generic Error', () => {
      expect(
        isPlaylistNotFoundError(new YouTubeApiError('GET', '/playlistItems', 404, 'playlistNotFound')),
      ).toBe(true);
      expect(
        isPlaylistNotFoundError(new YouTubeApiError('GET', '/playlistItems', 404, 'other')),
      ).toBe(false);
      expect(isPlaylistNotFoundError(new Error('404 playlistNotFound'))).toBe(true);
      expect(isPlaylistNotFoundError(new Error('404 notFound'))).toBe(false);
    });
  });

  describe('autoLikeYouTubeViaApi', () => {
    it('returns immediately when urls is empty', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const res = await autoLikeYouTubeViaApi({ urls: [] });
      expect(res).toEqual({ likedCount: 0, quotaExhausted: false, estimatedUnitsUsed: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sets exitCode = 1 when OAuth token exchange fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('invalid_grant', { status: 400 })),
      );

      const res = await autoLikeYouTubeViaApi({ urls: ['https://www.youtube.com/@kol'] });
      expect(res).toEqual({ likedCount: 0, quotaExhausted: false, estimatedUnitsUsed: 0 });
      expect(process.exitCode).toBe(1);
    });

    it('likes unliked videos, supports pagination, and tracks estimated quota units', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com/token')) {
          return jsonResponse({ access_token: 'access-123' });
        }
        if (url.includes('/channels?')) {
          return jsonResponse({
            items: [
              {
                snippet: { title: 'Test KOL' },
                contentDetails: { relatedPlaylists: { uploads: 'UU_TEST' } },
              },
            ],
          });
        }
        if (url.includes('/playlistItems?') && !url.includes('pageToken=p2')) {
          return jsonResponse({
            items: [
              { contentDetails: { videoId: 'v1' } },
              { contentDetails: { videoId: 'v2' } },
            ],
            nextPageToken: 'p2',
          });
        }
        if (url.includes('/playlistItems?') && url.includes('pageToken=p2')) {
          return jsonResponse({
            items: [{ contentDetails: { videoId: 'v3' } }],
          });
        }
        if (url.includes('/videos/getRating?')) {
          return jsonResponse({
            items: [
              { videoId: 'v1', rating: 'like' },
              { videoId: 'v2', rating: 'none' },
              { videoId: 'v3', rating: 'none' },
            ],
          });
        }
        if (url.includes('/videos/rate?')) {
          return jsonResponse(null, 204);
        }
        throw new Error(`Unexpected URL: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = autoLikeYouTubeViaApi({
        urls: ['https://www.youtube.com/@testkol'],
        maxVideos: 3,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      // 1 (channels) + 2 (playlistItems pages) + 1 (getRating) + 2 * 50 (rate) = 104
      expect(result).toEqual({
        likedCount: 2,
        quotaExhausted: false,
        estimatedUnitsUsed: 104,
      });
      expect(process.exitCode).toBeUndefined();
    });

    it('handles invalid URLs, missing channels, empty playlists, and all-liked channels', async () => {
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com/token')) {
          return jsonResponse({ access_token: 'tok' });
        }
        if (url.includes('forHandle=%40missing')) {
          return jsonResponse({ items: [] });
        }
        if (url.includes('forHandle=%40empty')) {
          return jsonResponse({
            items: [
              {
                snippet: { title: 'Empty' },
                contentDetails: { relatedPlaylists: { uploads: 'UU_EMPTY' } },
              },
            ],
          });
        }
        if (url.includes('playlistId=UU_EMPTY')) {
          return jsonResponse({ items: [] });
        }
        if (url.includes('forHandle=%40already')) {
          return jsonResponse({
            items: [
              {
                snippet: { title: 'Already Liked' },
                contentDetails: { relatedPlaylists: { uploads: 'UU_ALREADY' } },
              },
            ],
          });
        }
        if (url.includes('playlistId=UU_ALREADY')) {
          return jsonResponse({ items: [{ contentDetails: { videoId: 'v1' } }] });
        }
        if (url.includes('/videos/getRating?')) {
          return jsonResponse({ items: [{ videoId: 'v1', rating: 'like' }] });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await autoLikeYouTubeViaApi({
        urls: [
          'https://www.youtube.com/watch?v=invalid',
          'https://www.youtube.com/@missing',
          'https://www.youtube.com/@empty',
          'https://www.youtube.com/@already',
        ],
      });

      expect(res.likedCount).toBe(0);
      expect(res.quotaExhausted).toBe(false);
      expect(process.exitCode).toBeUndefined();
    });

    it('gracefully circuit-breaks on 403 quotaExceeded without setting exitCode = 1', async () => {
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com/token')) {
          return jsonResponse({ access_token: 'tok' });
        }
        if (url.includes('/channels?')) {
          return jsonResponse({
            items: [
              {
                snippet: { title: 'KOL' },
                contentDetails: { relatedPlaylists: { uploads: 'UU_1' } },
              },
            ],
          });
        }
        if (url.includes('/playlistItems?')) {
          return jsonResponse({ items: [{ contentDetails: { videoId: 'v1' } }] });
        }
        if (url.includes('/videos/getRating?')) {
          return jsonResponse({ items: [{ videoId: 'v1', rating: 'none' }] });
        }
        if (url.includes('/videos/rate?')) {
          return new Response(JSON.stringify({ error: { reason: 'quotaExceeded' } }), {
            status: 403,
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await autoLikeYouTubeViaApi({
        urls: ['https://www.youtube.com/@kol1', 'https://www.youtube.com/@kol2'],
      });

      expect(res.quotaExhausted).toBe(true);
      expect(res.likedCount).toBe(0);
      expect(process.exitCode).toBeUndefined();
    });

    it('skips channels with 404 playlistNotFound and continues to next target', async () => {
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com/token')) {
          return jsonResponse({ access_token: 'tok' });
        }
        if (url.includes('/channels?')) {
          return jsonResponse({
            items: [
              {
                snippet: { title: 'No Uploads' },
                contentDetails: { relatedPlaylists: { uploads: 'UU_NONE' } },
              },
            ],
          });
        }
        if (url.includes('/playlistItems?')) {
          return new Response(JSON.stringify({ error: { reason: 'playlistNotFound' } }), {
            status: 404,
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await autoLikeYouTubeViaApi({
        urls: ['https://www.youtube.com/@nouploads'],
      });

      expect(res.quotaExhausted).toBe(false);
      expect(process.exitCode).toBeUndefined();
    });

    it('records exitCode = 1 on unexpected API errors', async () => {
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com/token')) {
          return jsonResponse({ access_token: 'tok' });
        }
        return new Response('Internal Server Error', { status: 500 });
      });
      vi.stubGlobal('fetch', fetchMock);

      await autoLikeYouTubeViaApi({ urls: ['https://www.youtube.com/@broken'] });
      expect(process.exitCode).toBe(1);
    });
  });
});
