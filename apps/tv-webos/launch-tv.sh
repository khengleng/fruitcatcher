#!/usr/bin/env bash
#
# launch-tv.sh — find the LG webOS TV on the local network (even when its IP
# changed) and launch the Fruit Catcher app. No fixed IP needed.
#
# How it works: webOS Developer Mode exposes SSH on port 9922. This script
# scans your current subnet for that port, points the saved ares device at the
# TV's current IP (keeping its existing passphrase), then installs/launches.
#
# Usage:
#   ./launch-tv.sh                 # find TV (device "HTV") and launch the app
#   ./launch-tv.sh officetv        # use a different saved device name
#   ./launch-tv.sh HTV --install   # also (re)install the IPK before launching
#
# Requirements: webOS ares-cli (ares-setup-device, ares-install, ares-launch),
# the TV in Developer Mode with Dev Mode app running, and the Mac on the same
# network/Wi-Fi as the TV.

set -euo pipefail

APP_ID="com.fruitcatcher.game"
DEVICE="${1:-HTV}"
INSTALL=false
[[ "${2:-}" == "--install" || "${1:-}" == "--install" ]] && INSTALL=true
[[ "${1:-}" == "--install" ]] && DEVICE="HTV"

DEV_PORT=9922
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IPK="$(ls -t "$SCRIPT_DIR"/${APP_ID}_*_all.ipk 2>/dev/null | head -1 || true)"

command -v ares-setup-device >/dev/null 2>&1 || { echo "❌ ares-cli not found. Install the webOS CLI (ares-*) first."; exit 1; }

echo "🔎 Detecting your network…"
# Find the active local IPv4 (Wi-Fi en0, then ethernet en1, then default route).
MY_IP=""
for ifc in en0 en1 en2; do
  MY_IP="$(ipconfig getifaddr "$ifc" 2>/dev/null || true)"
  [[ -n "$MY_IP" ]] && break
done
if [[ -z "$MY_IP" ]]; then
  IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  [[ -n "$IFACE" ]] && MY_IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"
fi
[[ -z "$MY_IP" ]] && { echo "❌ Could not detect your local IP. Are you connected to Wi-Fi?"; exit 1; }

SUBNET="${MY_IP%.*}"
echo "   You: $MY_IP  →  scanning ${SUBNET}.1-254 for a webOS TV on port ${DEV_PORT}…"

# Parallel TCP scan for the dev SSH port.
CANDIDATES="$(
  for i in $(seq 1 254); do
    host="${SUBNET}.${i}"
    ( nc -z -G 1 -w 1 "$host" "$DEV_PORT" >/dev/null 2>&1 && echo "$host" ) &
  done
  wait
)"

if [[ -z "$CANDIDATES" ]]; then
  echo "❌ No device with port ${DEV_PORT} found on ${SUBNET}.0/24."
  echo "   • Make sure the TV is ON, on the same Wi-Fi, and the Developer Mode app is OPEN."
  echo "   • If the passphrase on the TV's Dev Mode screen also changed, run:"
  echo "       ares-setup-device --modify \"$DEVICE\" --info \"host=<TV-IP>\" --info \"passphrase=<NEW>\""
  exit 1
fi

# Try each candidate: point the saved device at it, then verify it answers.
TV_IP=""
for host in $CANDIDATES; do
  echo "   • Found ${host}:${DEV_PORT} — verifying it's the TV (device \"$DEVICE\")…"
  ares-setup-device --modify "$DEVICE" --info "host=${host}" >/dev/null 2>&1 || true
  # Verify by actually connecting (lists installed apps). ares-device-info is
  # deprecated and errors out, so don't use it.
  if ares-install --device "$DEVICE" --list >/dev/null 2>&1; then
    TV_IP="$host"
    break
  fi
done

if [[ -z "$TV_IP" ]]; then
  echo "❌ Found open port(s) but couldn't authenticate as device \"$DEVICE\"."
  echo "   The Dev Mode PASSPHRASE likely changed too. Read it on the TV (Developer Mode app) and run:"
  echo "     ares-setup-device --modify \"$DEVICE\" --info \"host=<TV-IP>\" --info \"passphrase=<NEW>\""
  exit 1
fi

echo "✅ TV found at ${TV_IP} (device \"$DEVICE\")."

if $INSTALL; then
  [[ -z "$IPK" ]] && { echo "❌ No IPK found in $SCRIPT_DIR. Run 'ares-package .' first."; exit 1; }
  echo "📦 Installing $(basename "$IPK")…"
  ares-install --device "$DEVICE" "$IPK"
fi

echo "🚀 Launching ${APP_ID}…"
ares-launch --device "$DEVICE" "$APP_ID"
echo "🎉 Done. The app should now be open on the TV."
