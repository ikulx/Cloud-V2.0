/**
 * VPN-Router
 *
 * Endpoints:
 *   GET    /api/vpn/settings                    – Server-Einstellungen lesen
 *   PUT    /api/vpn/settings                    – Server-Einstellungen speichern
 *   GET    /api/vpn/anlagen                     – Alle VPN-Anlagen
 *   POST   /api/vpn/anlagen/:anlageId/enable    – VPN für Anlage aktivieren
 *   DELETE /api/vpn/anlagen/:anlageId           – VPN für Anlage deaktivieren
 *   GET    /api/vpn/anlagen/:anlageId/pi-config – Pi-WireGuard-Config downloaden
 *   GET    /api/vpn/server-config               – Server-Peer-Blöcke (alle Anlagen + Peers)
 *   GET    /api/vpn/peers                       – Alle Techniker-Peers
 *   POST   /api/vpn/peers                       – Peer hinzufügen
 *   DELETE /api/vpn/peers/:id                   – Peer entfernen
 *   GET    /api/vpn/peers/:id/config            – Peer-WireGuard-Config downloaden
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import {
  anlageCidr,
  anlagePiIp,
  peerIp,
  generateWgKeypair,
  generatePiConfig,
  generatePeerConfig,
  buildServerPiPeerBlock,
  buildServerPeerBlock,
  syncWireGuardConfig,
  type VpnSettings,
} from '../services/vpn.service'
import { env } from '../config/env'
import { publishCommand } from '../services/mqtt.service'
import { hashDeviceSecret } from '../lib/token'

const router = Router()

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

async function getVpnSettings(): Promise<VpnSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['vpn_server_public_key', 'vpn_server_endpoint', 'vpn_server_port'] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    serverPublicKey: map['vpn_server_public_key'] ?? '',
    serverEndpoint:  map['vpn_server_endpoint']   ?? '',
    serverPort:      parseInt(map['vpn_server_port'] ?? '51820', 10),
  }
}

async function setVpnSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

async function nextSubnetIndex(): Promise<number> {
  const last = await prisma.vpnAnlage.findFirst({ orderBy: { subnetIndex: 'desc' } })
  return (last?.subnetIndex ?? 0) + 1
}

async function nextPeerIndex(): Promise<number> {
  const last = await prisma.vpnPeer.findFirst({ orderBy: { peerIndex: 'desc' } })
  return (last?.peerIndex ?? 0) + 1
}

/** Liest alle aktuellen VPN-Daten und schreibt wg0.conf + löst Reload aus. */
async function syncAll(): Promise<void> {
  const [settings, vpnAnlagen, vpnPeers] = await Promise.all([
    getVpnSettings(),
    prisma.vpnAnlage.findMany({ orderBy: { subnetIndex: 'asc' } }),
    prisma.vpnPeer.findMany({ orderBy: { peerIndex: 'asc' } }),
  ])

  const anlagenNamen = new Map<string, string>()
  if (vpnAnlagen.length > 0) {
    const anlagen = await prisma.anlage.findMany({
      where: { id: { in: vpnAnlagen.map((a) => a.anlageId) } },
      select: { id: true, name: true },
    })
    for (const a of anlagen) anlagenNamen.set(a.id, a.name)
  }

  await syncWireGuardConfig(
    {
      privateKey: env.vpn.serverPrivateKey,
      settings,
      anlagen: vpnAnlagen.map((a) => ({
        anlageId:    a.anlageId,
        anlageName:  anlagenNamen.get(a.anlageId) ?? a.anlageId,
        subnetIndex: a.subnetIndex,
        piPublicKey: a.piPublicKey,
      })),
      peers: vpnPeers.map((p) => ({ peerIndex: p.peerIndex, name: p.name, publicKey: p.publicKey })),
    },
    env.vpn.wgConfigPath,
    env.vpn.wgContainer,
  )
}

// ─── Einstellungen ────────────────────────────────────────────────────────────

// GET /api/vpn/settings
router.get('/settings', authenticate, requirePermission('vpn:manage'), async (_req, res) => {
  const s = await getVpnSettings()
  res.json(s)
})

// PUT /api/vpn/settings
const settingsSchema = z.object({
  serverPublicKey: z.string().min(1),
  serverEndpoint:  z.string().min(1),
  serverPort:      z.number().int().min(1).max(65535).optional(),
})

router.put('/settings', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  const { serverPublicKey, serverEndpoint, serverPort } = parsed.data
  await Promise.all([
    setVpnSetting('vpn_server_public_key', serverPublicKey),
    setVpnSetting('vpn_server_endpoint',   serverEndpoint),
    setVpnSetting('vpn_server_port',       String(serverPort ?? 51820)),
  ])
  syncAll().catch((e) => console.error('[VPN] syncAll nach settings update:', e))
  res.json({ ok: true })
})

// ─── Anlagen ──────────────────────────────────────────────────────────────────

// GET /api/vpn/anlagen
router.get('/anlagen', authenticate, requirePermission('vpn:manage'), async (_req, res) => {
  const entries = await prisma.vpnAnlage.findMany({ orderBy: { subnetIndex: 'asc' } })

  // Anlage-Details parallel laden
  const anlagenMap = new Map<string, { name: string; location: string | null }>()
  if (entries.length > 0) {
    const anlagen = await prisma.anlage.findMany({
      where: { id: { in: entries.map((e) => e.anlageId) } },
      select: { id: true, name: true, location: true },
    })
    for (const a of anlagen) anlagenMap.set(a.id, { name: a.name, location: a.location })
  }

  const result = entries.map((e) => {
    const a = anlagenMap.get(e.anlageId)
    return {
      id:          e.id,
      anlageId:    e.anlageId,
      anlageName:  a?.name ?? '—',
      anlageOrt:   a?.location ?? null,
      subnetIndex: e.subnetIndex,
      subnetCidr:  anlageCidr(e.subnetIndex),
      piIp:        anlagePiIp(e.subnetIndex),
      localPrefix: e.localPrefix,
      piPublicKey: e.piPublicKey,
      createdAt:   e.createdAt,
    }
  })

  res.json(result)
})

// POST /api/vpn/anlagen/:anlageId/enable
const enableSchema = z.object({
  localPrefix: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/).optional(),
})

router.post('/anlagen/:anlageId/enable', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const anlageId = req.params.anlageId as string
  const parsed = enableSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  // Prüfen ob Anlage existiert
  const anlage = await prisma.anlage.findUnique({ where: { id: anlageId }, select: { id: true, name: true } })
  if (!anlage) { res.status(404).json({ message: 'Anlage nicht gefunden' }); return }

  // Prüfen ob bereits aktiv
  const existing = await prisma.vpnAnlage.findUnique({ where: { anlageId } })
  if (existing) { res.status(409).json({ message: 'VPN für diese Anlage bereits aktiviert' }); return }

  const subnetIndex   = await nextSubnetIndex()
  const localPrefix   = parsed.data.localPrefix ?? '192.168.10'
  const { privateKey: piPrivateKey, publicKey: piPublicKey } = generateWgKeypair()

  const vpnAnlage = await prisma.vpnAnlage.create({
    data: { anlageId, subnetIndex, localPrefix, piPublicKey, piPrivateKey },
  })

  res.status(201).json({
    id:          vpnAnlage.id,
    anlageId,
    anlageName:  anlage.name,
    subnetIndex,
    subnetCidr:  anlageCidr(subnetIndex),
    piIp:        anlagePiIp(subnetIndex),
    localPrefix,
    piPublicKey,
  })
  syncAll().catch((e) => console.error('[VPN] syncAll nach enable:', e))
})

// DELETE /api/vpn/anlagen/:anlageId
router.delete('/anlagen/:anlageId', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const _anlageId = req.params.anlageId as string
  const existing = await prisma.vpnAnlage.findUnique({ where: { anlageId: _anlageId } })
  if (!existing) { res.status(404).json({ message: 'Kein VPN für diese Anlage' }); return }

  await prisma.vpnAnlage.delete({ where: { anlageId: _anlageId } })
  syncAll().catch((e) => console.error('[VPN] syncAll nach delete anlage:', e))
  res.json({ ok: true })
})

// GET /api/vpn/anlagen/:anlageId/pi-config  →  .conf-Datei-Download
router.get('/anlagen/:anlageId/pi-config', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const anlageId = req.params.anlageId as string
  const [vpnAnlage, anlageRecord] = await Promise.all([
    prisma.vpnAnlage.findUnique({ where: { anlageId } }),
    prisma.anlage.findUnique({ where: { id: anlageId }, select: { name: true } }),
  ])
  if (!vpnAnlage) { res.status(404).json({ message: 'Kein VPN für diese Anlage' }); return }
  if (!vpnAnlage.piPrivateKey) { res.status(409).json({ message: 'Kein privater Schlüssel gespeichert' }); return }

  const settings = await getVpnSettings()
  if (!settings.serverPublicKey || !settings.serverEndpoint) {
    res.status(409).json({ message: 'VPN-Server-Einstellungen nicht konfiguriert' }); return
  }

  const config = generatePiConfig({
    subnetIndex:  vpnAnlage.subnetIndex,
    localPrefix:  vpnAnlage.localPrefix,
    piPrivateKey: vpnAnlage.piPrivateKey,
    settings,
  })

  const safeName = (anlageRecord?.name ?? anlageId).replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const filename = `ycontrol-vpn-${safeName}.conf`
  res.setHeader('Content-Type',        'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(config)
})

// ─── Server-Config ────────────────────────────────────────────────────────────

// GET /api/vpn/server-config  →  vollständige Peer-Sektion für wg0.conf
router.get('/server-config', authenticate, requirePermission('vpn:manage'), async (_req, res) => {
  const settings = await getVpnSettings()

  const [vpnAnlagen, vpnPeers] = await Promise.all([
    prisma.vpnAnlage.findMany({ orderBy: { subnetIndex: 'asc' } }),
    prisma.vpnPeer.findMany({ orderBy: { peerIndex: 'asc' } }),
  ])

  // Anlage-Namen laden
  const anlagenNamen = new Map<string, string>()
  if (vpnAnlagen.length > 0) {
    const anlagen = await prisma.anlage.findMany({
      where: { id: { in: vpnAnlagen.map((a) => a.anlageId) } },
      select: { id: true, name: true },
    })
    for (const a of anlagen) anlagenNamen.set(a.id, a.name)
  }

  const header = `# ═══════════════════════════════════════════════════════
# Ycontrol VPN — Server-Konfiguration (wg0.conf)
# Generiert: ${new Date().toISOString()}
# ═══════════════════════════════════════════════════════

[Interface]
Address    = 10.1.0.1/8
ListenPort = ${settings.serverPort}
PrivateKey = <SERVER_PRIVATEN_SCHLUESSEL_HIER_EINTRAGEN>

# Routing aktivieren (einmalig):
#   sysctl -w net.ipv4.ip_forward=1
# Firewalling (Zone A → Zone B):
#   iptables -A FORWARD -s 10.0.0.0/16 -d 10.11.0.0/8 -j ACCEPT
#   iptables -A FORWARD -j DROP

`

  const anlagenBlocks = vpnAnlagen
    .filter((a) => a.piPublicKey)
    .map((a) => buildServerPiPeerBlock({
      anlageId:    a.anlageId,
      anlageName:  anlagenNamen.get(a.anlageId) ?? a.anlageId,
      subnetIndex: a.subnetIndex,
      piPublicKey: a.piPublicKey!,
    }))
    .join('')

  const peerBlocks = vpnPeers
    .map((p) => buildServerPeerBlock({
      peerIndex: p.peerIndex,
      peerName:  p.name,
      publicKey: p.publicKey,
    }))
    .join('')

  const config = header
    + (anlagenBlocks ? `# ─── Anlagen (${vpnAnlagen.length}) ───────────────────────────────────────────\n` + anlagenBlocks : '')
    + (peerBlocks    ? `\n# ─── Techniker-Peers (${vpnPeers.length}) ──────────────────────────────────────\n` + peerBlocks : '')

  res.setHeader('Content-Type',        'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="wg0.conf"')
  res.send(config)
})

// ─── Techniker-Peers ──────────────────────────────────────────────────────────

// GET /api/vpn/peers
router.get('/peers', authenticate, requirePermission('vpn:manage'), async (_req, res) => {
  const peers = await prisma.vpnPeer.findMany({
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: { peerIndex: 'asc' },
  })

  const result = peers.map((p) => ({
    id:        p.id,
    name:      p.name,
    publicKey: p.publicKey,
    peerIndex: p.peerIndex,
    ip:        peerIp(p.peerIndex),
    userId:    p.userId,
    user:      p.user,
    createdAt: p.createdAt,
  }))

  res.json(result)
})

// POST /api/vpn/peers
const peerSchema = z.object({
  name:      z.string().min(1).max(100),
  publicKey: z.string().min(44).max(44),  // Base64 von 32 Bytes = 44 Zeichen
  userId:    z.string().uuid().optional(),
})

router.post('/peers', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const parsed = peerSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { name, publicKey, userId } = parsed.data

  // Doppelten Schlüssel verhindern
  const dup = await prisma.vpnPeer.findUnique({ where: { publicKey } })
  if (dup) { res.status(409).json({ message: 'Dieser öffentliche Schlüssel ist bereits registriert' }); return }

  const peerIndex = await nextPeerIndex()

  const peer = await prisma.vpnPeer.create({
    data: { name, publicKey, peerIndex, userId: userId ?? null },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
  })

  res.status(201).json({
    id:        peer.id,
    name:      peer.name,
    publicKey: peer.publicKey,
    peerIndex: peer.peerIndex,
    ip:        peerIp(peer.peerIndex),
    userId:    peer.userId,
    user:      peer.user,
    createdAt: peer.createdAt,
  })
  syncAll().catch((e) => console.error('[VPN] syncAll nach add peer:', e))
})

// DELETE /api/vpn/peers/:id
router.delete('/peers/:id', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const peerId = req.params.id as string
  const peer = await prisma.vpnPeer.findUnique({ where: { id: peerId } })
  if (!peer) { res.status(404).json({ message: 'Peer nicht gefunden' }); return }

  await prisma.vpnPeer.delete({ where: { id: peerId } })
  syncAll().catch((e) => console.error('[VPN] syncAll nach delete peer:', e))
  res.json({ ok: true })
})

// GET /api/vpn/peers/:id/config  →  .conf-Datei-Download
router.get('/peers/:id/config', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const peer = await prisma.vpnPeer.findUnique({ where: { id: req.params.id as string } })
  if (!peer) { res.status(404).json({ message: 'Peer nicht gefunden' }); return }

  const settings = await getVpnSettings()
  if (!settings.serverPublicKey || !settings.serverEndpoint) {
    res.status(409).json({ message: 'VPN-Server-Einstellungen nicht konfiguriert' }); return
  }

  const config = generatePeerConfig({ peerIndex: peer.peerIndex, settings })
  const filename = `ycontrol-vpn-${peer.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.conf`
  res.setHeader('Content-Type',        'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(config)
})

// ─── Geräte-seitige VPN-Endpunkte ────────────────────────────────────────────

// GET /api/vpn/devices/:deviceId/info
// Gibt alle VPN-konfigurierten Anlagen zurück, denen dieses Gerät zugeordnet ist.
router.get('/devices/:deviceId/info', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string

  const anlageLinks = await prisma.anlageDevice.findMany({
    where: { deviceId },
    select: { anlageId: true, anlage: { select: { name: true } } },
  })
  if (anlageLinks.length === 0) { res.json([]); return }

  const anlageIds = anlageLinks.map((l) => l.anlageId)
  const vpnAnlagen = await prisma.vpnAnlage.findMany({
    where: { anlageId: { in: anlageIds } },
  })

  const nameMap = new Map(anlageLinks.map((l) => [l.anlageId, l.anlage.name]))
  const result = vpnAnlagen.map((v) => ({
    anlageId:    v.anlageId,
    anlageName:  nameMap.get(v.anlageId) ?? '—',
    subnetCidr:  anlageCidr(v.subnetIndex),
    piIp:        anlagePiIp(v.subnetIndex),
    localPrefix: v.localPrefix,
    hasKey:      !!v.piPublicKey,
  }))

  res.json(result)
})

// POST /api/vpn/devices/:deviceId/deploy
// Sendet den vpn_install MQTT-Befehl an genau dieses eine Gerät.
router.post('/devices/:deviceId/deploy', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string
  const { anlageId } = req.body as { anlageId?: string }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { serialNumber: true, isApproved: true },
  })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (!device.isApproved) { res.status(409).json({ message: 'Gerät noch nicht freigegeben' }); return }

  // anlageId aus Body oder erste VPN-konfigurierte Anlage des Geräts
  let targetAnlageId = anlageId
  if (!targetAnlageId) {
    const link = await prisma.anlageDevice.findFirst({
      where: {
        deviceId,
        anlageId: { in: (await prisma.vpnAnlage.findMany({ select: { anlageId: true } })).map((v) => v.anlageId) },
      },
    })
    targetAnlageId = link?.anlageId
  }
  if (!targetAnlageId) { res.status(404).json({ message: 'Keine VPN-konfigurierte Anlage für dieses Gerät' }); return }

  const settings = await getVpnSettings()
  if (!settings.serverPublicKey || !settings.serverEndpoint) {
    res.status(409).json({ message: 'VPN-Server-Einstellungen unvollständig' }); return
  }

  publishCommand(device.serialNumber, { action: 'vpn_install', anlageId: targetAnlageId })
  res.json({ ok: true, serial: device.serialNumber, anlageId: targetAnlageId })
})

// ─── Pi-seitiger Konfig-Download (Device-Auth) ───────────────────────────────

// GET /api/vpn/device-config?anlageId=...
// Wird vom Pi-Agent aufgerufen. Auth via x-device-serial + x-device-secret Header.
router.get('/device-config', async (req, res) => {
  const serial = req.headers['x-device-serial'] as string | undefined
  const secret = req.headers['x-device-secret'] as string | undefined

  if (!serial || !secret) { res.status(401).json({ message: 'Authentifizierung erforderlich' }); return }

  const device = await prisma.device.findUnique({
    where: { serialNumber: serial },
    select: { id: true, isApproved: true, deviceSecret: true },
  })
  if (!device?.isApproved || !device.deviceSecret) { res.status(403).json({ message: 'Nicht autorisiert' }); return }
  if (hashDeviceSecret(secret) !== device.deviceSecret) { res.status(403).json({ message: 'Nicht autorisiert' }); return }

  const anlageId = req.query.anlageId as string | undefined
  if (!anlageId) { res.status(400).json({ message: 'anlageId erforderlich' }); return }

  const [vpnAnlage, anlageRecord] = await Promise.all([
    prisma.vpnAnlage.findUnique({ where: { anlageId } }),
    prisma.anlage.findUnique({ where: { id: anlageId }, select: { name: true } }),
  ])
  if (!vpnAnlage) { res.status(404).json({ message: 'Kein VPN für diese Anlage' }); return }
  if (!vpnAnlage.piPrivateKey) { res.status(409).json({ message: 'Kein privater Schlüssel vorhanden' }); return }

  const settings = await getVpnSettings()
  if (!settings.serverPublicKey || !settings.serverEndpoint) {
    res.status(409).json({ message: 'VPN-Server nicht konfiguriert' }); return
  }

  const config = generatePiConfig({
    subnetIndex:  vpnAnlage.subnetIndex,
    localPrefix:  vpnAnlage.localPrefix,
    piPrivateKey: vpnAnlage.piPrivateKey,
    settings,
  })

  const safeName = (anlageRecord?.name ?? anlageId).replace(/[^a-z0-9]/gi, '-').toLowerCase()
  res.setHeader('Content-Type',        'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="ycontrol-vpn-${safeName}.conf"`)
  res.send(config)
})

// ─── VPN auf Pi deployen (sendet MQTT-Kommando) ──────────────────────────────

// POST /api/vpn/anlagen/:anlageId/deploy
router.post('/anlagen/:anlageId/deploy', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const anlageId = req.params.anlageId as string

  const vpnAnlage = await prisma.vpnAnlage.findUnique({ where: { anlageId } })
  if (!vpnAnlage) { res.status(404).json({ message: 'Kein VPN für diese Anlage konfiguriert' }); return }

  const settings = await getVpnSettings()
  if (!settings.serverPublicKey || !settings.serverEndpoint) {
    res.status(409).json({ message: 'VPN-Server-Einstellungen unvollständig' }); return
  }

  // Freigegebene Geräte der Anlage ermitteln
  const anlageDevices = await prisma.anlageDevice.findMany({
    where: { anlageId },
    include: { device: { select: { serialNumber: true, isApproved: true } } },
  })

  const approved = anlageDevices.filter((ad) => ad.device.isApproved)
  if (approved.length === 0) {
    res.status(404).json({ message: 'Keine freigegebenen Geräte für diese Anlage gefunden' }); return
  }

  for (const ad of approved) {
    publishCommand(ad.device.serialNumber, { action: 'vpn_install', anlageId })
  }

  res.json({ ok: true, targeted: approved.length, serials: approved.map((ad) => ad.device.serialNumber) })
})

export default router
