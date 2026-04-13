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
    },
  })

  res.json({ id: updated.id, deviceId, vpnIp: updated.vpnIp, localPrefix: updated.localPrefix, visuPort: updated.visuPort })
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
})

// POST /api/vpn/devices/:deviceId/deploy
router.post('/devices/:deviceId/deploy', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { serialNumber: true, isApproved: true },
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
  if (hashDeviceSecret(secret) !== device.deviceSecret) { res.status(403).json({ message: 'Nicht autorisiert' }); return }

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
router.get('/server-config', authenticate, requirePermission('vpn:manage'), async (_req, res) => {
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
})

// ─── VPN-Erreichbarkeitstest ──────────────────────────────────────────────────
// GET /api/vpn/devices/:deviceId/ping
// Prüft ob der Pi via VPN-IP auf dem konfigurierten visuPort erreichbar ist
router.get('/devices/:deviceId/ping', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string
  const vpnDevice = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!vpnDevice) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }

  const ip   = vpnDevice.vpnIp
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
router.all('/devices/:deviceId/visu*', async (req, res) => {
  const deviceId = req.params.deviceId as string
  // Cookie-Name für diese Device-Session (Sub-Ressourcen kommen ohne access_token)
  const cookieName = `visu_${deviceId.replace(/-/g, '')}`

  // Token aus Header, Query-Parameter oder Session-Cookie
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7) : null
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

  // Session-Cookie setzen damit Sub-Ressourcen (JS/CSS) ohne access_token-Param geladen werden
  if (queryToken || headerToken) {
    const cookiePath = `/api/vpn/devices/${deviceId}/visu`
    res.setHeader('set-cookie',
      `${cookieName}=${rawToken}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=3600`)
  }

  const vpnDevice = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!vpnDevice) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }

  // Ziel-IP bestimmen:
  // - Standard: direkte VPN-IP des Pi (10.A.0.B) – kein NETMAP nötig
  // - Mit ?targetIp=192.168.10.50: anderes LAN-Gerät via NETMAP-Route (10.A.B.50)
  const targetIpParam = typeof req.query.targetIp === 'string' ? req.query.targetIp : null
  const targetPortParam = typeof req.query.targetPort === 'string' ? parseInt(req.query.targetPort) : null

  let piVisuIp: string
  if (targetIpParam) {
    // Letztes Oktett der LAN-IP → VPN-LAN-IP über NETMAP-Prefix des Pi
    const lanLastOctet = targetIpParam.split('.').pop()
    const vpnLanPrefix = deriveVpnLanPrefix(vpnDevice.vpnIp)
    piVisuIp = `${vpnLanPrefix}.${lanLastOctet}`
  } else {
    piVisuIp = vpnDevice.vpnIp  // direkte VPN-IP
  }
  const piVisuPort = (targetPortParam && targetPortParam > 0 && targetPortParam < 65536)
    ? targetPortParam
    : vpnDevice.visuPort  // Default 80, konfigurierbar

  // Pfad nach /visu weitergeben
  const rawPath = req.path.replace(`/devices/${deviceId}/visu`, '') || '/'
  const targetPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`

  // Query-String weiterleiten, interne Parameter entfernen
  const queryParams = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '')
  queryParams.delete('access_token')
  queryParams.delete('targetIp')
  queryParams.delete('targetPort')
  queryParams.delete('remoteUser')
  const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : ''
  // HTTPS wenn Port 443 (oder explizit als HTTPS konfiguriert)
  const isHttps = piVisuPort === 443
  const targetProto = isHttps ? 'https' : 'http'
  const targetUrl = `${targetProto}://${piVisuIp}:${piVisuPort}${targetPath}${queryStr}`
  // LAN-Geräte (via targetIp): kein Interceptor-Script injizieren
  const isLanDevice = !!targetIpParam

  console.log(`[VPN-Proxy] ${deviceId} → ${targetUrl}${isLanDevice ? ' (LAN-Gerät, kein Interceptor)' : ''}`)

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
      // LAN-Geräte: Cookies durchleiten (TECO braucht Session-Cookies)
      // Visu: Cookies sperren (sind Cloud-Cookies, nicht Pi-Cookies)
      if (lk === 'host' || lk === 'authorization' ||
          lk === 'accept-encoding' || lk === 'connection' || lk === 'upgrade') continue
      if (lk === 'cookie' && !isLanDevice) continue
      fwdHeaders[k] = v
    }
    fwdHeaders['host'] = hostHdr
    // Content-Type und Content-Length für POST weitergeben (wichtig für Socket.IO Polling)
    if (req.headers['content-type']) fwdHeaders['content-type'] = req.headers['content-type']
    if (req.headers['content-length']) fwdHeaders['content-length'] = req.headers['content-length']

    const reqModule = parsed.protocol === 'https:' ? https : http
    const proxyReq = reqModule.request(
      { hostname: parsed.hostname, port: portNum, path: parsed.pathname + parsed.search, method: req.method,
        headers: fwdHeaders,
        timeout: 15000,  // 15s Gesamttimeout – HTTPS-Handshake via VPN braucht mehr Zeit
        rejectUnauthorized: false,  // Self-signed Zertifikate akzeptieren (LAN-Geräte)
      },
      (proxyRes) => {
        const status = proxyRes.statusCode ?? 200

        // Redirects (301/302/303/307/308):
        // - Visu (kein LAN-Gerät): serverseitig folgen (bis max. 5 Hops)
        // - LAN-Geräte: an Browser durchreichen (TECO braucht Session-Cookies)
        if ([301, 302, 303, 307, 308].includes(status)) {
          const loc = proxyRes.headers.location
          if (loc && !isLanDevice && redirectsLeft > 0) {
            const nextUrl = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.hostname}:${portNum}${loc}`
            proxyRes.resume()  // Body verwerfen
            console.log(`[VPN-Proxy] Redirect → ${nextUrl}`)
            doProxy(nextUrl, redirectsLeft - 1)
            return
          }
          // LAN-Geräte: Redirect an Browser durchreichen (Location wird unten umgeschrieben)
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
            // Pfad aus dem Location-Header extrahieren
            let locPath: string
            if (locStr.startsWith('http')) {
              try { locPath = new URL(locStr).pathname } catch { locPath = locStr }
            } else {
              locPath = locStr.startsWith('/') ? locStr : `/${locStr}`
            }
            // Für LAN-Geräte: Query-Params (targetIp, targetPort, access_token) anhängen
            if (isLanDevice) {
              const lp = new URLSearchParams()
              if (targetIpParam) lp.set('targetIp', targetIpParam)
              if (targetPortParam) lp.set('targetPort', String(targetPortParam))
              if (rawToken) lp.set('access_token', rawToken)
              res.setHeader('location', `${proxyBase}${locPath}?${lp.toString()}`)
            } else {
              res.setHeader('location', `${proxyBase}${locPath}`)
            }
            continue
          }
          res.setHeader(key, val as string)
        }

        // HTML: absolute Pfade + <base>-Tag umschreiben
        const ct = (proxyRes.headers['content-type'] ?? '').toLowerCase()
        if (ct.includes('text/html') && !isLanDevice) {
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

            // 2. <base>-Tag für restliche relative Pfade
            const baseHref = targetIpParam
              ? `${proxyBase}/?targetIp=${encodeURIComponent(targetIpParam)}${targetPortParam ? `&targetPort=${targetPortParam}` : ''}&access_token=${encodeURIComponent(rawToken ?? '')}`
              : `${proxyBase}/`
            const base = `<base href="${baseHref}">`
            patched = patched.includes('<head>')
              ? patched.replace('<head>', `<head>${base}`)
              : `<head>${base}</head>${patched}`

            // 3. CSP nochmal explizit als Meta-Tag setzen (überschreibt HTTP-Header im Dokument)
            const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;">`
            patched = patched.replace('<head>', `<head>${cspMeta}`)

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
              // needsRewrite: prüft ob Pfad umgeschrieben werden muss
              'function nr(p){return p.startsWith("/static/")||p.startsWith("/assets/")||p==="/manifest.json"||p==="/favicon.ico"||p.startsWith("/logo")}',
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
              // 3. XMLHttpRequest.open()
              'var xo=XMLHttpRequest.prototype.open;',
              'XMLHttpRequest.prototype.open=function(){',
              '  if(typeof arguments[1]==="string")arguments[1]=rw(arguments[1]);',
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
            patched = patched.replace('<head>', `<head>${proxyScript}`)

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
      console.error(`[VPN-Proxy] ${url}:`, err.message)
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
