import { describe, it, expect } from 'vitest';
import { buildDirectStreamUrl } from '../src/streamDelegate.js';

describe('buildDirectStreamUrl', () => {
  it('builds HTTPS URL with credentials and video-only query param', () => {
    const url = buildDirectStreamUrl({
      ip: '10.0.0.16',
      kasaEmail: 'user@example.com',
      kasaPassword: 'mypassword',
    });
    expect(url).toBe(
      'https://user%40example.com:mypassword@10.0.0.16:19443/https/stream/mixed?video=h264',
    );
  });

  it('encodes special characters in password', () => {
    const url = buildDirectStreamUrl({
      ip: '10.0.0.16',
      kasaEmail: 'user@example.com',
      kasaPassword: 'p@ss:word/123',
    });
    expect(url).toBe(
      'https://user%40example.com:p%40ss%3Aword%2F123@10.0.0.16:19443/https/stream/mixed?video=h264',
    );
  });

  it('encodes special characters in email local part', () => {
    const url = buildDirectStreamUrl({
      ip: '192.168.1.1',
      kasaEmail: 'user+tag@gmail.com',
      kasaPassword: 'pass',
    });
    expect(url).toContain('user%2Btag%40gmail.com:pass@');
  });
});
