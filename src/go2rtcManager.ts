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
