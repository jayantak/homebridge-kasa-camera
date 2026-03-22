# homebridge-kasa-camera Design Spec

## Overview

A Homebridge plugin that exposes TP-Link Kasa cameras as HomeKit cameras, supporting live video streaming and snapshots. The plugin manages go2rtc as a child process to handle Kasa's proprietary HTTPS streaming protocol and re-expose it as standard RTSP for ffmpeg consumption.

## Scope

### In scope (v1)
- Live video streaming in HomeKit (1080p H.264)
- Snapshot thumbnails
- Manual camera configuration (IP, credentials)
- Automatic go2rtc binary download and lifecycle management
- Multi-camera support
- Cross-platform (linux/arm64, linux/amd64, darwin/arm64, darwin/amd64)

### Out of scope (v1)
- Motion detection
- Auto-discovery of cameras on the network
- Two-way audio
- Recording / HKSV (HomeKit Secure Video)

## Validated Assumptions

Tested on 2026-03-22 with a KC420WS camera:
- Camera streams H.264 1080p @ 15fps with PCM mulaw audio over HTTPS on port 19443
- go2rtc v1.9.14 successfully connects via `kasa://` protocol and re-exposes as RTSP
- ffmpeg can grab snapshots and consume live streams from go2rtc's RTSP output
- Auth format: TP-Link/Kasa email + base64-encoded password in the kasa:// URL

## Architecture

### Components

**1. KasaCameraPlatform**
- Registers with Homebridge as a dynamic platform plugin
- Reads camera configs from Homebridge config.json
- Creates one accessory per configured camera
- Starts the Go2RtcManager on `didFinishLaunching`

**2. KasaCameraAccessory**
- Exposes HomeKit `CameraRTPStreamManagement` service
- Sets accessory info (manufacturer: TP-Link, model: Kasa Camera)
- Delegates streaming to KasaCameraStreamDelegate

**3. Go2RtcManager**
- Downloads the correct go2rtc binary on first run (platform + arch aware)
- Stores binary in homebridge storage path (`<storagePath>/kasa-camera/go2rtc`)
- Generates go2rtc.yaml config from the camera list
- Launches go2rtc as a child process
- Restarts on crash with exponential backoff (1s → 60s cap)
- Kills process on homebridge shutdown (SIGTERM, 5s grace, SIGKILL)

**4. KasaCameraStreamDelegate**
- Implements Homebridge `CameraStreamingDelegate`
- On stream request: spawns ffmpeg to pull from `rtsp://localhost:<rtspPort>/<cameraName>` and transcode to SRTP for HomeKit
- On snapshot request: spawns ffmpeg to grab a single frame as JPEG
- Tracks and cleans up ffmpeg processes per session

### Data Flow

```
Kasa Camera (port 19443, HTTPS)
    → go2rtc child process (kasa:// protocol)
    → RTSP (localhost:18554)
    → ffmpeg (spawned per HomeKit request)
    → SRTP
    → HomeKit / Home app
```

### go2rtc Config (generated)

```yaml
api:
  listen: ":11984"
rtsp:
  listen: ":18554"
streams:
  backyard:
    - kasa://user%40example.com:base64pass@10.0.0.16:19443/https/stream/mixed
  front_door:
    - kasa://user%40example.com:base64pass@10.0.0.17:19443/https/stream/mixed
```

Non-default ports (11984, 18554) to avoid conflicts with standalone go2rtc instances.

## Configuration

### Homebridge config.json

```json
{
  "platform": "KasaCamera",
  "cameras": [
    {
      "name": "Backyard",
      "ip": "10.0.0.16",
      "kasaEmail": "user@example.com",
      "kasaPassword": "plaintext-password"
    }
  ]
}
```

The plugin base64-encodes the password and URL-encodes the email internally.

### config.schema.json

Provides the Homebridge UI form with fields for:
- `cameras[]` — array of camera objects
  - `name` (string, required) — display name in HomeKit
  - `ip` (string, required) — camera's local IP address
  - `kasaEmail` (string, required) — TP-Link/Kasa account email
  - `kasaPassword` (string, required) — TP-Link/Kasa account password

## Error Handling

### go2rtc lifecycle
- Binary download failure: log error, mark cameras unavailable, don't crash homebridge
- Process crash: restart with exponential backoff (1s, 2s, 4s... capped at 60s)
- Shutdown: SIGTERM → 5s grace → SIGKILL

### Stream resilience
- Camera unreachable: go2rtc handles reconnection internally
- ffmpeg processes tracked per session, killed when HomeKit ends stream
- Snapshot failure: returns error to HomeKit (shows "No Response" in Home app)

### Port conflicts
- go2rtc uses non-default ports (18554 RTSP, 11984 API) to avoid conflicts
- Ports are not user-configurable in v1 (can add if needed)

## go2rtc Binary Management

- Binary downloaded from GitHub releases on first run
- Version pinned in plugin source (updated with plugin releases)
- Platform detection via `process.platform` + `process.arch`
- Supported platforms: linux-arm64, linux-amd64, darwin-arm64, darwin-amd64

## Tech Stack

- TypeScript (ESM)
- Based on homebridge-plugin-template structure
- Dependencies: homebridge, homebridge-lib (from template)
- go2rtc: managed as external binary (not an npm dependency)
- ffmpeg: required on host (not bundled)

## Compatible Cameras

Known compatible Kasa camera models (all use the same HTTPS streaming endpoint):
- KC420WS (validated)
- KC400, KC410S, KD110, EC70 (community-reported)
- KC100, KC105 (community-reported, older models)
