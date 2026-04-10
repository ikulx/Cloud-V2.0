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
import {
  peerIp,
  generateWgKeypair,
  generateDevicePiConfig,
  generatePeerConfig,
  buildDevicePeerBlock,
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
    piPublicKey: vpnDevice.piPublicKey,
    createdAt:   vpnDevice.createdAt,
  })
})

// POST /api/vpn/devices/:deviceId/enable
const enableDeviceSchema = z.object({
  vpnIp:       z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/),
  localPrefix: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/).optional(),
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
    piPublicKey: vpnDevice.piPublicKey,
    createdAt:   vpnDevice.createdAt,
  })
  syncAll().catch((e) => console.error('[VPN] syncAll nach device enable:', e))
})

// PUT /api/vpn/devices/:deviceId
const updateDeviceSchema = z.object({
  vpnIp:       z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/).optional(),
  localPrefix: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/).optional(),
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
    },
  })

  res.json({ id: updated.id, deviceId, vpnIp: updated.vpnIp, localPrefix: updated.localPrefix })
  syncAll().catch((e) => console.error('[VPN] syncAll nach device update:', e))
})

// DELETE /api/vpn/devices/:deviceId
router.delete('/devices/:deviceId', authenticate, requirePermission('vpn:manage'), async (req, res) => {
  const deviceId = req.params.deviceId as string
  const existing = await prisma.vpnDevice.findUnique({ where: { deviceId } })
  if (!existing) { res.status(404).json({ message: 'Kein VPN für dieses Gerät' }); return }

  await prisma.vpnDevice.delete({ where: { deviceId } })
  syncAll().catch((e) => console.error('[VPN] syncAll nach device delete:', e))
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

  publishCommand(device.serialNumber, { action: 'vpn_install' })
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

export default router
