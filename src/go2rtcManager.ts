import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Logging } from 'homebridge';
import { GO2RTC_API_PORT, GO2RTC_RTSP_PORT, GO2RTC_VERSION } from './settings.js';

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
