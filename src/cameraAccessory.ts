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
