#!/bin/bash
set -euo pipefail

CONFIG=/etc/wireguard/wg0.conf

echo "[WireGuard] Warte auf Konfiguration..."
for i in $(seq 1 30); do
  [ -f "$CONFIG" ] && break
  echo "[WireGuard] Warte... ($i/30)"
  sleep 2
done

if [ ! -f "$CONFIG" ]; then
  echo "[WireGuard] FEHLER: Keine Konfiguration nach 60s!" >&2
  exit 1
fi

echo "[WireGuard] Starte Interface wg0..."
wg-quick up wg0

reload_wg() {
  echo "[WireGuard] Reload via SIGHUP..."
  if wg syncconf wg0 <(wg-quick strip wg0) 2>/dev/null; then
    echo "[WireGuard] Reload erfolgreich"
  else
    echo "[WireGuard] syncconf fehlgeschlagen – starte Interface neu..."
    wg-quick down wg0 2>/dev/null || true
    wg-quick up wg0
  fi
}

cleanup() {
  echo "[WireGuard] Beende..."
  wg-quick down wg0 2>/dev/null || true
  exit 0
}

trap reload_wg SIGHUP
trap cleanup SIGTERM SIGINT

echo "[WireGuard] Läuft. Wartet auf Signale (SIGHUP=Reload, SIGTERM=Stop)."

# Keepalive: wacht in Schüben von 1h, reagiert aber sofort auf Signale
while true; do
  sleep 3600 &
  wait $! || true
done
