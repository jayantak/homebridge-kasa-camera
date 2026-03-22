import { describe, it, expect } from 'vitest';
import { buildKasaStreamUrl, generateGo2RtcConfig } from '../src/go2rtcManager.js';

describe('buildKasaStreamUrl', () => {
  it('encodes email @ as %40 and base64-encodes password', () => {
    const url = buildKasaStreamUrl({
      ip: '10.0.0.16',
      kasaEmail: 'user@example.com',
      kasaPassword: 'mypassword',
    });
    const expectedB64 = Buffer.from('mypassword').toString('base64');
    expect(url).toBe(
      `kasa://user%40example.com:${expectedB64}@10.0.0.16:19443/https/stream/mixed`,
    );
  });

  it('handles email with special characters', () => {
    const url = buildKasaStreamUrl({
      ip: '192.168.1.1',
      kasaEmail: 'user+tag@gmail.com',
      kasaPassword: 'pass',
    });
    expect(url).toContain('user+tag%40gmail.com');
  });
});

describe('generateGo2RtcConfig', () => {
  it('generates valid yaml config with ports and streams', () => {
    const config = generateGo2RtcConfig([
      { name: 'Backyard', ip: '10.0.0.16', kasaEmail: 'u@e.com', kasaPassword: 'p' },
    ], { apiPort: 11984, rtspPort: 18554 });

    expect(config).toContain('listen: ":11984"');
    expect(config).toContain('listen: ":18554"');
    expect(config).toContain('backyard:');
    expect(config).toContain('kasa://u%40e.com:');
    expect(config).toContain('@10.0.0.16:19443/https/stream/mixed');
  });

  it('sanitizes camera name to lowercase alphanumeric with underscores', () => {
    const config = generateGo2RtcConfig([
      { name: 'Front Door!', ip: '10.0.0.17', kasaEmail: 'u@e.com', kasaPassword: 'p' },
    ], { apiPort: 11984, rtspPort: 18554 });

    expect(config).toContain('front_door:');
  });

  it('handles multiple cameras', () => {
    const config = generateGo2RtcConfig([
      { name: 'Cam1', ip: '10.0.0.1', kasaEmail: 'u@e.com', kasaPassword: 'p' },
      { name: 'Cam2', ip: '10.0.0.2', kasaEmail: 'u@e.com', kasaPassword: 'p' },
    ], { apiPort: 11984, rtspPort: 18554 });

    expect(config).toContain('cam1:');
    expect(config).toContain('cam2:');
  });
});
