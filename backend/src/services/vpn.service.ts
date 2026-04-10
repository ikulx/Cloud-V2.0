/**
 * VPN Service — WireGuard-Konfiguration für das Ycontrol-VPN
 *
 * IP-Schema:
 *   Zone A (Management):  10.0.x.y   → Techniker-PCs (peerIndex)
 *   Zone A (Server):      10.1.0.1   → Cloud-Server wg0-Interface
 *   Zone B (Geräte):      Frei wählbare /32-IPs im 10.x.x.x-Netz
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import http from 'http'

// ─── IP-Berechnungen ──────────────────────────────────────────────────────────

/**
 * IP-Adresse eines Techniker-Peers (Zone A: 10.0.x.y).
 * peerIndex 1 → 10.0.0.1, …, 254 → 10.0.0.254, 255 → 10.0.1.1 …
 */
export function peerIp(peerIndex: number): string {
  const zero = peerIndex - 1
  const x = Math.floor(zero / 254)
  const y = (zero % 254) + 1
  return `10.0.${x}.${y}`
}

// ─── WireGuard-Schlüsselgenerierung ──────────────────────────────────────────

/**
 * Generiert ein WireGuard-kompatibles X25519-Schlüsselpaar (Base64).
 * Nutzt ausschließlich Node.js-Bordmittel (keine externen Abhängigkeiten).
 */
export function generateWgKeypair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
  })
  // Die rohen 32 Byte befinden sich jeweils am Ende der DER-kodierten Schlüssel
  return {
    privateKey: (privateKey as unknown as Buffer).slice(-32).toString('base64'),
    publicKey:  (publicKey  as unknown as Buffer).slice(-32).toString('base64'),
  }
}

// ─── Config-Generierung ───────────────────────────────────────────────────────

export interface VpnSettings {
  serverPublicKey: string  // öffentlicher Schlüssel des Cloud-Servers
  serverEndpoint:  string  // z.B. "vpn.example.com:51820"
  serverPort:      number  // Standard: 51820
}

/**
 * Erzeugt die WireGuard-Konfigurationsdatei für einen Techniker-PC.
 * Der private Schlüssel wird NICHT eingetragen (der Techniker setzt
 * seinen eigenen Schlüssel ein).
 */
export function generatePeerConfig(opts: {
  peerIndex:   number
  settings:    VpnSettings
  allowedCidrs?: string[]   // leer = alle (10.0.0.0/13)
}): string {
  const { peerIndex, settings, allowedCidrs } = opts
  const ip = peerIp(peerIndex)
  const allowed = allowedCidrs?.length
    ? allowedCidrs.join(', ')
    : '10.0.0.0/13'    // Zone A + Zone B

  return `# Ycontrol VPN — Techniker-Konfiguration
# Peer-IP: ${ip}  |  Zugriff: ${allowed}
# Generiert: ${new Date().toISOString()}

[Interface]
Address    = ${ip}/32
PrivateKey = <HIER_PRIVATEN_SCHLUESSEL_EINTRAGEN>
DNS        = 10.1.0.1

[Peer]
# Ycontrol Cloud-Server
PublicKey           = ${settings.serverPublicKey}
Endpoint            = ${settings.serverEndpoint}
AllowedIPs          = ${allowed}
PersistentKeepalive = 25
`
}

/**
 * Erzeugt den [Peer]-Block, der auf dem Cloud-Server für einen
 * Techniker-Peer in die wg0.conf eingetragen werden muss.
 */
export function buildServerPeerBlock(opts: {
  peerIndex:  number
  peerName:   string
  publicKey:  string
}): string {
  const { peerIndex, peerName, publicKey } = opts
  const ip = peerIp(peerIndex)
  return `
# Peer: ${peerName}
[Peer]
PublicKey  = ${publicKey}
AllowedIPs = ${ip}/32
`
}

/** Erzeugt die wg0.conf-Konfiguration für einen Pi (device-basiert, kein NETMAP). */
export function generateDevicePiConfig(opts: {
  vpnIp:        string
  localPrefix:  string
  piPrivateKey: string
  settings:     VpnSettings
}): string {
  const { vpnIp, localPrefix, piPrivateKey, settings } = opts
  const localNet = `${localPrefix}.0/24`

  const postUp = [
    'iptables -A FORWARD -i %i -j ACCEPT',
    'iptables -A FORWARD -o %i -j ACCEPT',
    `iptables -t nat -A POSTROUTING -s ${localNet} -o eth0 -j MASQUERADE`,
  ].join('; ')

  const preDown = [
    'iptables -D FORWARD -i %i -j ACCEPT',
    'iptables -D FORWARD -o %i -j ACCEPT',
    `iptables -t nat -D POSTROUTING -s ${localNet} -o eth0 -j MASQUERADE`,
  ].join('; ')

  return `# Ycontrol VPN — Pi-Konfiguration
# Gerät VPN-IP: ${vpnIp}  |  Reales LAN: ${localNet}
# Generiert: ${new Date().toISOString()}

[Interface]
Address    = ${vpnIp}/32
PrivateKey = ${piPrivateKey}
PostUp     = ${postUp}
PreDown    = ${preDown}

[Peer]
# Ycontrol Cloud-Server
PublicKey           = ${settings.serverPublicKey}
Endpoint            = ${settings.serverEndpoint}
AllowedIPs          = 10.0.0.0/13
PersistentKeepalive = 25
`
}

/** Server-seitiger [Peer]-Block für ein Gerät. */
export function buildDevicePeerBlock(opts: {
  deviceName:  string
  vpnIp:       string
  localPrefix: string
  piPublicKey: string
}): string {
  const { deviceName, vpnIp, localPrefix, piPublicKey } = opts
  return `
# Gerät: ${deviceName}
[Peer]
PublicKey  = ${piPublicKey}
AllowedIPs = ${vpnIp}/32, ${localPrefix}.0/24
`
}

// ─── Server-Konfig-Sync ───────────────────────────────────────────────────────

export interface ServerConfigOpts {
  privateKey: string
  settings:   VpnSettings
  devices: Array<{ deviceName: string; vpnIp: string; localPrefix: string; piPublicKey: string | null }>
  peers:   Array<{ peerIndex: number; name: string; publicKey: string }>
}

/**
 * Schreibt die vollständige wg0.conf in den gemeinsamen Volume-Pfad
 * und sendet SIGHUP an den WireGuard-Container.
 * Fehler werden nur geloggt (kein Crash) – im Dev-Modus ohne Docker läuft das leer.
 */
export async function syncWireGuardConfig(opts: ServerConfigOpts, configPath: string, containerName: string): Promise<void> {
  const { privateKey, settings, devices, peers } = opts

  if (!privateKey) {
    console.warn('[VPN] VPN_SERVER_PRIVATE_KEY nicht gesetzt – wg0.conf wird nicht geschrieben')
    return
  }

  const deviceBlocks = devices
    .filter((d) => d.piPublicKey)
    .map((d) => buildDevicePeerBlock({
      deviceName:  d.deviceName,
      vpnIp:       d.vpnIp,
      localPrefix: d.localPrefix,
      piPublicKey: d.piPublicKey!,
    }))
    .join('')

  const peerBlocks = peers
    .map((p) => buildServerPeerBlock({ peerIndex: p.peerIndex, peerName: p.name, publicKey: p.publicKey }))
    .join('')

  const config = `# Ycontrol VPN — Server-Konfiguration (wg0.conf)
# Automatisch generiert: ${new Date().toISOString()}

[Interface]
Address    = 10.1.0.1/8
ListenPort = ${settings.serverPort}
PrivateKey = ${privateKey}

# ─── Geräte ──────────────────────────────────────────────────────────────────
${deviceBlocks}
# ─── Techniker-Peers ─────────────────────────────────────────────────────────
${peerBlocks}`

  try {
    const dir = path.dirname(configPath)
    if (!fs.existsSync(dir)) {
      console.warn(`[VPN] Config-Verzeichnis existiert nicht: ${dir} – überspringe Schreiben`)
      return
    }
    fs.writeFileSync(configPath, config, { mode: 0o600 })
    console.log(`[VPN] wg0.conf geschrieben: ${configPath}`)
    await reloadWireGuard(containerName)
  } catch (err) {
    console.error('[VPN] Fehler beim Schreiben der wg0.conf:', err)
  }
}

/**
 * Sendet SIGHUP an den WireGuard-Container via Docker-Socket-API.
 * Bewirkt wg syncconf (Hot-Reload ohne Verbindungsunterbrechung).
 */
function reloadWireGuard(containerName: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        socketPath: '/var/run/docker.sock',
        path:       `/containers/${containerName}/kill?signal=SIGHUP`,
        method:     'POST',
      },
      (res) => {
        if (res.statusCode === 204) {
          console.log('[VPN] WireGuard-Reload ausgelöst (SIGHUP)')
        } else {
          console.warn(`[VPN] Docker-API SIGHUP: HTTP ${res.statusCode}`)
        }
        resolve()
      }
    )
    req.on('error', (err) => {
      console.warn('[VPN] Docker-Socket nicht erreichbar (Dev-Modus?):', err.message)
      resolve()
    })
    req.end()
  })
}
