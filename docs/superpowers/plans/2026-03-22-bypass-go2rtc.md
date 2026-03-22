# Bypass go2rtc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove go2rtc and have ffmpeg stream directly from the camera's HTTPS endpoint to eliminate live stream stutter.

**Architecture:** Delete go2rtc entirely (manager, config, binary download). Relocate `CameraConfig` to `settings.ts`. Update `streamDelegate.ts` to build a direct HTTPS URL and pass it to ffmpeg with `-tls_verify 0`. Update all consumers and docs.

**Tech Stack:** TypeScript, Homebridge API, ffmpeg (child_process), Vitest

**Spec:** `docs/superpowers/specs/2026-03-22-bypass-go2rtc-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/go2rtcManager.ts` | Delete | Was: go2rtc binary management, config, process lifecycle |
| `test/go2rtcManager.test.ts` | Delete | Was: tests for go2rtc URL building and config generation |
| `src/settings.ts` | Modify | Add `CameraConfig` interface, remove go2rtc constants |
| `src/streamDelegate.ts` | Modify | Build direct HTTPS URL, update ffmpeg args for stream + snapshot |
| `src/cameraAccessory.ts` | Modify | Pass camera config to stream delegate |
| `src/platform.ts` | Modify | Remove go2rtc startup, import `CameraConfig` from settings |
| `test/streamDelegate.test.ts` | Create | Test HTTPS URL building with credential encoding |
| `README.md` | Modify | Update architecture diagram, remove go2rtc references |
| `package.json` | Modify | Update description |
| `.gitignore` | Modify | Remove go2rtc entry |

---

### Task 1: Write failing tests for direct HTTPS URL building

**Files:**
- Create: `test/streamDelegate.test.ts`

- [ ] **Step 1: Write failing tests for URL construction**

Create `test/streamDelegate.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildDirectStreamUrl` is not exported from `streamDelegate.ts`. The codebase is unchanged so all existing imports still resolve; only the new test fails.

- [ ] **Step 3: Commit failing test**

```bash
git add test/streamDelegate.test.ts
git commit -m "test: add failing tests for direct HTTPS URL building"
```

---

### Task 2: Implement all source changes (settings, streamDelegate, cameraAccessory, platform, delete go2rtc)

All source files are updated atomically in this task to avoid a broken intermediate state. The go2rtc files are deleted after all references to them are removed.

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/streamDelegate.ts`
- Modify: `src/cameraAccessory.ts`
- Modify: `src/platform.ts`
- Delete: `src/go2rtcManager.ts`
- Delete: `test/go2rtcManager.test.ts`

- [ ] **Step 1: Update settings.ts — relocate CameraConfig, remove go2rtc constants**

Replace the entire `src/settings.ts` with:

```typescript
export const PLATFORM_NAME = 'KasaCamera';
export const PLUGIN_NAME = 'homebridge-kasa-camera';

export interface CameraConfig {
  name: string;
  ip: string;
  kasaEmail: string;
  kasaPassword: string;
}
```

- [ ] **Step 2: Update streamDelegate.ts — direct HTTPS streaming**

Replace the entire `src/streamDelegate.ts` with:

```typescript
// src/streamDelegate.ts
import type {
  CameraStreamingDelegate,
  HAP,
  Logging,
  PrepareStreamCallback,
  PrepareStreamRequest,
  SnapshotRequest,
  SnapshotRequestCallback,
  StartStreamRequest,
  StreamingRequest,
  StreamRequestCallback,
} from 'homebridge';
import { spawn, type ChildProcess } from 'node:child_process';

interface SessionInfo {
  request: PrepareStreamRequest;
  videoSsrc: number;
  audioSsrc: number;
}

export function buildDirectStreamUrl(camera: { ip: string; kasaEmail: string; kasaPassword: string }): string {
  const encodedEmail = encodeURIComponent(camera.kasaEmail);
  const encodedPassword = encodeURIComponent(camera.kasaPassword);
  return `https://${encodedEmail}:${encodedPassword}@${camera.ip}:19443/https/stream/mixed?video=h264`;
}

export class KasaCameraStreamDelegate implements CameraStreamingDelegate {
  private ffmpegProcesses: Map<string, ChildProcess> = new Map();
  private pendingSessions: Map<string, SessionInfo> = new Map();
  private readonly streamUrl: string;

  constructor(
    private readonly hap: HAP,
    private readonly log: Logging,
    private readonly cameraName: string,
    camera: { ip: string; kasaEmail: string; kasaPassword: string },
  ) {
    this.streamUrl = buildDirectStreamUrl(camera);
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    const args = [
      '-tls_verify', '0',
      '-i', this.streamUrl,
      '-frames:v', '1',
      '-f', 'image2',
      '-vf', `scale=${request.width}:${request.height}`,
      '-update', '1',
      'pipe:1',
    ];

    this.log.debug('Snapshot request:', request.width, 'x', request.height);

    const ffmpeg = spawn('ffmpeg', args, { env: process.env });
    const chunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (data: Buffer) => {
      this.log.debug('[ffmpeg snapshot]', data.toString().trim());
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        callback(undefined, Buffer.concat(chunks));
      } else {
        this.log.error('Snapshot ffmpeg exited with code', code);
        callback(new Error('Failed to capture snapshot'));
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      ffmpeg.kill('SIGKILL');
    }, 10000);
  }

  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    const sessionId = request.sessionID;
    const videoSsrc = this.hap.CameraController.generateSynchronisationSource();
    const audioSsrc = this.hap.CameraController.generateSynchronisationSource();

    const response = {
      video: {
        port: request.video.port,
        ssrc: videoSsrc,
        srtp_key: request.video.srtp_key,
        srtp_salt: request.video.srtp_salt,
      },
      audio: {
        port: request.audio.port,
        ssrc: audioSsrc,
        srtp_key: request.audio.srtp_key,
        srtp_salt: request.audio.srtp_salt,
      },
    };

    this.pendingSessions.set(sessionId, { request, videoSsrc, audioSsrc });
    callback(undefined, response);
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    const sessionId = request.sessionID;

    if (request.type === this.hap.StreamRequestTypes.START) {
      const sessionInfo = this.pendingSessions.get(sessionId);
      if (!sessionInfo) {
        this.log.error('No pending session for', sessionId);
        callback(new Error('No pending session'));
        return;
      }

      this.startStream(sessionId, sessionInfo, request as StartStreamRequest, callback);
    } else if (request.type === this.hap.StreamRequestTypes.STOP) {
      this.stopStream(sessionId);
      callback();
    } else {
      // RECONFIGURE — just acknowledge
      callback();
    }
  }

  private startStream(
    sessionId: string,
    sessionInfo: SessionInfo,
    request: StartStreamRequest,
    callback: StreamRequestCallback,
  ): void {
    const { request: session, videoSsrc } = sessionInfo;
    const videoConfig = request.video;

    const targetAddress = session.targetAddress;
    const videoPort = session.video.port;
    const videoSrtpKey = session.video.srtp_key;
    const videoSrtpSalt = session.video.srtp_salt;

    const videoCryptoKey = Buffer.concat([videoSrtpKey, videoSrtpSalt]).toString('base64');

    const vWidth = videoConfig.width;
    const vHeight = videoConfig.height;
    const vBitrate = Math.max(videoConfig.max_bit_rate, 1500);

    const args = [
      '-tls_verify', '0',
      '-fflags', '+genpts+nobuffer',
      '-flags', 'low_delay',
      '-i', this.streamUrl,

      // Video: re-encode with low-latency settings
      '-an',
      '-vcodec', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-vf', `scale=${vWidth}:${vHeight}`,
      '-b:v', `${vBitrate}k`,
      '-maxrate', `${vBitrate}k`,
      '-bufsize', `${vBitrate}k`,
      '-g', '30',
      '-r', '15',
      '-payload_type', String(videoConfig.pt),
      '-ssrc', String(videoSsrc),
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', videoCryptoKey,
      `srtp://${targetAddress}:${videoPort}?rtcpport=${videoPort}&pkt_size=1316`,
    ];

    this.log.info('Starting stream for', this.cameraName);
    this.log.debug('ffmpeg args:', args.map(a => a.startsWith('https://') ? 'https://***@***' : a).join(' '));

    const ffmpeg = spawn('ffmpeg', args, { env: process.env });

    ffmpeg.stderr.on('data', (data: Buffer) => {
      this.log.debug('[ffmpeg stream]', data.toString().trim());
    });

    ffmpeg.on('error', (err) => {
      this.log.error('ffmpeg stream error:', err.message);
    });

    ffmpeg.on('close', (code) => {
      this.log.info('ffmpeg stream exited with code', code);
      this.ffmpegProcesses.delete(sessionId);
    });

    this.ffmpegProcesses.set(sessionId, ffmpeg);
    this.pendingSessions.delete(sessionId);
    callback();
  }

  private stopStream(sessionId: string): void {
    const ffmpeg = this.ffmpegProcesses.get(sessionId);
    if (ffmpeg) {
      this.log.info('Stopping stream for', this.cameraName);
      ffmpeg.kill('SIGTERM');
      this.ffmpegProcesses.delete(sessionId);
    }
    this.pendingSessions.delete(sessionId);
  }
}
```

Key changes from the original:
- Removed `GO2RTC_RTSP_PORT` import and `rtspUrl` getter
- Added `buildDirectStreamUrl` exported function with `encodeURIComponent` on both email and password
- Constructor takes `camera` config object, builds `streamUrl` once
- Snapshot and stream: replaced `-rtsp_transport tcp` with `-tls_verify 0`
- Log line redacts credentials: `https://***@***`
- ffmpeg stderr changed from INFO to DEBUG level

- [ ] **Step 3: Update cameraAccessory.ts — pass camera config to stream delegate**

Replace the entire `src/cameraAccessory.ts` with:

```typescript
// src/cameraAccessory.ts
import type { PlatformAccessory } from 'homebridge';
import type { KasaCameraPlatform } from './platform.js';
import { KasaCameraStreamDelegate } from './streamDelegate.js';

export class KasaCameraAccessory {
  constructor(
    private readonly platform: KasaCameraPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'TP-Link')
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, 'Kasa Camera')
      .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, accessory.context.device.ip);

    const device = accessory.context.device;
    const delegate = new KasaCameraStreamDelegate(
      this.platform.api.hap,
      this.platform.log,
      accessory.displayName,
      { ip: device.ip, kasaEmail: device.kasaEmail, kasaPassword: device.kasaPassword },
    );

    const controller = new this.platform.api.hap.CameraController({
      cameraStreamCount: 2,
      delegate: delegate,
      streamingOptions: {
        supportedCryptoSuites: [this.platform.api.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: [
            [1920, 1080, 15],
            [1280, 720, 15],
            [640, 360, 15],
          ],
          codec: {
            profiles: [this.platform.api.hap.H264Profile.MAIN],
            levels: [this.platform.api.hap.H264Level.LEVEL4_0],
          },
        },
        audio: {
          twoWayAudio: false,
          codecs: [
            {
              type: this.platform.api.hap.AudioStreamingCodecType.OPUS,
              samplerate: this.platform.api.hap.AudioStreamingSamplerate.KHZ_24,
            },
          ],
        },
      },
    });

    this.accessory.configureController(controller);
    this.platform.log.info('Configured camera accessory:', accessory.displayName);
  }
}
```

- [ ] **Step 4: Update platform.ts — remove go2rtc manager**

Replace the entire `src/platform.ts` with:

```typescript
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { KasaCameraAccessory } from './cameraAccessory.js';
import type { CameraConfig } from './settings.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export class KasaCameraPlatform implements DynamicPlatformPlugin {
  private readonly accessories: Map<string, PlatformAccessory> = new Map();

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Initializing KasaCameraPlatform');

    this.api.on('didFinishLaunching', () => {
      this.launchCameras();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  private launchCameras(): void {
    const cameras: CameraConfig[] = this.config.cameras || [];

    if (cameras.length === 0) {
      this.log.warn('No cameras configured');
      return;
    }

    // Register camera accessories
    const discoveredUUIDs: string[] = [];

    for (const camera of cameras) {
      const uuid = this.api.hap.uuid.generate(camera.ip);
      discoveredUUIDs.push(uuid);

      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        this.log.info('Restoring camera from cache:', camera.name);
        existingAccessory.context.device = camera;
        new KasaCameraAccessory(this, existingAccessory);
      } else {
        this.log.info('Adding new camera:', camera.name);
        const accessory = new this.api.platformAccessory(camera.name, uuid);
        accessory.context.device = camera;
        new KasaCameraAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // Remove stale accessories
    for (const [uuid, accessory] of this.accessories) {
      if (!discoveredUUIDs.includes(uuid)) {
        this.log.info('Removing stale accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
```

- [ ] **Step 5: Delete go2rtc files**

```bash
rm src/go2rtcManager.ts test/go2rtcManager.test.ts
```

- [ ] **Step 6: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Build succeeds. All 3 tests in `test/streamDelegate.test.ts` pass. No go2rtc tests remain.

- [ ] **Step 7: Commit**

```bash
git add src/settings.ts src/streamDelegate.ts src/cameraAccessory.ts src/platform.ts
git add -u src/go2rtcManager.ts test/go2rtcManager.test.ts
git commit -m "feat: bypass go2rtc, stream directly from camera HTTPS endpoint

Remove go2rtc entirely. ffmpeg now connects directly to the camera's
HTTPS streaming endpoint with TLS verification disabled. This eliminates
the live stream stutter caused by go2rtc's kasa:// protocol.

- Relocate CameraConfig interface to settings.ts
- Use encodeURIComponent for credential encoding in URLs
- Redact credentials from log output
- Remove go2rtc binary download, config generation, process management
- Remove 2-second startup delay (no go2rtc to wait for)"
```

---

### Task 3: Update docs and metadata

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Update README.md**

In `README.md`:

Replace lines 7-11 (the "How it works" description paragraph and pipeline diagram) with:

```markdown
The plugin connects ffmpeg directly to your Kasa camera's HTTPS streaming endpoint (port 19443). The stream is re-encoded and sent to HomeKit over SRTP.

```
Kasa Camera (port 19443) → ffmpeg (direct HTTPS) → SRTP → HomeKit
```
```

Replace line 72 (go2rtc known limitation) with:

```markdown
- **First stream start** may take a few seconds while ffmpeg connects to the camera
```

Delete lines 85-87 (the "go2rtc download fails" troubleshooting entry and its two bullet points).

- [ ] **Step 2: Update package.json description**

Change line 6 from:
```json
"description": "Homebridge plugin for TP-Link Kasa cameras with live streaming and snapshots via go2rtc",
```
to:
```json
"description": "Homebridge plugin for TP-Link Kasa cameras with live streaming and snapshots",
```

- [ ] **Step 3: Update .gitignore**

Remove lines 17-18 (the go2rtc comment and path):
```
# go2rtc binary (downloaded at runtime)
validation/go2rtc
```

Keep `validation/snapshot.jpg` on line 19 but update its comment context. The resulting block should be:

```
# Validation artifacts
validation/snapshot.jpg
```

- [ ] **Step 4: Final build and test**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json .gitignore
git commit -m "docs: remove go2rtc references, update architecture description"
```
