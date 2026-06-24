import { describe, expect, it } from 'vitest';
import { getRefreshTokenPayload } from '@/lib/api-client';

describe('api-client refresh response parsing', () => {
  it('reads the wrapped API response shape', () => {
    expect(
      getRefreshTokenPayload({
        success: true,
        data: {
          access_token: 'new-access-token',
          expires_in: 900,
        },
      })
    ).toEqual({
      access_token: 'new-access-token',
      expires_in: 900,
    });
  });

  it('keeps compatibility with the legacy raw refresh shape', () => {
    expect(
      getRefreshTokenPayload({
        access_token: 'legacy-access-token',
        expires_in: 900,
      })
    ).toEqual({
      access_token: 'legacy-access-token',
      expires_in: 900,
    });
  });

  it('rejects malformed refresh responses', () => {
    expect(getRefreshTokenPayload({ success: true, data: {} })).toBeNull();
    expect(getRefreshTokenPayload({ access_token: '', expires_in: 900 })).toBeNull();
    expect(getRefreshTokenPayload({ access_token: 'token', expires_in: 0 })).toBeNull();
  });
});
