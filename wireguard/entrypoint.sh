#!/bin/bash
set -euo pipefail

CONFIG=/etc/wireguard/wgyc.conf

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

# Migration: Altes wg0-Interface entfernen (falls vorhanden)
if ip link show wg0 &>/dev/null; then
  echo "[WireGuard] Entferne altes wg0-Interface..."
  wg-quick down wg0 2>/dev/null || true
fi

echo "[WireGuard] Starte Interface wgyc..."
wg-quick up wgyc

# Erlaube dem Backend-Container, VPN-Traffic über diesen Container zu routen.
# Backend sendet Pakete an 10.x.x.x → dieser Container leitet sie via wgyc weiter.
echo "[WireGuard] Setze Forwarding-Regeln für Backend-Container..."
iptables -A FORWARD -i eth0 -o wgyc -j ACCEPT
iptables -A FORWARD -i wgyc -o eth0 -j ACCEPT
iptables -t nat -A POSTROUTING -o wgyc -j MASQUERADE
echo "[WireGuard] Forwarding aktiv (eth0 ↔ wgyc)"

reload_wg() {
  echo "[WireGuard] Reload via SIGHUP..."
  if wg syncconf wgyc <(wg-quick strip wgyc) 2>/dev/null; then
    echo "[WireGuard] Reload erfolgreich"
  else
    echo "[WireGuard] syncconf fehlgeschlagen – starte Interface neu..."
    wg-quick down wgyc 2>/dev/null || true
    wg-quick up wgyc
  fi
}

cleanup() {
  echo "[WireGuard] Beende..."
  wg-quick down wgyc 2>/dev/null || true
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
