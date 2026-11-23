import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import zlib from 'zlib';

const { validatePlatformSessionsMock } = vi.hoisted(() => ({
  validatePlatformSessionsMock: vi.fn(),
}));

vi.mock('../scripts/utils', () => ({
  validatePlatformSessions: validatePlatformSessionsMock,
}));

import { exportState } from '../scripts/exportState';

describe('scripts/exportState', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exits with code 1 when sessions are invalid', () => {
    validatePlatformSessionsMock.mockReturnValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    expect(exportState()).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('gzips and base64-encodes state.json into state.b64 when sessions are valid', () => {
    validatePlatformSessionsMock.mockReturnValue({
      facebook: true,
      youtube: false,
      instagram: true,
      threads: true,
    });
    const rawState = JSON.stringify({ cookies: [{ name: 'c_user', value: '123' }] });
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(rawState, 'utf8'));
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    expect(exportState()).toBe(true);
    expect(writeSpy).toHaveBeenCalledOnce();
    expect(writeSpy.mock.calls[0][0]).toBe('state.b64');

    const writtenB64 = writeSpy.mock.calls[0][1] as string;
    const decoded = zlib.gunzipSync(Buffer.from(writtenB64, 'base64')).toString('utf8');
    expect(decoded).toBe(rawState);
  });
});
