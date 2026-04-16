/**
 * VPN Service — WireGuard-Konfiguration für das Ycontrol-VPN
 *
 * IP-Schema:
 *   Zone A (Management):  10.0.x.y   → Techniker-PCs (peerIndex)
 *   Zone A (Server):      10.1.0.1   → Cloud-Server wgyc-Interface
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
  peerIndex:    number
  settings:     VpnSettings
  privateKey?:  string       // Server-seitig generiert
  allowedCidrs?: string[]
}): string {
  const { peerIndex, settings, privateKey, allowedCidrs } = opts
  const ip = peerIp(peerIndex)
  // Nur VPN-Adressen (10.x.x.x) durch den Tunnel — Internet bleibt lokal
  const allowed = allowedCidrs?.length ? allowedCidrs.join(', ') : '10.0.0.0/8'

  return `# Ycontrol VPN — Techniker-Konfiguration
# Peer-IP: ${ip}  |  Zugriff: ${allowed}
# Generiert: ${new Date().toISOString()}

[Interface]
Address    = ${ip}/32
PrivateKey = ${privateKey ?? '<BITTE_PRIVATEN_SCHLUESSEL_EINTRAGEN>'}
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
 * Techniker-Peer in die wgyc.conf eingetragen werden muss.
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

/**
 * Leitet den VPN-LAN-Präfix aus der VPN-IP des Geräts ab.
 *
 * Schema: VPN-IP  10.A.0.B  →  VPN-LAN  10.A.B.0/24
 *
 * Beispiele:
 *   10.11.0.1   → 10.11.1.0/24   (erster Pi)
 *   10.11.0.2   → 10.11.2.0/24
 *   10.255.0.255 → 10.255.255.0/24 (letzter Pi)
 *
 * Zweites Oktett (A) bleibt, viertes Oktett (B) wird zum dritten.
 * Das dritte Oktett der VPN-IP ist immer 0.
 */
export function deriveVpnLanPrefix(vpnIp: string): string {
  const parts = vpnIp.split('.')
  // 10.A.0.B → 10.A.B
  return `${parts[0]}.${parts[1]}.${parts[3]}`
}

/** Erzeugt die wgyc.conf-Konfiguration für einen Pi (mit NETMAP für LAN-Zugriff). */
export function generateDevicePiConfig(opts: {
  vpnIp:        string
  localPrefix:  string
  piPrivateKey: string
  settings:     VpnSettings
}): string {
  const { vpnIp, localPrefix, piPrivateKey, settings } = opts
  const localNet   = `${localPrefix}.0/24`
  const vpnLanNet  = `${deriveVpnLanPrefix(vpnIp)}.0/24`

  // Separate PostUp-Zeilen (wie in bewährter Referenz-Config)
  const postUpLines = [
    // NETMAP: VPN-LAN-Adresse → reale LAN-Adresse (1:1, kein Interface-Filter)
    `iptables -t nat -I PREROUTING -d ${vpnLanNet} -j NETMAP --to ${localNet}`,
    // MASQUERADE nach NETMAP: Ziel ist jetzt localNet → Quelle wird Pi-LAN-IP
    // → LAN-Gerät antwortet an Pi, Pi routet zurück durch VPN
    `iptables -t nat -I POSTROUTING -d ${localNet} -j MASQUERADE`,
    // Forwarding erlauben
    `iptables -I FORWARD -i %i -j ACCEPT`,
    `iptables -I FORWARD -o %i -j ACCEPT`,
  ]

  const postDownLines = [
    `iptables -t nat -D PREROUTING -d ${vpnLanNet} -j NETMAP --to ${localNet}`,
    `iptables -t nat -D POSTROUTING -d ${localNet} -j MASQUERADE`,
    `iptables -D FORWARD -i %i -j ACCEPT`,
    `iptables -D FORWARD -o %i -j ACCEPT`,
  ]

  return `# Ycontrol VPN — Pi-Konfiguration
# Gerät VPN-IP: ${vpnIp}  |  Reales LAN: ${localNet}  |  VPN-LAN: ${vpnLanNet}
# Generiert: ${new Date().toISOString()}

[Interface]
Address    = ${vpnIp}/32
MTU        = 1420
PrivateKey = ${piPrivateKey}
${postUpLines.map(l => `PostUp   = ${l}`).join('\n')}
${postDownLines.map(l => `PostDown = ${l}`).join('\n')}

[Peer]
# Ycontrol Cloud-Server
PublicKey           = ${settings.serverPublicKey}
Endpoint            = ${settings.serverEndpoint}
AllowedIPs          = 10.0.0.0/8
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
  const vpnLanNet = `${deriveVpnLanPrefix(vpnIp)}.0/24`
  return `
# Gerät: ${deviceName}
[Peer]
PublicKey  = ${piPublicKey}
AllowedIPs = ${vpnIp}/32, ${vpnLanNet}
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
 * Schreibt die vollständige wgyc.conf in den gemeinsamen Volume-Pfad
 * und sendet SIGHUP an den WireGuard-Container.
 * Fehler werden nur geloggt (kein Crash) – im Dev-Modus ohne Docker läuft das leer.
 */
export async function syncWireGuardConfig(opts: ServerConfigOpts, configPath: string, containerName: string): Promise<void> {
  const { privateKey, settings, devices, peers } = opts

  if (!privateKey) {
    console.warn('[VPN] VPN_SERVER_PRIVATE_KEY nicht gesetzt – wgyc.conf wird nicht geschrieben')
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

  const config = `# Ycontrol VPN — Server-Konfiguration (wgyc.conf)
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
    console.log(`[VPN] wgyc.conf geschrieben: ${configPath}`)
    await reloadWireGuard(containerName)
  } catch (err) {
    console.error('[VPN] Fehler beim Schreiben der wgyc.conf:', err)
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
