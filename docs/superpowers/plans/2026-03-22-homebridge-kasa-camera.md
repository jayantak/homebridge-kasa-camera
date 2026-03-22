# homebridge-kasa-camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Homebridge plugin that exposes TP-Link Kasa cameras as HomeKit cameras with live streaming and snapshots, using go2rtc as a managed child process.

**Architecture:** The plugin registers as a Homebridge dynamic platform. On launch, it starts a go2rtc child process configured with the user's Kasa camera credentials. Each camera is exposed as a HomeKit accessory with a CameraStreamingDelegate that spawns ffmpeg to pull RTSP from go2rtc and transcode to SRTP for HomeKit.

**Tech Stack:** TypeScript (ESM), Homebridge 2.x API, go2rtc (external binary), ffmpeg (host dependency)

**Spec:** `docs/superpowers/specs/2026-03-22-homebridge-kasa-camera-design.md`

---

## File Structure

```
homebridge-kasa-camera/
├── src/
│   ├── index.ts                  # Plugin registration entry point
│   ├── settings.ts               # Constants: names, ports, go2rtc version
│   ├── platform.ts               # KasaCameraPlatform - dynamic platform plugin
│   ├── cameraAccessory.ts        # KasaCameraAccessory - HomeKit accessory setup
│   ├── streamDelegate.ts         # KasaCameraStreamDelegate - ffmpeg streaming + snapshots
│   └── go2rtcManager.ts          # Go2RtcManager - binary download, config gen, process lifecycle
├── test/
│   ├── go2rtcManager.test.ts     # Unit tests for config generation, URL building
│   └── hbConfig/                 # Homebridge test config directory (from template)
├── config.schema.json            # Homebridge UI schema
├── package.json
├── tsconfig.json
├── eslint.config.js
├── nodemon.json
├── .gitignore
└── .npmignore
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `nodemon.json`, `.npmignore`
- Modify: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "homebridge-kasa-camera",
  "displayName": "Kasa Camera",
  "type": "module",
  "version": "0.1.0",
  "description": "Homebridge plugin for TP-Link Kasa cameras with live streaming and snapshots via go2rtc",
  "author": "Jay Kurumathur",
  "license": "Apache-2.0",
  "homepage": "https://github.com/jayantak/homebridge-kasa-camera#readme",
  "repository": {
    "type": "git",
    "url": "https://github.com/jayantak/homebridge-kasa-camera.git"
  },
  "bugs": {
    "url": "https://github.com/jayantak/homebridge-kasa-camera/issues"
  },
  "keywords": [
    "homebridge-plugin",
    "kasa",
    "tp-link",
    "camera",
    "rtsp"
  ],
  "main": "dist/index.js",
  "engines": {
    "node": "^20.18.0 || ^22.10.0 || ^24.0.0",
    "homebridge": "^1.8.0 || ^2.0.0-beta.0"
  },
  "scripts": {
    "build": "rimraf ./dist && tsc",
    "lint": "eslint . --max-warnings=0",
    "test": "node --experimental-vm-modules node_modules/.bin/vitest run",
    "test:watch": "node --experimental-vm-modules node_modules/.bin/vitest",
    "prepublishOnly": "npm run lint && npm run build",
    "watch": "npm run build && npm link && nodemon"
  },
  "dependencies": {},
  "devDependencies": {
    "@eslint/js": "^9.39.1",
    "@types/node": "^24.10.1",
    "eslint": "^9.39.1",
    "homebridge": "^2.0.0-beta.55",
    "nodemon": "^3.1.11",
    "rimraf": "^6.1.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.46.4",
    "vitest": "^3.1.0"
  }
}
```

Note: No `homebridge-lib` dependency — not needed for camera plugins. Using `vitest` for testing (fast, ESM-native).

- [ ] **Step 2: Create tsconfig.json**

Copy from template exactly (ES2022, nodenext, strict, outDir dist).

- [ ] **Step 3: Create eslint.config.js**

Copy from template exactly.

- [ ] **Step 4: Create nodemon.json**

Copy from template exactly.

- [ ] **Step 5: Create .npmignore**

Copy from template exactly.

- [ ] **Step 6: Update .gitignore**

Add `node_modules/`, `dist/`, `.vscode/`, `.idea/`, `.DS_Store` to existing .gitignore.

- [ ] **Step 7: Run `npm install`**

Run: `npm install`
Expected: Clean install, `node_modules/` created, no errors.

- [ ] **Step 8: Verify build toolchain**

Run: `npx tsc --version`
Expected: TypeScript version printed.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.js nodemon.json .npmignore .gitignore
git commit -m "feat: project scaffolding with build toolchain"
```

---

### Task 2: Settings, index, and config schema

**Files:**
- Create: `src/settings.ts`, `src/index.ts`, `config.schema.json`

- [ ] **Step 1: Create src/settings.ts**

```typescript
export const PLATFORM_NAME = 'KasaCamera';
export const PLUGIN_NAME = 'homebridge-kasa-camera';

export const GO2RTC_VERSION = 'v1.9.14';
export const GO2RTC_API_PORT = 11984;
export const GO2RTC_RTSP_PORT = 18554;
```

- [ ] **Step 2: Create src/index.ts**

```typescript
import type { API } from 'homebridge';

import { KasaCameraPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, KasaCameraPlatform);
};
```

Note: This won't compile yet — `platform.ts` doesn't exist. That's fine, we'll create it in Task 4.

- [ ] **Step 3: Create config.schema.json**

```json
{
  "pluginAlias": "KasaCamera",
  "pluginType": "platform",
  "singular": true,
  "strictValidation": false,
  "schema": {
    "type": "object",
    "required": ["cameras"],
    "properties": {
      "name": {
        "title": "Platform Name",
        "type": "string",
        "default": "Kasa Camera"
      },
      "cameras": {
        "title": "Cameras",
        "type": "array",
        "items": {
          "type": "object",
          "required": ["name", "ip", "kasaEmail", "kasaPassword"],
          "properties": {
            "name": {
              "title": "Camera Name",
              "type": "string",
              "description": "Display name in HomeKit"
            },
            "ip": {
              "title": "Camera IP Address",
              "type": "string",
              "format": "ipv4",
              "description": "Local IP address of the Kasa camera"
            },
            "kasaEmail": {
              "title": "Kasa Account Email",
              "type": "string",
              "format": "email",
              "description": "TP-Link/Kasa account email"
            },
            "kasaPassword": {
              "title": "Kasa Account Password",
              "type": "string",
              "description": "TP-Link/Kasa account password"
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts src/index.ts config.schema.json
git commit -m "feat: add settings, plugin entry point, and config schema"
```

---

### Task 3: Go2RtcManager — config generation and URL building (TDD)

**Files:**
- Create: `src/go2rtcManager.ts`, `test/go2rtcManager.test.ts`

- [ ] **Step 1: Write failing tests for URL building and config generation**

```typescript
// test/go2rtcManager.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Implement buildKasaStreamUrl and generateGo2RtcConfig**

```typescript
// src/go2rtcManager.ts
import type { Logging } from 'homebridge';

export interface CameraConfig {
  name: string;
  ip: string;
  kasaEmail: string;
  kasaPassword: string;
}

export function buildKasaStreamUrl(camera: Omit<CameraConfig, 'name'>): string {
  const encodedEmail = camera.kasaEmail.replace(/@/g, '%40');
  const b64Password = Buffer.from(camera.kasaPassword).toString('base64');
  return `kasa://${encodedEmail}:${b64Password}@${camera.ip}:19443/https/stream/mixed`;
}

export function sanitizeCameraName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function generateGo2RtcConfig(
  cameras: CameraConfig[],
  ports: { apiPort: number; rtspPort: number },
): string {
  const streams = cameras.map((cam) => {
    const streamName = sanitizeCameraName(cam.name);
    const url = buildKasaStreamUrl(cam);
    return `  ${streamName}:\n    - ${url}`;
  }).join('\n');

  return [
    'api:',
    `  listen: ":${ports.apiPort}"`,
    'rtsp:',
    `  listen: ":${ports.rtspPort}"`,
    'streams:',
    streams,
    '',
  ].join('\n');
}
```

The Go2RtcManager class (download, process lifecycle) will be added in later tasks. Keep this file focused on the pure functions first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/go2rtcManager.ts test/go2rtcManager.test.ts
git commit -m "feat: go2rtc config generation and kasa URL building with tests"
```

---

### Task 4: Go2RtcManager — binary download and process lifecycle

**Files:**
- Modify: `src/go2rtcManager.ts`

- [ ] **Step 1: Add Go2RtcManager class with binary download**

Add to `src/go2rtcManager.ts`:

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { GO2RTC_API_PORT, GO2RTC_RTSP_PORT, GO2RTC_VERSION } from './settings.js';

function getGo2RtcBinaryName(): string {
  const platform = process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  return `go2rtc_${platform}_${arch}`;
}

function getGo2RtcDownloadUrl(): string {
  const binaryName = getGo2RtcBinaryName();
  return `https://github.com/AlexxIT/go2rtc/releases/download/${GO2RTC_VERSION}/${binaryName}`;
}

export class Go2RtcManager {
  private process: ChildProcess | null = null;
  private restartAttempts = 0;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private readonly storagePath: string;
  private readonly configPath: string;
  private readonly binaryPath: string;

  constructor(
    private readonly log: Logging,
    private readonly cameras: CameraConfig[],
    storagePath: string,
  ) {
    this.storagePath = join(storagePath, 'kasa-camera');
    this.binaryPath = join(this.storagePath, 'go2rtc');
    this.configPath = join(this.storagePath, 'go2rtc.yaml');
  }

  async start(): Promise<void> {
    try {
      await mkdir(this.storagePath, { recursive: true });
      await this.ensureBinary();
      await this.writeConfig();
      this.spawn();
    } catch (err) {
      this.log.error('Failed to start go2rtc:', (err as Error).message);
    }
  }

  stop(): void {
    this.stopping = true;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    if (this.process) {
      this.log.info('Stopping go2rtc...');
      this.process.kill('SIGTERM');
      const forceKill = setTimeout(() => {
        if (this.process) {
          this.log.warn('go2rtc did not exit gracefully, sending SIGKILL');
          this.process.kill('SIGKILL');
        }
      }, 5000);
      this.process.once('exit', () => clearTimeout(forceKill));
    }
  }

  private async ensureBinary(): Promise<void> {
    try {
      await access(this.binaryPath);
      this.log.debug('go2rtc binary already exists');
      return;
    } catch {
      // Binary doesn't exist, download it
    }

    const url = getGo2RtcDownloadUrl();
    this.log.info(`Downloading go2rtc ${GO2RTC_VERSION} from ${url}...`);

    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download go2rtc: ${response.status} ${response.statusText}`);
    }

    const fileStream = createWriteStream(this.binaryPath);
    await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream);
    await chmod(this.binaryPath, 0o755);
    this.log.info('go2rtc downloaded successfully');
  }

  private async writeConfig(): Promise<void> {
    const config = generateGo2RtcConfig(this.cameras, {
      apiPort: GO2RTC_API_PORT,
      rtspPort: GO2RTC_RTSP_PORT,
    });
    await writeFile(this.configPath, config, 'utf-8');
    this.log.debug('go2rtc config written to', this.configPath);
  }

  private spawn(): void {
    this.log.info('Starting go2rtc...');
    this.process = spawn(this.binaryPath, ['-config', this.configPath]);

    this.process.stdout?.on('data', (data: Buffer) => {
      this.log.debug('[go2rtc]', data.toString().trim());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.log.debug('[go2rtc]', data.toString().trim());
    });

    this.process.on('exit', (code) => {
      this.process = null;
      if (this.stopping) {
        this.log.info('go2rtc stopped');
        return;
      }
      this.log.warn(`go2rtc exited with code ${code}, restarting...`);
      this.scheduleRestart();
    });

    this.process.on('error', (err) => {
      this.log.error('go2rtc process error:', err.message);
    });

    // Reset restart counter after process runs stably for 30s
    setTimeout(() => {
      if (this.process && !this.stopping) {
        this.restartAttempts = 0;
      }
    }, 30000);
  }

  private scheduleRestart(): void {
    const delay = Math.min(1000 * Math.pow(2, this.restartAttempts), 60000);
    this.restartAttempts++;
    this.log.info(`Restarting go2rtc in ${delay / 1000}s (attempt ${this.restartAttempts})...`);
    this.restartTimeout = setTimeout(() => {
      this.spawn();
    }, delay);
  }
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors (index.ts will fail because platform.ts doesn't exist — that's expected, we can skip strict check for now or create a stub).

Actually, create a minimal stub `src/platform.ts` to make the build pass:

```typescript
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

export class KasaCameraPlatform implements DynamicPlatformPlugin {
  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('KasaCameraPlatform stub');
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
  }
}
```

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run existing tests still pass**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/go2rtcManager.ts src/platform.ts
git commit -m "feat: go2rtc binary download and process lifecycle management"
```

---

### Task 5: KasaCameraStreamDelegate — snapshots and live streaming

**Files:**
- Create: `src/streamDelegate.ts`

This is the core HomeKit integration. It implements `CameraStreamingDelegate` which Homebridge calls when HomeKit requests a live stream or snapshot.

- [ ] **Step 1: Create streamDelegate.ts with snapshot support**

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
  StreamingRequest,
  StreamRequestCallback,
} from 'homebridge';
import { spawn, type ChildProcess } from 'node:child_process';
import { GO2RTC_RTSP_PORT } from './settings.js';

interface SessionInfo {
  request: PrepareStreamRequest;
  videoSsrc: number;
  audioSsrc: number;
}

export class KasaCameraStreamDelegate implements CameraStreamingDelegate {
  private ffmpegProcesses: Map<string, ChildProcess> = new Map();
  private pendingSessions: Map<string, SessionInfo> = new Map();

  constructor(
    private readonly hap: HAP,
    private readonly log: Logging,
    private readonly cameraName: string,
  ) {}

  private get rtspUrl(): string {
    return `rtsp://localhost:${GO2RTC_RTSP_PORT}/${this.cameraName}`;
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    const args = [
      '-rtsp_transport', 'tcp',
      '-i', this.rtspUrl,
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

      this.startStream(sessionId, sessionInfo, request, callback);
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
    request: StreamingRequest,
    callback: StreamRequestCallback,
  ): void {
    const { request: session, videoSsrc, audioSsrc } = sessionInfo;
    const videoConfig = request.video;
    const audioConfig = request.audio;

    const targetAddress = session.targetAddress;
    const videoPort = session.video.port;
    const audioPort = session.audio.port;
    const videoSrtpKey = session.video.srtp_key;
    const videoSrtpSalt = session.video.srtp_salt;
    const audioSrtpKey = session.audio.srtp_key;
    const audioSrtpSalt = session.audio.srtp_salt;

    const videoCryptoKey = Buffer.concat([videoSrtpKey, videoSrtpSalt]).toString('base64');
    const audioCryptoKey = Buffer.concat([audioSrtpKey, audioSrtpSalt]).toString('base64');

    const args = [
      '-rtsp_transport', 'tcp',
      '-i', this.rtspUrl,

      // Video output
      '-map', '0:v',
      '-vcodec', 'copy',
      '-an',
      '-payload_type', String(videoConfig.pt),
      '-ssrc', String(videoSsrc),
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', videoCryptoKey,
      `srtp://${targetAddress}:${videoPort}?rtcpport=${videoPort}&pkt_size=1316`,

      // Audio output
      '-map', '0:a',
      '-acodec', 'libopus',
      '-application', 'lowdelay',
      '-ac', '1',
      '-ar', '24000',
      '-b:a', '24k',
      '-payload_type', String(audioConfig.pt),
      '-ssrc', String(audioSsrc),
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', audioCryptoKey,
      `srtp://${targetAddress}:${audioPort}?rtcpport=${audioPort}&pkt_size=188`,
    ];

    this.log.info('Starting stream for', this.cameraName);
    this.log.debug('ffmpeg args:', args.join(' '));

    const ffmpeg = spawn('ffmpeg', args, { env: process.env });

    ffmpeg.stderr.on('data', (data: Buffer) => {
      this.log.debug('[ffmpeg stream]', data.toString().trim());
    });

    ffmpeg.on('error', (err) => {
      this.log.error('ffmpeg stream error:', err.message);
    });

    ffmpeg.on('close', (code) => {
      this.log.debug('ffmpeg stream exited with code', code);
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

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/streamDelegate.ts
git commit -m "feat: camera streaming delegate with snapshot and live stream support"
```

---

### Task 6: KasaCameraAccessory — HomeKit accessory setup

**Files:**
- Create: `src/cameraAccessory.ts`

- [ ] **Step 1: Create cameraAccessory.ts**

```typescript
// src/cameraAccessory.ts
import type { PlatformAccessory } from 'homebridge';
import type { KasaCameraPlatform } from './platform.js';
import { KasaCameraStreamDelegate } from './streamDelegate.js';
import { sanitizeCameraName } from './go2rtcManager.js';

export class KasaCameraAccessory {
  constructor(
    private readonly platform: KasaCameraPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const cameraName = sanitizeCameraName(accessory.context.device.name);

    this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'TP-Link')
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, 'Kasa Camera')
      .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, accessory.context.device.ip);

    const delegate = new KasaCameraStreamDelegate(
      this.platform.api.hap,
      this.platform.log,
      cameraName,
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

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/cameraAccessory.ts
git commit -m "feat: camera accessory with HomeKit controller setup"
```

---

### Task 7: KasaCameraPlatform — wire everything together

**Files:**
- Modify: `src/platform.ts` (replace stub)

- [ ] **Step 1: Implement full platform**

```typescript
// src/platform.ts
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { KasaCameraAccessory } from './cameraAccessory.js';
import { type CameraConfig, Go2RtcManager } from './go2rtcManager.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export class KasaCameraPlatform implements DynamicPlatformPlugin {
  private readonly accessories: Map<string, PlatformAccessory> = new Map();
  private go2rtcManager?: Go2RtcManager;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Initializing KasaCameraPlatform');

    this.api.on('didFinishLaunching', () => {
      this.launchCameras();
    });

    this.api.on('shutdown', () => {
      this.go2rtcManager?.stop();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  private async launchCameras(): Promise<void> {
    const cameras: CameraConfig[] = this.config.cameras || [];

    if (cameras.length === 0) {
      this.log.warn('No cameras configured');
      return;
    }

    // Start go2rtc
    this.go2rtcManager = new Go2RtcManager(
      this.log,
      cameras,
      this.api.user.storagePath(),
    );
    await this.go2rtcManager.start();

    // Give go2rtc a moment to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

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

- [ ] **Step 2: Build the full project**

Run: `npm run build`
Expected: Clean build, `dist/` populated with compiled JS.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No errors. Fix any lint issues.

- [ ] **Step 5: Commit**

```bash
git add src/platform.ts
git commit -m "feat: platform implementation wiring go2rtc, accessories, and streaming"
```

---

### Task 8: Integration test on Raspberry Pi

**Files:** No new files — testing the built plugin on the Pi.

- [ ] **Step 1: Build the plugin**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 2: Copy and install on Pi**

```bash
# From local machine
rsync -av --exclude node_modules --exclude .git . pi:~/homebridge-kasa-camera/

# On Pi
ssh pi "cd ~/homebridge-kasa-camera && npm install && npm run build"
```

- [ ] **Step 3: Link plugin to homebridge**

```bash
ssh pi "cd ~/homebridge-kasa-camera && npm link"
```

- [ ] **Step 4: Add config to homebridge**

Add to the Pi's homebridge `config.json` (typically `~/.homebridge/config.json`):

```json
{
  "platform": "KasaCamera",
  "cameras": [
    {
      "name": "Backyard",
      "ip": "10.0.0.16",
      "kasaEmail": "user@example.com",
      "kasaPassword": "your-kasa-password"
    }
  ]
}
```

- [ ] **Step 5: Restart homebridge and verify**

Restart homebridge and check logs for:
1. go2rtc downloads successfully
2. go2rtc starts and connects to camera
3. Camera accessory registers in HomeKit
4. Open Home app — camera should appear
5. Tap camera — live stream should load
6. Check thumbnail in Home app overview

- [ ] **Step 6: Commit any fixes needed**

If any fixes are needed from integration testing, commit them individually with descriptive messages.

---

### Task 9: README and cleanup

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Cover: what it does, prerequisites (ffmpeg, homebridge), installation (`npm install -g homebridge-kasa-camera`), configuration (with example), compatible cameras, troubleshooting tips (ffmpeg not found, camera unreachable, auth failure).

- [ ] **Step 2: Remove validation directory**

The `validation/` directory was for pre-development testing. Remove it from the repo now that the plugin itself is the validation.

```bash
git rm -r validation/
```

- [ ] **Step 3: Final lint and build check**

Run: `npm run lint && npm run build && npm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with installation and configuration guide"
```
