# Bypass go2rtc: Direct HTTPS Camera Streaming

## Problem

The live stream stutters due to go2rtc's `kasa://` protocol implementation. The stutter is visible in go2rtc's own WebRTC player, confirming it's upstream of our plugin. The Kasa app streams smoothly, proving the camera and WiFi are fine.

## Solution

Remove go2rtc entirely. Have ffmpeg connect directly to the camera's HTTPS streaming endpoint for both live streams and snapshots.

The camera exposes an HTTPS endpoint at `https://<email>:<password>@<ip>:19443/https/stream/mixed?video=h264` that serves an H.264 video stream. This was validated working with curl using `-k` (skip TLS verification).

## Design

### Files to delete

- `src/go2rtcManager.ts` — all go2rtc logic (binary download, config generation, process management)
- `test/go2rtcManager.test.ts` — tests for the deleted module

### Files to modify

**`src/settings.ts`**
- Remove `GO2RTC_VERSION`, `GO2RTC_API_PORT`, `GO2RTC_RTSP_PORT` constants
- Add `CameraConfig` interface (relocated from `go2rtcManager.ts`)

**`src/streamDelegate.ts`**
- Constructor accepts `CameraConfig` (from settings) and `cameraName` (for logging) instead of just `cameraName`
- New private getter builds direct HTTPS URL: `https://<email>:<password>@<ip>:19443/https/stream/mixed?video=h264`
  - Both email and password are encoded with `encodeURIComponent()` to handle `@`, `:`, `/`, `#`, and other special characters
- ffmpeg input args change from `-rtsp_transport tcp -i rtsp://localhost:18554/<name>` to `-tls_verify 0 -i <httpsUrl>`
- Both `handleSnapshotRequest` and `startStream` use the direct HTTPS URL
- Audio remains disabled (`-an`, video-only query param)
- Redact credentials from the ffmpeg args log line (log at DEBUG level, mask the URL)

**`src/cameraAccessory.ts`**
- Pass device config to `KasaCameraStreamDelegate` alongside camera name
- Remove `sanitizeCameraName` import from go2rtcManager; use simple name from `accessory.displayName` for logging

**`src/platform.ts`**
- Remove `Go2RtcManager` import and instance
- Import `CameraConfig` from `settings.ts` instead
- Remove `go2rtcManager.start()` call and 2-second startup delay
- Remove go2rtc shutdown handler
- Camera registration logic unchanged

**`README.md`**
- Update "How it works" section: remove go2rtc from the pipeline diagram
- New pipeline: `Kasa Camera (port 19443) → ffmpeg (direct HTTPS) → SRTP → HomeKit`
- Remove "go2rtc is downloaded automatically" from known limitations
- Remove "go2rtc download fails" troubleshooting entry

**`package.json`**
- Update `description` to remove "via go2rtc"

**`.gitignore`**
- Remove `validation/go2rtc` entry (no longer relevant)

### What stays the same

- HAP camera controller setup, streaming options, SRTP encryption
- Video re-encoding pipeline (libx264, ultrafast, zerolatency)
- Snapshot pipeline (grab one frame, scale, pipe to buffer)
- Platform accessory discovery/caching logic

### Audio

Audio is disabled. The HTTPS URL requests video only (`?video=h264`). ffmpeg uses `-an`. This avoids PCM mulaw timestamp issues encountered previously. Re-enabling audio later is a trivial change.

### Tradeoffs

- **No multiplexing**: go2rtc multiplexed one camera connection across multiple RTSP consumers. With direct HTTPS, each stream is a separate camera connection. `cameraStreamCount` is 2, so at most 2 concurrent connections. Kasa cameras support this — the Kasa app and go2rtc could run simultaneously in prior testing.
- **No automatic reconnection**: go2rtc had exponential-backoff restart logic. With direct ffmpeg, if the camera drops, ffmpeg exits and HomeKit shows "No Response" until the user retries. This matches how most Homebridge camera plugins behave and is acceptable for now.

## Testing

- Build must compile cleanly (`npm run build`)
- Existing tests must pass (`npm test`) after removing the go2rtc test file
- Manual test on Pi: verify live stream plays without stutter in Home app
- Manual test: verify snapshots render correctly
