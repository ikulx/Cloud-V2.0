/**
 * VPN Service — WireGuard-Konfiguration für das Ycontrol-VPN
 *
 * IP-Schema:
 *   Zone A (Management):  10.0.x.y   → Techniker-PCs (peerIndex)
 *   Zone A (Server):      10.1.0.1   → Cloud-Server wg0-Interface
 *   Zone B (Anlagen):     10.11.x.0/24 … 10.255.x.0/24 → Anlagen (subnetIndex)
 *
 * Subnet-Berechnung (Zone B):
 *   subnetIndex 1   → 10.11.1.0/24
 *   subnetIndex 255 → 10.11.255.0/24
 *   subnetIndex 256 → 10.12.0.0/24
 *   subnetIndex 500 → 10.12.244.0/24
 *   max. 62 720 Anlagen
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import http from 'http'

// ─── IP-Berechnungen ──────────────────────────────────────────────────────────

/** CIDR-Block für eine Anlage (Zone B). */
export function anlageCidr(subnetIndex: number): string {
  // 10.11.0.0 als Basis; jedes /24 belegt 256 Adressen
  const base = (10 << 24) | (11 << 16)               // 0x0A0B0000
  const ip   = base + subnetIndex * 256               // Offset um N * 256
  const b = (ip >> 16) & 0xff
  const c = (ip >>  8) & 0xff
  return `10.${b}.${c}.0/24`
}

/** Gateway-IP des VPN-Servers für diese Anlage (.1). */
export function anlageGatewayIp(subnetIndex: number): string {
  return anlageCidr(subnetIndex).replace('.0/24', '.1')
}

/** WireGuard-IP des Pi für diese Anlage (.2). */
export function anlagePiIp(subnetIndex: number): string {
  return anlageCidr(subnetIndex).replace('.0/24', '.2')
}

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
 * Erzeugt die WireGuard-Konfigurationsdatei für einen Pi.
 * Die Datei enthält den privaten Schlüssel des Pi und wird nur einmalig
 * über das Cloud-Frontend heruntergeladen.
 *
 * Auf dem Pi werden via PostUp/PreDown iptables-NETMAP-Regeln gesetzt,
 * die das virtuelle Subnetz (10.11.x.0/24) auf das reale LAN (192.168.10.0/24)
 * übersetzen.
 */
export function generatePiConfig(opts: {
  subnetIndex:    number
  localPrefix:    string   // z.B. "192.168.10"
  piPrivateKey:   string
  settings:       VpnSettings
}): string {
  const { subnetIndex, localPrefix, piPrivateKey, settings } = opts
  const cidr    = anlageCidr(subnetIndex)           // 10.11.X.0/24
  const piIp    = anlagePiIp(subnetIndex)           // 10.11.X.2
  const virtNet = cidr                              // Alias zur Lesbarkeit
  const realNet = `${localPrefix}.0/24`

  const postUp = [
    // Eingehend: Virtuell → Real
    `iptables -t nat -A PREROUTING  -d ${virtNet} -j NETMAP --to ${realNet}`,
    // Ausgehend: Real → Virtuell
    `iptables -t nat -A POSTROUTING -s ${realNet} -j NETMAP --to ${virtNet}`,
    // IP-Forwarding aktivieren
    `sysctl -w net.ipv4.ip_forward=1`,
  ].join('; ')

  const preDown = [
    `iptables -t nat -D PREROUTING  -d ${virtNet} -j NETMAP --to ${realNet}`,
    `iptables -t nat -D POSTROUTING -s ${realNet} -j NETMAP --to ${virtNet}`,
  ].join('; ')

  return `# Ycontrol VPN — Pi-Konfiguration
# Virtuelle Anlage: ${cidr}  |  Reales LAN: ${realNet}
# Generiert: ${new Date().toISOString()}

[Interface]
Address    = ${piIp}/32
PrivateKey = ${piPrivateKey}
PostUp     = ${postUp}
PreDown    = ${preDown}

[Peer]
# Ycontrol Cloud-Server
PublicKey           = ${settings.serverPublicKey}
Endpoint            = ${settings.serverEndpoint}
# Alle Zone-A- und Zone-B-Pakete über den Server leiten
AllowedIPs          = 10.0.0.0/13
PersistentKeepalive = 25
`
}

/**
 * Erzeugt die WireGuard-Konfigurationsdatei für einen Techniker-PC.
 * Der private Schlüssel wird NICHT eingetragen (der Techniker setzt
 * seinen eigenen Schlüssel ein).
 */
export function generatePeerConfig(opts: {
  peerIndex:   number
  settings:    VpnSettings
  allowedCidrs?: string[]   // leer = alle Anlagen (0.0.0.0/0 oder 10.0.0.0/13)
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
 * Erzeugt den [Peer]-Block, der auf dem Cloud-Server für eine Anlage
 * in die wg0.conf eingetragen werden muss.
 */
export function buildServerPiPeerBlock(opts: {
  anlageId:     string
  anlageName:   string
  subnetIndex:  number
  piPublicKey:  string
}): string {
  const { anlageId, anlageName, subnetIndex, piPublicKey } = opts
  const cidr  = anlageCidr(subnetIndex)
  const piIp  = anlagePiIp(subnetIndex)
  return `
# Anlage: ${anlageName} (${anlageId})
[Peer]
PublicKey  = ${piPublicKey}
# Pi-Interface-IP + das gesamte virtuelle Subnetz
AllowedIPs = ${piIp}/32, ${cidr}
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

// ─── Server-Konfig-Sync ───────────────────────────────────────────────────────

export interface ServerConfigOpts {
  privateKey:  string
  settings:    VpnSettings
  anlagen: Array<{ anlageId: string; anlageName: string; subnetIndex: number; piPublicKey: string | null }>
  peers:   Array<{ peerIndex: number; name: string; publicKey: string }>
}

/**
 * Schreibt die vollständige wg0.conf in den gemeinsamen Volume-Pfad
 * und sendet SIGHUP an den WireGuard-Container.
 * Fehler werden nur geloggt (kein Crash) – im Dev-Modus ohne Docker läuft das leer.
 */
export async function syncWireGuardConfig(opts: ServerConfigOpts, configPath: string, containerName: string): Promise<void> {
  const { privateKey, settings, anlagen, peers } = opts

  if (!privateKey) {
    console.warn('[VPN] VPN_SERVER_PRIVATE_KEY nicht gesetzt – wg0.conf wird nicht geschrieben')
    return
  }

  const anlagenBlocks = anlagen
    .filter((a) => a.piPublicKey)
    .map((a) => buildServerPiPeerBlock({
      anlageId:    a.anlageId,
      anlageName:  a.anlageName,
      subnetIndex: a.subnetIndex,
      piPublicKey: a.piPublicKey!,
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

# ─── Anlagen ─────────────────────────────────────────────────────────────────
${anlagenBlocks}
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
