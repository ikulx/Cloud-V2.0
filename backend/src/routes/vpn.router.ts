/**
 * VPN-Router
 *
 * Endpoints:
 *   GET    /api/vpn/settings                       – Server-Einstellungen lesen
 *   PUT    /api/vpn/settings                       – Server-Einstellungen speichern
 *   GET    /api/vpn/devices                        – Alle VpnDevice-Einträge
 *   GET    /api/vpn/devices/:deviceId              – VpnDevice für ein Gerät (oder null)
 *   POST   /api/vpn/devices/:deviceId/enable       – VPN für Gerät aktivieren
 *   PUT    /api/vpn/devices/:deviceId              – VPN-IP / localPrefix aktualisieren
 *   DELETE /api/vpn/devices/:deviceId              – VPN für Gerät deaktivieren
 *   GET    /api/vpn/devices/:deviceId/pi-config    – Pi-WireGuard-Config downloaden
 *   POST   /api/vpn/devices/:deviceId/deploy       – MQTT vpn_install an Gerät senden
 *   GET    /api/vpn/device-config                  – Pi-Auth: eigene wg-Config abrufen
 *   GET    /api/vpn/server-config                  – Vollständige wg0.conf downloaden
 *   GET    /api/vpn/peers                          – Alle Techniker-Peers
 *   POST   /api/vpn/peers                          – Peer hinzufügen
 *   DELETE /api/vpn/peers/:id                      – Peer entfernen
 *   GET    /api/vpn/peers/:id/config               – Peer-WireGuard-Config downloaden
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import http from 'http'
import https from 'https'
import zlib from 'zlib'
import { verifyAccessToken } from '../lib/token'
import { getUserAccessContext } from '../services/user-context.service'
import {
  peerIp,
  generateWgKeypair,
  generateDevicePiConfig,
  generatePeerConfig,
  buildDevicePeerBlock,
  buildServerPeerBlock,
  syncWireGuardConfig,
  deriveVpnLanPrefix,
  type VpnSettings,
} from '../services/vpn.service'
import { env } from '../config/env'
import { publishCommand } from '../services/mqtt.service'
import { verifyDeviceSecret } from '../lib/token'
import { logActivity } from '../services/activity-log.service'
import { issueVisuTicket, consumeVisuTicket } from '../services/visu-ticket.service'
import { storeLanBasicAuth, getLanBasicAuth, removeLanBasicAuth } from '../services/lan-basic-auth-session.service'
import crypto from 'crypto'

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

async function nextPeerIndex(): Promise<number> {
  const last = await prisma.vpnPeer.findFirst({ orderBy: { peerIndex: 'desc' } })
  return (last?.peerIndex ?? 0) + 1
}

/** Liest alle aktuellen VPN-Daten und schreibt wg0.conf + löst Reload aus. */
async function syncAll(): Promise<void> {
  const [settings, vpnDevices, vpnPeers] = await Promise.all([
    getVpnSettings(),
    prisma.vpnDevice.findMany({ include: { device: { select: { name: true } } } }),
    prisma.vpnPeer.findMany({ orderBy: { peerIndex: 'asc' } }),
  ])

  await syncWireGuardConfig(
    {
      privateKey: env.vpn.serverPrivateKey,
      settings,
      devices: vpnDevices.map((d) => ({
        deviceName:  d.device.name,
        vpnIp:       d.vpnIp,
        localPrefix: d.localPrefix,
        piPublicKey: d.piPublicKey,
      })),
      peers: vpnPeers.map((p) => ({ peerIndex: p.peerIndex, name: p.name, publicKey: p.publicKey })),
    },
    env.vpn.wgConfigPath,
    env.vpn.wgContainer,
  )
}

// ─── Initiale Synchronisation beim Backend-Start ─────────────────────────────
// Stellt sicher, dass wg0.conf nach einem Redeploy sofort aktuell ist.
setTimeout(() => {
  syncAll()
    .then(() => console.log('[VPN] Initiale wg0.conf-Synchronisation abgeschlossen'))
    .catch((e) => console.warn('[VPN] Initiale Synchronisation fehlgeschlagen:', e.message))
}, 5000) // 5s Verzögerung: DB + Prisma müssen bereit sein

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

// ─── Geräte-VPN ──────────────────────────────────────────────────────────────

// GET /api/vpn/devices
router.get('/devices', authenticate, requirePermission('vpn:manage'), async (_req, res) => {
  const entries = await prisma.vpnDevice.findMany({
    include: { device: { select: { id: true, name: true, serialNumber: true, isApproved: true } } },
    orderBy: { createdAt: 'asc' },
  })
  res.json(entries.map((e) => ({
    id:           e.id,
    deviceId:     e.deviceId,
    deviceName:   e.device.name,
    serialNumber: e.device.serialNumber,
    isApproved:   e.device.isApproved,
    vpnIp:        e.vpnIp,
    localPrefix:  e.localPrefix,
    piPublicKey:  e.piPublicKey,
    createdAt:    e.createdAt,
  })))
})

// GET /api/vpn/devices/:deviceId
router.get('/devices/:deviceId', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string
  const vpnDevice = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!vpnDevice) { res.json(null); return }
  res.json({
    id:          vpnDevice.id,
    vpnIp:       vpnDevice.vpnIp,
    localPrefix: vpnDevice.localPrefix,
    visuPort:    vpnDevice.visuPort,
    visuIp:      vpnDevice.visuIp,
    wanIp:       vpnDevice.wanIp,
    piPublicKey: vpnDevice.piPublicKey,
    createdAt:   vpnDevice.createdAt,
  })
})

// VPN-IP-Schema: 10.A.0.B  (A: 11–255, B: 1–254)
// VPN-LAN wird abgeleitet: 10.A.B.0/24
const VPN_IP_RE = /^10\.(1[1-9]|[2-9]\d|[1-2]\d{2}|255)\.0\.(25[0-4]|2[0-4]\d|1\d{2}|[1-9]\d|[1-9])$/
const LOCAL_PREFIX_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

// POST /api/vpn/devices/:deviceId/enable
const enableDeviceSchema = z.object({
  vpnIp:       z.string().regex(VPN_IP_RE, 'VPN-IP muss Format 10.A.0.B haben (A: 11–255, B: 1–254)'),
  localPrefix: z.string().regex(LOCAL_PREFIX_RE, 'LAN-Präfix muss drei Oktette haben, z.B. 192.168.10').optional(),
  visuPort:    z.number().int().min(1).max(65535).optional(),
  visuIp:      z.string().ip({ version: 'v4' }).optional().nullable(),
  wanIp:       z.string().ip({ version: 'v4' }).optional().nullable(),
})

router.post('/devices/:deviceId/enable', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string
  const parsed = enableDeviceSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true } })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }

  const existing = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (existing) { res.status(409).json({ message: 'VPN für dieses Gerät bereits aktiviert' }); return }

  // VPN IP Eindeutigkeit prüfen
  const ipConflict = await prisma.vpnDevice.findUnique({ where: { vpnIp: parsed.data.vpnIp } })
  if (ipConflict) { res.status(409).json({ message: 'Diese VPN-IP ist bereits vergeben' }); return }

  const { privateKey: piPrivateKey, publicKey: piPublicKey } = generateWgKeypair()

  const vpnDevice = await prisma.vpnDevice.create({
    data: {
      deviceId,
      vpnIp: parsed.data.vpnIp,
      localPrefix: parsed.data.localPrefix ?? '192.168.10',
      visuPort:    parsed.data.visuPort    ?? 80,
      visuIp:      parsed.data.visuIp      ?? null,
      wanIp:       parsed.data.wanIp       ?? null,
      piPublicKey,
      piPrivateKey,
    },
  })

  res.status(201).json({
    id:          vpnDevice.id,
    deviceId,
    deviceName:  device.name,
    vpnIp:       vpnDevice.vpnIp,
    localPrefix: vpnDevice.localPrefix,
    visuPort:    vpnDevice.visuPort,
    visuIp:      vpnDevice.visuIp,
    wanIp:       vpnDevice.wanIp,
    piPublicKey: vpnDevice.piPublicKey,
    createdAt:   vpnDevice.createdAt,
  })
  syncAll().catch((e) => console.error('[VPN] syncAll nach device enable:', e))
})

// PUT /api/vpn/devices/:deviceId
const updateDeviceSchema = z.object({
  vpnIp:       z.string().regex(VPN_IP_RE, 'VPN-IP muss Format 10.A.0.B haben (A: 11–255, B: 1–254)').optional(),
  localPrefix: z.string().regex(LOCAL_PREFIX_RE, 'LAN-Präfix muss drei Oktette haben, z.B. 192.168.10').optional(),
  visuPort:    z.number().int().min(1).max(65535).optional(),
  visuIp:      z.string().ip({ version: 'v4' }).optional().nullable(),
  wanIp:       z.string().ip({ version: 'v4' }).optional().nullable(),
})

router.put('/devices/:deviceId', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string
  const parsed = updateDeviceSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  const existing = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!existing) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }

  if (parsed.data.vpnIp && parsed.data.vpnIp !== existing.vpnIp) {
    const conflict = await prisma.vpnDevice.findUnique({ where: { vpnIp: parsed.data.vpnIp } })
    if (conflict) { res.status(409).json({ message: 'Diese VPN-IP ist bereits vergeben' }); return }
  }

  const updated = await prisma.vpnDevice.update({
    where: { deviceId },
    data: {
      vpnIp:       parsed.data.vpnIp       ?? existing.vpnIp,
      localPrefix: parsed.data.localPrefix ?? existing.localPrefix,
      visuPort:    parsed.data.visuPort    ?? existing.visuPort,
      visuIp:      parsed.data.visuIp !== undefined ? parsed.data.visuIp : existing.visuIp,
      wanIp:       parsed.data.wanIp  !== undefined ? parsed.data.wanIp  : existing.wanIp,
    },
  })

  res.json({ id: updated.id, deviceId, vpnIp: updated.vpnIp, localPrefix: updated.localPrefix, visuPort: updated.visuPort, visuIp: updated.visuIp, wanIp: updated.wanIp })
  syncAll().catch((e) => console.error('[VPN] syncAll nach device update:', e))
})

// DELETE /api/vpn/devices/:deviceId
router.delete('/devices/:deviceId', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string
  const existing = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!existing) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }

  // Gerät laden um die Seriennummer für MQTT zu bekommen
  const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { serialNumber: true } })

  await prisma.vpnDevice.delete({ where: { deviceId } })
  syncAll().catch((e) => console.error('[VPN] syncAll nach device delete:', e))

  // MQTT-Befehl an Pi: WireGuard stoppen + Config löschen
  if (device?.serialNumber) {
    publishCommand(device.serialNumber, { action: 'vpn_remove' })
  }

  res.json({ ok: true })
})

// GET /api/vpn/devices/:deviceId/pi-config
router.get('/devices/:deviceId/pi-config', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string
  const [vpnDevice, device] = await Promise.all([
    prisma.vpnDevice.findUnique({ where: { deviceId } }),
    prisma.device.findUnique({ where: { id: deviceId }, select: { name: true } }),
  ])
  if (!vpnDevice) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }
  if (!vpnDevice.piPrivateKey) { res.status(409).json({ message: 'Kein privater Schlüssel gespeichert' }); return }

  const settings = await getVpnSettings()
  if (!settings.serverPublicKey || !settings.serverEndpoint) {
    res.status(409).json({ message: 'VPN-Server-Einstellungen nicht konfiguriert' }); return
  }

  const config = generateDevicePiConfig({
    vpnIp:        vpnDevice.vpnIp,
    localPrefix:  vpnDevice.localPrefix,
    piPrivateKey: vpnDevice.piPrivateKey,
    settings,
  })

  const safeName = (device?.name ?? deviceId).replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const filename = `ycontrol-vpn-${safeName}.conf`
  res.setHeader('Content-Type',        'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(config)

  logActivity({
    action: 'vpn.config.download',
    entityType: 'devices',
    entityId: deviceId,
    details: { entityName: device?.name ?? null, configType: 'pi-config' },
    req,
    statusCode: 200,
  }).catch(() => {})
})

// POST /api/vpn/devices/:deviceId/deploy
router.post('/devices/:deviceId/deploy', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { serialNumber: true, isApproved: true, name: true },
  })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (!device.isApproved) { res.status(409).json({ message: 'Gerät noch nicht freigegeben' }); return }

  const vpnDevice = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!vpnDevice) { res.status(404).json({ message: 'Kein VPN für dieses Gerät konfiguriert' }); return }

  const settings = await getVpnSettings()
  if (!settings.serverPublicKey || !settings.serverEndpoint) {
    res.status(409).json({ message: 'VPN-Server-Einstellungen unvollständig' }); return
  }

  if (!vpnDevice.piPrivateKey) {
    res.status(409).json({ message: 'Kein privater Schlüssel für dieses Gerät' }); return
  }

  const config = generateDevicePiConfig({
    vpnIp:        vpnDevice.vpnIp,
    localPrefix:  vpnDevice.localPrefix,
    piPrivateKey: vpnDevice.piPrivateKey,
    settings,
  })

  publishCommand(device.serialNumber, { action: 'vpn_install', config })
  res.json({ ok: true, serial: device.serialNumber })

  logActivity({
    action: 'vpn.deploy',
    entityType: 'devices',
    entityId: deviceId,
    details: {
      entityName: device.name?.trim() || device.serialNumber,
      vpnIp: vpnDevice.vpnIp,
    },
    req,
    statusCode: 200,
  }).catch(() => {})
})

// ─── Pi-seitiger Konfig-Download (Device-Auth) ───────────────────────────────

// GET /api/vpn/device-config
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
  if (!verifyDeviceSecret(secret, device.deviceSecret)) { res.status(403).json({ message: 'Nicht autorisiert' }); return }

  const vpnDevice = await prisma.vpnDevice.findUnique({ where: { deviceId: device.id } })
  if (!vpnDevice) { res.status(404).json({ message: 'Kein VPN für dieses Gerät konfiguriert' }); return }
  if (!vpnDevice.piPrivateKey) { res.status(409).json({ message: 'Kein privater Schlüssel vorhanden' }); return }

  const settings = await getVpnSettings()
  if (!settings.serverPublicKey || !settings.serverEndpoint) {
    res.status(409).json({ message: 'VPN-Server nicht konfiguriert' }); return
  }

  const config = generateDevicePiConfig({
    vpnIp:        vpnDevice.vpnIp,
    localPrefix:  vpnDevice.localPrefix,
    piPrivateKey: vpnDevice.piPrivateKey,
    settings,
  })

  res.setHeader('Content-Type',        'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="ycontrol-vpn-${serial}.conf"`)
  res.send(config)
})

// ─── Server-Config ────────────────────────────────────────────────────────────

// GET /api/vpn/server-config
router.get('/server-config', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const settings = await getVpnSettings()

  const [vpnDevices, vpnPeers] = await Promise.all([
    prisma.vpnDevice.findMany({ include: { device: { select: { name: true } } } }),
    prisma.vpnPeer.findMany({ orderBy: { peerIndex: 'asc' } }),
  ])

  const header = `# ═══════════════════════════════════════════════════════
# Ycontrol VPN — Server-Konfiguration (wg0.conf)
# Generiert: ${new Date().toISOString()}
# ═══════════════════════════════════════════════════════

[Interface]
Address    = 10.1.0.1/8
ListenPort = ${settings.serverPort}
PrivateKey = <SERVER_PRIVATEN_SCHLUESSEL_HIER_EINTRAGEN>

`

  const deviceBlocks = vpnDevices
    .filter((d) => d.piPublicKey)
    .map((d) => buildDevicePeerBlock({
      deviceName:  d.device.name,
      vpnIp:       d.vpnIp,
      localPrefix: d.localPrefix,
      piPublicKey: d.piPublicKey!,
    }))
    .join('')

  const peerBlocks = vpnPeers
    .map((p) => buildServerPeerBlock({ peerIndex: p.peerIndex, peerName: p.name, publicKey: p.publicKey }))
    .join('')

  const config = header
    + (deviceBlocks ? `# ─── Geräte (${vpnDevices.length}) ──────────────────────────────────────────────\n` + deviceBlocks : '')
    + (peerBlocks   ? `\n# ─── Techniker-Peers (${vpnPeers.length}) ──────────────────────────────────────\n` + peerBlocks : '')

  res.setHeader('Content-Type',        'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="wg0.conf"')
  res.send(config)

  logActivity({
    action: 'vpn.config.download',
    entityType: 'vpn',
    details: { configType: 'server-config' },
    req,
    statusCode: 200,
  }).catch(() => {})
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

// POST /api/vpn/peers  – Schlüsselpaar wird automatisch serverseitig generiert
const peerSchema = z.object({
  name:   z.string().min(1).max(100),
  userId: z.string().uuid().optional(),
})

router.post('/peers', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const parsed = peerSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { name, userId } = parsed.data
  const { privateKey, publicKey } = generateWgKeypair()
  const peerIndex = await nextPeerIndex()

  const peer = await prisma.vpnPeer.create({
    data: { name, publicKey, privateKey, peerIndex, userId: userId ?? null },
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

  const config = generatePeerConfig({ peerIndex: peer.peerIndex, privateKey: peer.privateKey ?? undefined, settings })
  const filename = `ycontrol-vpn-${peer.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.conf`
  res.setHeader('Content-Type',        'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(config)

  logActivity({
    action: 'vpn.config.download',
    entityType: 'vpn.peers',
    entityId: peer.id,
    details: { entityName: peer.name, configType: 'peer-config' },
    req,
    statusCode: 200,
  }).catch(() => {})
})

// ─── VPN-Erreichbarkeitstest ──────────────────────────────────────────────────
// GET /api/vpn/devices/:deviceId/ping
// Prüft ob das Visu-Gerät via VPN-LAN-Adresse erreichbar ist
router.get('/devices/:deviceId/ping', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string
  const vpnDevice = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!vpnDevice) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }

  // Visu-IP: wenn visuIp gesetzt → VPN-LAN-Adresse, sonst Fallback auf Pi's VPN-IP
  const ip = vpnDevice.visuIp
    ? `${deriveVpnLanPrefix(vpnDevice.vpnIp)}.${vpnDevice.visuIp.split('.').pop()}`
    : vpnDevice.vpnIp
  const port = vpnDevice.visuPort

  const start = Date.now()
  const testReq = http.request({ hostname: ip, port, path: '/', method: 'GET', timeout: 5000 }, (testRes) => {
    testRes.resume()
    res.json({ reachable: true, statusCode: testRes.statusCode, latencyMs: Date.now() - start, ip, port })
  })
  testReq.on('timeout', () => testReq.destroy(new Error('TIMEOUT')))
  testReq.on('error', (err) => {
    res.json({ reachable: false, error: err.message, ip, port })
  })
  testReq.end()
})

// ─── Visu-Proxy ───────────────────────────────────────────────────────────────
// GET /api/vpn/devices/:deviceId/visu/*
// Authentifizierung: Bearer-Token im Header ODER ?access_token= als Query-Parameter
// (iframe kann keine Custom-Header senden → Query-Parameter nötig)
//
// Query-Parameter (optional):
//   ?targetIp=192.168.10.50   → anderes Gerät im Pi-LAN (via NETMAP-Route des Pi)
//   ?targetPort=8080          → abweichender Port (überschreibt visuPort)
// ─── LAN-Geräte Proxy ────────────────────────────────────────────────────────
// Separate Route: targetIp und targetPort im Pfad statt Query-Parameter.
// So bleiben die Routing-Infos bei Redirects, Form-Posts und Sub-Ressourcen erhalten.
// URL-Schema: /api/vpn/devices/:deviceId/lan/:lanIp/:lanPort/...
// Regex-Route: matcht /devices/:deviceId/lan/:lanIp/:lanPort und alles dahinter
// Express 4 kann kein optionales Wildcard nach Named-Params, deshalb Regex
router.all(/^\/devices\/([^/]+)\/lan\/([^/]+)\/(\d+)(\/.*)?$/, async (req, res) => {
  const deviceId = req.params[0] as string
  const lanIp = req.params[1] as string
  const lanPortStr = req.params[2] as string
  const lanPort = parseInt(lanPortStr) || 80

  // Strikte Validierung aller Pfad-Parameter: verhindert XSS über URL-Params,
  // die später in injizierten Scripts/Cookies landen würden.
  if (!UUID_RE.test(deviceId)) { res.status(400).json({ message: 'Ungültige Device-ID' }); return }
  if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(lanIp)) {
    res.status(400).json({ message: 'Ungültige LAN-IP' }); return
  }
  if (lanPort < 1 || lanPort > 65535) {
    res.status(400).json({ message: 'Ungültiger LAN-Port' }); return
  }

  // Auth (gleich wie Visu-Route)
  const cookieName = `lan_${deviceId.replace(/-/g, '')}_${lanIp.replace(/\./g, '')}`
  const headerToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null
  const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : null
  const cookieToken = (req.headers.cookie ?? '').split(';')
    .map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1) ?? null
  const rawToken = headerToken ?? queryToken ?? cookieToken

  if (!rawToken) { res.status(401).json({ message: 'Authentifizierung erforderlich' }); return }
  const payload = verifyAccessToken(rawToken)
  if (!payload) { res.status(401).json({ message: 'Token ungültig' }); return }
  const userCtx = await getUserAccessContext(payload.sub)
  if (!userCtx) { res.status(401).json({ message: 'Benutzer nicht gefunden' }); return }

  const vpnDevice = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!vpnDevice) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }

  const proxyBase = `/api/vpn/devices/${deviceId}/lan/${lanIp}/${lanPort}`
  // Auth-Cookie: wird am Ende jeder Response gesetzt (nicht vorher, da Proxy-Header sonst überschreiben)
  const authCookie = (queryToken || headerToken)
    ? `${cookieName}=${rawToken}; Path=${proxyBase}/; HttpOnly; SameSite=Lax; Max-Age=3600`
    : null
  console.log(`[VPN-LAN] Auth: query=${!!queryToken} cookie=${!!cookieToken} header=${!!headerToken} → token=${!!rawToken}`)

  // Basic-Auth-Session-Cookie: enthält nur eine Session-ID, die Credentials
  // bleiben server-seitig in einem in-memory Store (24h TTL).
  const baCookieName = `lanba_${deviceId.replace(/-/g, '').slice(0, 8)}_${lanIp.replace(/\./g, '')}`
  const baSessionId = (req.headers.cookie ?? '').split(';')
    .map(c => c.trim()).find(c => c.startsWith(`${baCookieName}=`))
    ?.slice(baCookieName.length + 1) ?? null
  const baCredentials = baSessionId ? getLanBasicAuth(baSessionId) : null

  // Pfad nach /lan/:ip/:port weitergeben (Regex-Gruppe [3] = restlicher Pfad)
  const rawPath = (req.params[3] as string) || '/'
  const targetPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`

  // POST /_login: Basic-Auth-Credentials speichern und zurückleiten
  if (targetPath === '/_login' && req.method === 'POST') {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8')
      const params = new URLSearchParams(body)
      const user = params.get('username') ?? ''
      const pass = params.get('password') ?? ''
      // Credentials im Server-Speicher ablegen, Cookie bekommt nur die Session-ID.
      const sessionId = storeLanBasicAuth(user, pass)
      const baCookie = `${baCookieName}=${sessionId}; Path=${proxyBase}/; HttpOnly; SameSite=Lax; Max-Age=86400`
      const cookies: string[] = [baCookie]
      if (authCookie) cookies.push(authCookie)
      res.setHeader('set-cookie', cookies)
      res.redirect(302, `${proxyBase}/`)
    })
    return
  }

  // GET /_logout: Basic-Auth-Session löschen
  if (targetPath === '/_logout') {
    if (baSessionId) removeLanBasicAuth(baSessionId)
    const baCookie = `${baCookieName}=; Path=${proxyBase}/; HttpOnly; SameSite=Lax; Max-Age=0`
    const cookies: string[] = [baCookie]
    if (authCookie) cookies.push(authCookie)
    res.setHeader('set-cookie', cookies)
    res.redirect(302, `${proxyBase}/`)
    return
  }

  // Helper: Set-Cookie vom Zielgerät rewriten (Domain entfernen, Path auf Proxy-Pfad setzen)
  function rewriteDeviceCookies(rawCookies: string | string[] | number | undefined): string[] {
    if (!rawCookies) return []
    const arr = Array.isArray(rawCookies) ? rawCookies : [String(rawCookies)]
    return arr.map(c => {
      let cookie = c
        .replace(/;\s*[Dd]omain=[^;]*/g, '')                       // Domain entfernen
        .replace(/;\s*[Ss]ame[Ss]ite=[^;]*/g, '; SameSite=Lax')    // SameSite anpassen
      // Path auf Proxy-Pfad umschreiben
      cookie = cookie.replace(/;\s*[Pp]ath=([^;]*)/g, (_m, p) => {
        const origPath = p.trim()
        if (origPath === '/') return `; Path=${proxyBase}/`
        return `; Path=${proxyBase}${origPath.startsWith('/') ? origPath : '/' + origPath}`
      })
      // Falls kein Path vorhanden, explizit setzen
      if (!/;\s*[Pp]ath=/i.test(cookie)) {
        cookie += `; Path=${proxyBase}/`
      }
      return cookie
    })
  }

  // Helper: Auth-Cookie an Response anhängen (nach allen Proxy-Headern)
  function appendAuthCookie() {
    if (!authCookie) return
    const existing = res.getHeader('set-cookie')
    if (existing) {
      const arr = Array.isArray(existing) ? existing : [String(existing)]
      res.setHeader('set-cookie', [...arr, authCookie])
    } else {
      res.setHeader('set-cookie', authCookie)
    }
  }

  // VPN-LAN-IP berechnen: letztes Oktett der LAN-IP → NETMAP-Prefix des Pi
  const lanLastOctet = lanIp.split('.').pop()
  const vpnLanPrefix = deriveVpnLanPrefix(vpnDevice.vpnIp)
  const piTargetIp = `${vpnLanPrefix}.${lanLastOctet}`

  // Query-String weiterleiten, access_token entfernen
  const queryParams = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '')
  queryParams.delete('access_token')
  const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : ''

  const isHttps = lanPort === 443 || lanPort === 8443
  const targetProto = isHttps ? 'https' : 'http'
  const targetUrl = `${targetProto}://${piTargetIp}:${lanPort}${targetPath}${queryStr}`

  console.log(`[VPN-LAN] ${deviceId} → ${targetUrl} (LAN: ${lanIp}:${lanPort})`)

  function doLanProxy(url: string, redirectsLeft: number): void {
    const parsed = new URL(url)
    const portNum = parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80)
    const hostHdr = portNum === 80 ? parsed.hostname : `${parsed.hostname}:${portNum}`

    // Headers weiterleiten – Cloud-Auth-Cookie + BA-Cookie herausfiltern, nur Device-Cookies senden
    const fwdHeaders: Record<string, string | string[] | undefined> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase()
      if (lk === 'host' || lk === 'authorization' ||
          lk === 'accept-encoding' || lk === 'connection' || lk === 'upgrade') continue
      if (lk === 'cookie') {
        // Cloud-Auth-Cookie (lan_...) und BA-Cookie (lanba_...) entfernen
        const deviceCookies = String(v).split(';')
          .map(c => c.trim())
          .filter(c => !c.startsWith(cookieName + '=') && !c.startsWith(baCookieName + '='))
          .join('; ')
        if (deviceCookies) fwdHeaders[k] = deviceCookies
        continue
      }
      fwdHeaders[k] = v
    }
    fwdHeaders['host'] = hostHdr
    // Basic-Auth-Credentials aus Cookie hinzufügen
    if (baCredentials) {
      fwdHeaders['authorization'] = `Basic ${baCredentials}`
    }

    const isHttpsReq = parsed.protocol === 'https:'
    // TLS-Cert-Validierung ist im LAN-Kontext bewusst nachsichtig: LAN-Geräte
    // haben typisch self-signed oder keine Zertifikate, und wir erreichen sie
    // nur über den verschlüsselten WireGuard-Tunnel. Wir deaktivieren die
    // Verifikation nur wenn die Ziel-IP im privaten Adressbereich liegt (RFC
    // 1918 + 10.0.0.0/8 VPN). Bei öffentlichen Zielen bleibt sie aktiv.
    const reqOpts: https.RequestOptions = {
      hostname: parsed.hostname, port: portNum,
      path: parsed.pathname + parsed.search, method: req.method,
      headers: fwdHeaders,
      timeout: 15000,
      rejectUnauthorized: !isPrivateIp(parsed.hostname),
    }
    if (isHttpsReq) {
      reqOpts.minVersion = 'TLSv1'
      reqOpts.ciphers = 'ALL'
    }

    const reqModule = isHttpsReq ? https : http
    const proxyReq = reqModule.request(reqOpts, (proxyRes) => {
      const status = proxyRes.statusCode ?? 200

      // Basic Auth 401: Login-Formular anzeigen statt Browser-Popup
      const wwwAuth = proxyRes.headers['www-authenticate'] ?? ''
      if (status === 401 && wwwAuth.toLowerCase().startsWith('basic')) {
        proxyRes.resume() // Body verwerfen
        const realm = wwwAuth.match(/realm="([^"]*)"/)?.[1] ?? ''
        console.log(`[VPN-LAN] Basic Auth required (realm="${realm}"), showing login form`)
        appendAuthCookie()
        res.status(200).setHeader('content-type', 'text/html; charset=utf-8').end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anmeldung – ${lanIp}:${lanPort}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1e1e2e;color:#cdd6f4;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#313244;border-radius:12px;padding:2rem;width:100%;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,.3)}
h2{text-align:center;margin-bottom:.5rem;font-size:1.2rem;color:#cba6f7}
.sub{text-align:center;color:#a6adc8;font-size:.85rem;margin-bottom:1.5rem}
label{display:block;font-size:.85rem;margin-bottom:.3rem;color:#bac2de}
input{width:100%;padding:.6rem .8rem;border:1px solid #45475a;border-radius:8px;background:#1e1e2e;color:#cdd6f4;font-size:.95rem;margin-bottom:1rem;outline:none}
input:focus{border-color:#cba6f7}
button{width:100%;padding:.7rem;border:none;border-radius:8px;background:#cba6f7;color:#1e1e2e;font-size:1rem;font-weight:600;cursor:pointer}
button:hover{background:#b4befe}
.err{background:#f38ba8;color:#1e1e2e;padding:.5rem;border-radius:6px;text-align:center;margin-bottom:1rem;font-size:.85rem}
</style></head><body>
<div class="card">
<h2>Geraete-Anmeldung</h2>
<div class="sub">${lanIp}:${lanPort}</div>
${baCredentials ? '<div class="err">Anmeldedaten ungueltig</div>' : ''}
<form method="POST" action="${proxyBase}/_login">
<label for="u">Benutzername</label><input id="u" name="username" autocomplete="username" required autofocus>
<label for="p">Passwort</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Anmelden</button>
</form>
</div></body></html>`)
        return
      }

      // Redirects an den Browser durchreichen (LAN-Geräte brauchen Session-Cookies)
      if ([301, 302, 303, 307, 308].includes(status)) {
        const loc = proxyRes.headers.location
        if (loc) {
          let locPath: string
          if (loc.startsWith('http')) {
            try { locPath = new URL(loc).pathname } catch { locPath = loc }
          } else {
            locPath = loc.startsWith('/') ? loc : `/${loc}`
          }
          // Location auf Proxy-Pfad umschreiben – Routing-Infos bleiben im Pfad!
          res.status(status)
          // Alle Response-Header durchleiten (Set-Cookie rewriten)
          for (const [key, val] of Object.entries(proxyRes.headers)) {
            const k = key.toLowerCase()
            if (k === 'location') continue
            if (k === 'content-encoding' || k === 'transfer-encoding') continue
            if (k === 'set-cookie') { res.setHeader('set-cookie', rewriteDeviceCookies(val)); continue }
            if (val) res.setHeader(key, val as string)
          }
          res.setHeader('location', `${proxyBase}${locPath}`)
          appendAuthCookie()
          proxyRes.resume()
          res.end()
          return
        }
      }

      res.status(status)
      // CSP und X-Frame-Options für iframe-Einbettung
      res.removeHeader('content-security-policy')
      res.removeHeader('x-frame-options')
      res.setHeader('content-security-policy',
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;")

      const ct = (proxyRes.headers['content-type'] ?? '').toLowerCase()
      const encoding = (proxyRes.headers['content-encoding'] ?? '').toLowerCase()
      const needsPatch = ct.includes('text/html') || ct.includes('text/xml') || ct.includes('text/xsl') || ct.includes('application/xml')

      // Headers weiterleiten (content-encoding + transfer-encoding entfernen wenn wir patchen, Set-Cookie rewriten)
      for (const [key, val] of Object.entries(proxyRes.headers)) {
        const k = key.toLowerCase()
        if (k === 'transfer-encoding') continue
        if (k === 'content-encoding' && needsPatch) continue  // wir senden unkomprimiert nach Patching
        if (k === 'content-security-policy' || k === 'x-frame-options') continue
        if (k === 'set-cookie') { res.setHeader('set-cookie', rewriteDeviceCookies(val)); continue }
        if (val) res.setHeader(key, val as string)
      }

      if (needsPatch) {
        // Body sammeln – bei gzip/deflate/br zuerst dekomprimieren
        let stream: NodeJS.ReadableStream = proxyRes
        if (encoding === 'gzip' || encoding === 'x-gzip') {
          stream = proxyRes.pipe(zlib.createGunzip())
        } else if (encoding === 'deflate') {
          stream = proxyRes.pipe(zlib.createInflate())
        } else if (encoding === 'br') {
          stream = proxyRes.pipe(zlib.createBrotliDecompress())
        }

        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        stream.on('end', () => {
          let body = Buffer.concat(chunks).toString('utf-8')

          if (ct.includes('text/xml') || ct.includes('text/xsl') || ct.includes('application/xml')) {
            // XML/XSLT: xml-stylesheet href umschreiben
            body = body.replace(
              /(<\?xml-stylesheet\s[^?]*href\s*=\s*["'])([^"']+)(["'])/g,
              (_m, pre, path, post) => {
                if (path.startsWith('http') || path.startsWith(proxyBase)) return `${pre}${path}${post}`
                const absPath = path.startsWith('/') ? path : `/${path}`
                return `${pre}${proxyBase}${absPath}${post}`
              }
            )
            body = body.replace(
              /(\b(?:src|href)\s*=\s*["'])\/(?!\/|api\/vpn)(.*?)(["'])/g,
              (_m, pre, path, post) => `${pre}${proxyBase}/${path}${post}`
            )
          } else {
            // HTML: absolute Pfade + <base>-Tag + leichter Interceptor für fetch/XHR
            body = body.replace(
              /(\b(?:src|href|action)\s*=\s*["'])\/(?!\/|api\/vpn)(.*?)(["'])/g,
              (_m, pre, path, post) => `${pre}${proxyBase}/${path}${post}`
            )
            // Auch url() in inline-Styles umschreiben: url(/fonts/...) → url(/api/vpn/.../fonts/...)
            body = body.replace(
              /url\(\s*(['"]?)\/(?!\/|api\/vpn)(.*?)\1\s*\)/g,
              (_m, q, path) => `url(${q}${proxyBase}/${path}${q})`
            )

            const base = `<base href="${proxyBase}/">`
            // Leichter Interceptor: fetch(), XHR und dynamische URLs über den Proxy leiten
            const lanScript = [
              '<script>',
              '(function(){',
              'var B="' + proxyBase + '";',
              'function rw(u){if(typeof u!=="string"||!u.startsWith("/"))return u;if(u.startsWith(B)||u.startsWith("/api/vpn/"))return u;return B+u}',
              // fetch() patchen
              'var _f=window.fetch;',
              'window.fetch=function(i,o){if(typeof i==="string")i=rw(i);return _f.call(this,i,o)};',
              // XHR.open() patchen
              'var _x=XMLHttpRequest.prototype.open;',
              'XMLHttpRequest.prototype.open=function(){if(typeof arguments[1]==="string")arguments[1]=rw(arguments[1]);return _x.apply(this,arguments)};',
              '})();',
              '</script>',
            ].join('')

            body = body.includes('<head>')
              ? body.replace('<head>', `<head>${base}${lanScript}`)
              : body.includes('<HEAD>')
                ? body.replace('<HEAD>', `<HEAD>${base}${lanScript}`)
                : `<head>${base}${lanScript}</head>${body}`
          }

          res.removeHeader('content-length')
          res.removeHeader('content-encoding')
          // Defence-in-Depth gegen XSS im LAN-Forward:
          // - X-Content-Type-Options: nosniff → Browser respektiert Content-Type strikt
          // - X-Frame-Options: SAMEORIGIN → keine Einbettung aus fremden Domains
          res.setHeader('x-content-type-options', 'nosniff')
          res.setHeader('x-frame-options', 'SAMEORIGIN')
          appendAuthCookie()
          res.send(body)
        })
        stream.on('error', (err) => {
          console.error(`[VPN-LAN] Decompress error:`, err.message)
          if (!res.headersSent) {
            res.status(502).json({ message: `Dekomprimierungsfehler: ${err.message}` })
          }
        })
      } else {
        // Alles andere (CSS, JS, Bilder, etc.) direkt durchleiten
        appendAuthCookie()
        proxyRes.pipe(res)
      }
    })

    proxyReq.on('timeout', () => proxyReq.destroy(new Error('PROXY_TIMEOUT')))
    proxyReq.on('error', (err) => {
      console.error('[VPN-LAN] %s: %s', url, err.message)
      if (!res.headersSent) {
        if (err.message === 'PROXY_TIMEOUT') {
          res.status(504).json({ message: `Timeout – LAN-Gerät nicht erreichbar (${lanIp}:${lanPort})` })
        } else {
          res.status(502).json({ message: `LAN-Gerät nicht erreichbar (${lanIp}:${lanPort}): ${err.message}` })
        }
      }
    })

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.pipe(proxyReq, { end: true })
    } else {
      proxyReq.end()
    }
  }

  doLanProxy(targetUrl, 0)
})

// POST /api/vpn/devices/:deviceId/visu-ticket
// Authentifizierter Endpoint: Client holt ein Single-Use-Ticket (30s gültig)
// das in der iframe-URL verwendet wird, statt eines JWT. Beim Visu-Aufruf wird
// das Ticket gegen einen HttpOnly-Session-Cookie eingelöst.
router.post('/devices/:deviceId/visu-ticket', authenticate, async (req, res) => {
  const deviceId = req.params.deviceId as string
  if (!req.user) { res.status(401).json({ message: 'Authentifizierung erforderlich' }); return }

  const vpnDevice = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!vpnDevice) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }

  const { ticket, expiresAt } = issueVisuTicket(req.user.userId, req.user.email, deviceId)
  res.json({ ticket, expiresAt })
})

/**
 * Prüft ob eine IPv4-Adresse im privaten Bereich liegt (RFC 1918 + VPN/Loopback).
 * Wird für LAN/VPN-Proxy genutzt, um TLS-Cert-Validierung selektiv zu lockern.
 */
function isPrivateIp(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = parseInt(m[1]), b = parseInt(m[2])
  if (a === 10) return true                          // 10.0.0.0/8 (incl. VPN)
  if (a === 127) return true                         // 127.0.0.0/8 loopback
  if (a === 192 && b === 168) return true            // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
  if (a === 169 && b === 254) return true            // link-local
  return false
}

// ─── Visu-Proxy (Ycontrol Visu auf Pi) ───────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

router.all('/devices/:deviceId/visu*', async (req, res) => {
  const deviceId = req.params.deviceId as string

  // Strikte UUID-Validierung: verhindert XSS über injizierte deviceId-Strings,
  // die später im HTML/JS-Interceptor auftauchen.
  if (!UUID_RE.test(deviceId)) {
    res.status(400).json({ message: 'Ungültige Device-ID' })
    return
  }

  // Cookie-Name für diese Device-Session (Sub-Ressourcen kommen ohne access_token)
  const cookieName = `visu_${deviceId.replace(/-/g, '')}`

  // Auth-Reihenfolge:
  //   1) Single-Use-Ticket (?t=...) – bevorzugt für iframe-Load
  //   2) Session-Cookie (gesetzt beim initialen Load, für Sub-Ressourcen)
  //   3) Bearer-Token im Header (Sonderfall für Scripts)
  //   4) Legacy: ?access_token=<jwt> (Altlast, wird unterstützt, aber deprecated)
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7) : null
  const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : null
  const queryTicket = typeof req.query.t === 'string' ? req.query.t : null
  const cookieToken = (req.headers.cookie ?? '').split(';')
    .map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1) ?? null

  // Session-Token für den Cookie nach erfolgreicher Ticket-Einlösung
  let sessionToken: string | null = cookieToken
  // User-Context aus Ticket-Einlösung oder Token-Verify
  let userId: string | null = null
  let userEmail: string | null = null

  // 1) Ticket: one-shot → Session-Cookie setzen
  if (queryTicket && !cookieToken) {
    const ticketData = consumeVisuTicket(queryTicket, deviceId)
    if (!ticketData) { res.status(401).json({ message: 'Ticket ungültig oder abgelaufen' }); return }
    userId = ticketData.userId
    userEmail = ticketData.email
    // Neues Session-Secret für den Cookie (zufällig, unabhängig vom JWT)
    sessionToken = crypto.randomBytes(32).toString('hex')
  } else {
    // 2) Cookie oder 3/4) Token
    const rawToken = cookieToken ?? headerToken ?? queryToken
    if (!rawToken) { res.status(401).json({ message: 'Authentifizierung erforderlich' }); return }

    // Wenn rawToken ein JWT ist → verifizieren
    // (Session-Cookie speichert nach Ticket-Einlösung ein 64-Hex-Random; in dem Fall
    //  validieren wir nur die Session-Existenz anhand des Cookies und vertrauen ihm
    //  für die Dauer der Session)
    const isHexSession = /^[0-9a-f]{64}$/i.test(rawToken)
    if (isHexSession && cookieToken === rawToken) {
      // Session-Cookie: einmal ausgestellt via Ticket → keine weitere Verifikation möglich
      // (kein Server-seitiger Session-Store nötig, weil das HttpOnly-Cookie
      //  nur bei authentifiziertem Ticket überhaupt gesetzt wird und auf diesen
      //  einen Path beschränkt ist)
      // User-Kontext nicht strikt benötigt für Proxy-Durchreiche
    } else {
      const payload = verifyAccessToken(rawToken)
      if (!payload) { res.status(401).json({ message: 'Token ungültig' }); return }
      const userCtx = await getUserAccessContext(payload.sub)
      if (!userCtx) { res.status(401).json({ message: 'Benutzer nicht gefunden' }); return }
      userId = userCtx.userId
      userEmail = userCtx.email
      sessionToken = rawToken
    }
  }

  // Session-Cookie setzen beim initialen Load (Ticket oder explizites Token).
  if (queryTicket || queryToken || headerToken) {
    const cookiePath = `/api/vpn/devices/${deviceId}/visu`
    res.setHeader('set-cookie',
      `${cookieName}=${sessionToken}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=3600`)

    // Fernzugriff-Event loggen (nur beim initialen Öffnen)
    if (userId) prisma.device.findUnique({
      where: { id: deviceId },
      select: { name: true, serialNumber: true },
    }).then((dev) => {
      logActivity({
        action: 'vpn.visu.open',
        entityType: 'devices',
        entityId: deviceId,
        details: {
          entityName: dev?.name?.trim() || dev?.serialNumber || null,
          remoteUser: typeof req.query.remoteUser === 'string' ? req.query.remoteUser : undefined,
        },
        userId,
        userEmail,
        req,
        statusCode: 200,
      }).catch(() => {})
    }).catch(() => {})
  }

  const vpnDevice = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!vpnDevice) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }

  // Visu-IP: wenn visuIp gesetzt → VPN-LAN-Adresse berechnen, sonst Fallback auf Pi's VPN-IP
  const piVisuIp = vpnDevice.visuIp
    ? `${deriveVpnLanPrefix(vpnDevice.vpnIp)}.${vpnDevice.visuIp.split('.').pop()}`
    : vpnDevice.vpnIp
  const piVisuPort = vpnDevice.visuPort

  // Pfad nach /visu weitergeben
  const rawPath = req.path.replace(`/devices/${deviceId}/visu`, '') || '/'
  const targetPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`

  // Query-String weiterleiten, interne Parameter entfernen
  const queryParams = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '')
  queryParams.delete('access_token')
  queryParams.delete('remoteUser')
  queryParams.delete('targetIp')
  queryParams.delete('targetPort')
  const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : ''
  const targetUrl = `http://${piVisuIp}:${piVisuPort}${targetPath}${queryStr}`

  console.log(`[VPN-Proxy] ${deviceId} → ${targetUrl}`)

  // Hilfsfunktion: einen einzelnen Proxy-Request ausführen (für Redirect-Folgen)
  function doProxy(url: string, redirectsLeft: number): void {
    const parsed = new URL(url)
    const portNum = parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80)
    const hostHdr = portNum === 80 ? parsed.hostname : `${parsed.hostname}:${portNum}`

    // Headers für den Pi bereinigen: keine Cloud-Cookies, Auth-Header oder
    // Accept-Encoding (um Kompression zu vermeiden die wir nicht weiterleiten)
    const fwdHeaders: Record<string, string | string[] | undefined> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase()
      if (lk === 'host' || lk === 'cookie' || lk === 'authorization' ||
          lk === 'accept-encoding' || lk === 'connection' || lk === 'upgrade') continue
      fwdHeaders[k] = v
    }
    fwdHeaders['host'] = hostHdr
    // Content-Type und Content-Length für POST weitergeben (wichtig für Socket.IO Polling)
    if (req.headers['content-type']) fwdHeaders['content-type'] = req.headers['content-type']
    if (req.headers['content-length']) fwdHeaders['content-length'] = req.headers['content-length']

    const proxyReq = http.request(
      { hostname: parsed.hostname, port: portNum, path: parsed.pathname + parsed.search, method: req.method,
        headers: fwdHeaders, timeout: 8000 },
      (proxyRes) => {
        const status = proxyRes.statusCode ?? 200

        // Redirects serverseitig folgen (bis max. 5 Hops)
        if ([301, 302, 303, 307, 308].includes(status) && redirectsLeft > 0) {
          const loc = proxyRes.headers.location
          if (loc) {
            const nextUrl = loc.startsWith('http') ? loc : `http://${parsed.hostname}:${portNum}${loc}`
            proxyRes.resume()
            console.log(`[VPN-Proxy] Redirect → ${nextUrl}`)
            doProxy(nextUrl, redirectsLeft - 1)
            return
          }
        }

        res.status(status)
        const proxyBase = `/api/vpn/devices/${deviceId}/visu`

        // Helmet setzt für ALLE Routen 'script-src self' – hier immer überschreiben
        // damit inline-Scripts der Pi-App funktionieren
        res.removeHeader('content-security-policy')
        res.removeHeader('x-frame-options')
        res.setHeader('content-security-policy',
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;")

        for (const [key, val] of Object.entries(proxyRes.headers)) {
          const k = key.toLowerCase()
          if (k === 'content-encoding' || k === 'transfer-encoding') continue
          if (k === 'content-security-policy' || k === 'x-frame-options') continue  // bereits gesetzt
          if (k === 'location' && val) {
            const locStr = Array.isArray(val) ? val[0] : val
            const locPath = locStr.startsWith('http')
              ? (() => { try { return new URL(locStr).pathname } catch { return locStr } })()
              : locStr.startsWith('/') ? locStr : `/${locStr}`
            res.setHeader('location', `${proxyBase}${locPath}`)
            continue
          }
          res.setHeader(key, val as string)
        }

        // HTML: Visu-Interceptor injizieren
        const ct = (proxyRes.headers['content-type'] ?? '').toLowerCase()
        if (ct.includes('text/html')) {
          // Cache-Control: HTML mit injiziertem Interceptor NIEMALS cachen
          // (sonst kriegen Clients alte Interceptor-Scripts nach Code-Updates)
          res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, max-age=0')
          res.setHeader('pragma', 'no-cache')
          res.setHeader('expires', '0')

          let body = ''
          proxyRes.setEncoding('utf-8')
          proxyRes.on('data', (chunk) => { body += chunk })
          proxyRes.on('end', () => {
            // 1. Absolute Pfade umschreiben: src="/static/..." → src="/api/vpn/...visu/static/..."
            //    (CRA/Webpack bauen mit absoluten Pfaden, <base> hilft da nicht)
            let patched = body.replace(
              /(\b(?:src|href|action)\s*=\s*["'])\/(?!\/)/g,
              `$1${proxyBase}/`
            )

            // Robustes <head>-Replace: matcht <head>, <head lang="en">, <HEAD> etc.
            // Fügt den Content DIREKT nach dem <head...> Open-Tag ein.
            const headRe = /<head(\s[^>]*)?>/i
            const injectAfterHead = (html: string, content: string): string => {
              if (headRe.test(html)) return html.replace(headRe, (m) => m + content)
              return `<head>${content}</head>${html}`
            }

            // 2. <base>-Tag für restliche relative Pfade
            const base = `<base href="${proxyBase}/">`
            patched = injectAfterHead(patched, base)

            // 3. CSP nochmal explizit als Meta-Tag setzen (überschreibt HTTP-Header im Dokument)
            const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;">`
            patched = injectAfterHead(patched, cspMeta)

            // 4. Umfassender URL-Interceptor für Cloud-Proxy:
            //    CRA setzt __webpack_require__.p intern auf "/" – window.__webpack_public_path__ hilft nicht.
            //    Deshalb monkey-patchen wir createElement, fetch(), XHR und WebSocket,
            //    um /static/, /assets/ und /socket.io/ URLs auf den Proxy-Pfad umzuschreiben.
            //    Zusätzlich: __VISU_BASENAME für React Router (BrowserRouter basename-Prop)
            //    und __VISU_SOCKET_PATH für socket.io path-Option.
            const proxyScript = [
              '<script>',
              '(function(){',
              'try{',
              'var B="' + proxyBase + '";',
              'console.log("[VisuProxy] Interceptor active, base="+B);',
              'window.__VISU_SOCKET_PATH=B+"/socket.io/";',
              'window.__VISU_BASENAME=B;',
              // needsRewrite: schreibt ALLE same-origin Pfade um die noch nicht proxied sind.
              // Die Visu-iframe ist isoliert → alle ihre Fetch/XHR-Calls gehen an den Pi,
              // nicht an die Cloud. Deshalb sicher, alles umzuschreiben was nicht unter B/ liegt.
              'function nr(p){if(!p||p.charAt(0)!=="/")return false;if(p===B||p.indexOf(B+"/")===0)return false;return true}',
              // rewrite: schreibt URL um wenn nötig
              'function rw(u){try{var x=new URL(u,location.origin);if(x.origin===location.origin&&nr(x.pathname))return x.origin+B+x.pathname+x.search+x.hash}catch(e){}return u}',
              // 1. createElement: script.src, link.href, img.src
              'var ce=document.createElement;',
              'document.createElement=function(t){',
              '  var el=ce.call(document,t),tl=(t||"").toLowerCase();',
              '  if(tl==="script"){var ds=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,"src");if(ds&&ds.set)Object.defineProperty(el,"src",{set:function(v){ds.set.call(this,typeof v==="string"?rw(v):v)},get:function(){return ds.get.call(this)},configurable:true})}',
              '  else if(tl==="link"){var dl=Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype,"href");if(dl&&dl.set)Object.defineProperty(el,"href",{set:function(v){dl.set.call(this,typeof v==="string"?rw(v):v)},get:function(){return dl.get.call(this)},configurable:true})}',
              '  else if(tl==="img"){var di=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");if(di&&di.set)Object.defineProperty(el,"src",{set:function(v){di.set.call(this,typeof v==="string"?rw(v):v)},get:function(){return di.get.call(this)},configurable:true})}',
              '  return el',
              '};',
              // 2. fetch()
              'var fe=window.fetch;',
              'window.fetch=function(i,o){',
              '  if(typeof i==="string")i=rw(i);',
              '  else if(i instanceof Request){try{var x=new URL(i.url);if(x.origin===location.origin&&nr(x.pathname))i=new Request(x.origin+B+x.pathname+x.search,i)}catch(e){}}',
              '  return fe.call(this,i,o)',
              '};',
              // 3. XMLHttpRequest.open() – patcht auch nach io() Aufrufen
              'var xo=XMLHttpRequest.prototype.open;',
              'XMLHttpRequest.prototype.open=function(){',
              '  if(typeof arguments[1]==="string"){',
              '    var orig=arguments[1],rewr=rw(orig);',
              '    if(rewr!==orig)console.log("[VisuProxy] XHR rewrite:",orig,"→",rewr);',
              '    arguments[1]=rewr;',
              '  }',
              '  return xo.apply(this,arguments)',
              '};',
              // 4. WebSocket: socket.io WebSocket-Transport URL umschreiben
              'var WS=window.WebSocket;',
              'window.WebSocket=function(u,p){',
              '  if(typeof u==="string"){try{var x=new URL(u);if(x.origin.replace("http","ws")===location.origin.replace("http","ws")&&(nr(x.pathname)||x.pathname.startsWith("/socket.io/")))x.pathname=B+x.pathname,u=x.toString()}catch(e){}}',
              '  return p!==undefined?new WS(u,p):new WS(u)',
              '};',
              'window.WebSocket.prototype=WS.prototype;',
              'window.WebSocket.CONNECTING=WS.CONNECTING;window.WebSocket.OPEN=WS.OPEN;window.WebSocket.CLOSING=WS.CLOSING;window.WebSocket.CLOSED=WS.CLOSED;',
              // 5. MutationObserver: img-Elemente im DOM nachträglich fixen
              'new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){',
              '  if(n.nodeType!==1)return;',
              '  var s=n.tagName==="IMG"&&n.getAttribute("src");',
              '  if(s&&nr(s))n.setAttribute("src",B+s);',
              '  if(n.querySelectorAll)n.querySelectorAll("img[src]").forEach(function(i){var a=i.getAttribute("src");if(a&&nr(a))i.setAttribute("src",B+a)})',
              '})})}).observe(document.documentElement,{childList:true,subtree:true});',
              'console.log("[VisuProxy] Interceptor ready, socket="+window.__VISU_SOCKET_PATH+", basename="+window.__VISU_BASENAME);',
              '}catch(err){console.error("[VisuProxy] Interceptor error:",err)}',
              '})();',
              '</script>',
            ].join('\n')
            patched = injectAfterHead(patched, proxyScript)

            res.removeHeader('content-length')
            res.send(patched)
          })
        } else {
          proxyRes.pipe(res)
        }
      }
    )

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('PROXY_TIMEOUT'))
    })

    proxyReq.on('error', (err) => {
      // %s-Format-Specifier verwenden, damit `url` (potenziell user-controlled via Query)
      // NICHT als Format-String interpretiert wird – fixt CodeQL js/tainted-format-string.
      console.error('[VPN-Proxy] %s: %s', url, err.message)
      if (!res.headersSent) {
        if (err.message === 'PROXY_TIMEOUT') {
          res.status(504).json({ message: `Timeout – Pi nicht erreichbar via VPN (${piVisuIp}:${piVisuPort}). WireGuard aktiv?` })
        } else {
          res.status(502).json({ message: `Pi nicht erreichbar (${piVisuIp}:${piVisuPort}): ${err.message}` })
        }
      }
    })

    // Für POST-Requests (Socket.IO Polling) den Body direkt streamen,
    // nicht req.body nutzen (das ist nach express.json() bereits geparst/verbraucht)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.pipe(proxyReq, { end: true })
    } else {
      proxyReq.end()
    }
  }

  doProxy(targetUrl, 5)
})

export default router
