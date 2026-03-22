export const PLATFORM_NAME = 'KasaCamera';
export const PLUGIN_NAME = 'homebridge-kasa-camera';

export interface CameraConfig {
  name: string;
  ip: string;
  kasaEmail: string;
  kasaPassword: string;
}
