# homebridge-kasa-camera

Homebridge plugin for TP-Link Kasa cameras. Exposes your Kasa cameras as HomeKit cameras with live video streaming and snapshot thumbnails.

## How it works

The plugin manages a [go2rtc](https://github.com/AlexxIT/go2rtc) process that connects to your Kasa camera using its proprietary HTTPS streaming protocol. The stream is then re-encoded via ffmpeg and sent to HomeKit over SRTP.

```
Kasa Camera (port 19443) → go2rtc (kasa:// protocol) → RTSP → ffmpeg → SRTP → HomeKit
```

## Prerequisites

- [Homebridge](https://homebridge.io) v1.8+ or v2.0+
- Node.js 20, 22, or 24
- ffmpeg installed on the host (with libx264 and libopus)
- A TP-Link Kasa camera on the same local network

## Installation

```bash
npm install -g homebridge-kasa-camera
```

Or install through the Homebridge UI by searching for "kasa camera".

## Configuration

Add the platform to your Homebridge `config.json`:

```json
{
  "platform": "KasaCamera",
  "cameras": [
    {
      "name": "Backyard",
      "ip": "192.168.1.100",
      "kasaEmail": "your-email@example.com",
      "kasaPassword": "your-kasa-password"
    }
  ]
}
```

Or configure through the Homebridge UI settings page.

| Field | Description |
|-------|-------------|
| `name` | Display name in the Home app |
| `ip` | Camera's local IP address |
| `kasaEmail` | Your TP-Link / Kasa account email |
| `kasaPassword` | Your TP-Link / Kasa account password |

Multiple cameras are supported — add additional objects to the `cameras` array.

## Compatible cameras

| Model | Status |
|-------|--------|
| KC420WS | Tested and working |
| KC400, KC410S, KD110, EC70 | Community-reported compatible |
| KC100, KC105 | Community-reported compatible (older models) |

All Kasa cameras that expose the HTTPS streaming endpoint on port 19443 should work.

## Known limitations

- **Audio** is not yet supported (camera's PCM mulaw format requires transcoding work)
- **Motion detection** is not yet supported
- **Auto-discovery** is not supported — cameras must be configured manually
- go2rtc is downloaded automatically on first run (~5MB binary)

## Troubleshooting

**Camera shows "No Response"**
- Verify the camera IP is correct and reachable from the Homebridge host
- Check that your Kasa email and password are correct
- Look at the Homebridge logs for error messages

**ffmpeg not found**
- Install ffmpeg: `sudo apt install ffmpeg` (Debian/Ubuntu) or `brew install ffmpeg` (macOS)
- Ensure ffmpeg is built with libx264 support: `ffmpeg -encoders | grep libx264`

**go2rtc download fails**
- Check internet connectivity from the Homebridge host
- The binary is downloaded from GitHub releases — ensure github.com is accessible

## License

Apache-2.0
