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
