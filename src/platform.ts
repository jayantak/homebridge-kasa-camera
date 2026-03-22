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
