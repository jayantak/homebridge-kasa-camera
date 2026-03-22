#!/bin/bash
set -e

# ============================================
# Kasa Camera RTSP Stream Validation Script
# ============================================
# Before running, fill in your credentials:
#   KASA_EMAIL: your Kasa app login email
#   KASA_PASSWORD_B64: base64-encoded password
#     Generate with: echo -n 'yourpassword' | base64
#   CAMERA_IP: your camera's local IP address
# ============================================

KASA_EMAIL="${KASA_EMAIL:?Set KASA_EMAIL env var (e.g. user@example.com)}"
KASA_PASSWORD_B64="${KASA_PASSWORD_B64:?Set KASA_PASSWORD_B64 env var (base64-encoded password)}"
CAMERA_IP="${CAMERA_IP:?Set CAMERA_IP env var (e.g. 192.168.1.100)}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GO2RTC_BIN="$SCRIPT_DIR/go2rtc"
GO2RTC_CONFIG="$SCRIPT_DIR/go2rtc.yaml"
GO2RTC_VERSION="v1.9.14"

echo "=== Step 1: Download go2rtc ==="
if [ ! -f "$GO2RTC_BIN" ]; then
  echo "Downloading go2rtc $GO2RTC_VERSION for linux/aarch64..."
  curl -L -o "$GO2RTC_BIN" \
    "https://github.com/AlexxIT/go2rtc/releases/download/${GO2RTC_VERSION}/go2rtc_linux_arm64"
  chmod +x "$GO2RTC_BIN"
  echo "Downloaded."
else
  echo "go2rtc already exists, skipping download."
fi

echo ""
echo "=== Step 2: Generate go2rtc config ==="
# URL-encode the email (replace @ with %40)
KASA_EMAIL_ENCODED="${KASA_EMAIL//@/%40}"
STREAM_URL="kasa://${KASA_EMAIL_ENCODED}:${KASA_PASSWORD_B64}@${CAMERA_IP}:19443/https/stream/mixed"

cat > "$GO2RTC_CONFIG" <<EOF
streams:
  kasa_cam:
    - ${STREAM_URL}
EOF
echo "Config written to $GO2RTC_CONFIG"
echo "Stream URL: $STREAM_URL"

echo ""
echo "=== Step 3: Start go2rtc ==="
echo "Starting go2rtc in the background..."
"$GO2RTC_BIN" -config "$GO2RTC_CONFIG" &
GO2RTC_PID=$!
echo "go2rtc PID: $GO2RTC_PID"

# Give it a moment to start
sleep 3

echo ""
echo "=== Step 4: Test snapshot via ffmpeg ==="
SNAPSHOT_PATH="$SCRIPT_DIR/snapshot.jpg"
echo "Grabbing a snapshot from rtsp://localhost:8554/kasa_cam ..."
if ffmpeg -y -rtsp_transport tcp -i rtsp://localhost:8554/kasa_cam -frames:v 1 "$SNAPSHOT_PATH" 2>/dev/null; then
  echo "Snapshot saved to $SNAPSHOT_PATH"
  echo "SUCCESS: Stream is working!"
else
  echo "FAILED: Could not grab snapshot. Check go2rtc logs above."
fi

echo ""
echo "=== Step 5: Optional live playback ==="
echo "To test live playback, run:"
echo "  ffplay -rtsp_transport tcp rtsp://localhost:8554/kasa_cam"
echo ""
echo "go2rtc web UI available at: http://localhost:1984"
echo ""
echo "Press Ctrl+C to stop go2rtc when done."
wait $GO2RTC_PID
