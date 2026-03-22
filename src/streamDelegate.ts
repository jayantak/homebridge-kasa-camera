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
