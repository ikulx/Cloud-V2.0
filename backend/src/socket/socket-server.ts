import { Server as HttpServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import { env } from '../config/env'
import { verifyAccessToken } from '../lib/token'
import { getUserAccessContext } from '../services/user-context.service'
import { prisma } from '../db/prisma'
import { buildVisibleDevicesWhere, buildVisibleAnlagenWhere } from '../lib/access-filter'

export function createSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    path: '/api/socket',
    cors: {
      origin: env.corsOrigin,
      credentials: true,
    },
  })

  // Auth middleware for all socket connections
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) {
      next(new Error('Authentifizierung erforderlich'))
      return
    }

    const payload = verifyAccessToken(token)
    if (!payload) {
      next(new Error('Token ungültig'))
      return
    }

    const userContext = await getUserAccessContext(payload.sub)
    if (!userContext) {
      next(new Error('Benutzer nicht gefunden'))
      return
    }

    socket.data.user = userContext
    next()
  })

  io.on('connection', async (socket) => {
    const user = socket.data.user
    console.log(`[Socket] Connected: ${user.email}`)

    // Join rooms for all visible devices
    const where = buildVisibleDevicesWhere(user)
    const visibleDevices = await prisma.device.findMany({
      where,
      select: { id: true },
    })

    for (const device of visibleDevices) {
      await socket.join(`device:${device.id}`)
    }

    // Auto-join Anlage-Rooms für Alarm-Events (alarm:new, alarm:cleared).
    const anlageWhere = buildVisibleAnlagenWhere(user)
    const visibleAnlagen = await prisma.anlage.findMany({
      where: anlageWhere,
      select: { id: true },
    })
    for (const anlage of visibleAnlagen) {
      await socket.join(`anlage:${anlage.id}`)
    }

    // Client can request additional subscriptions
    socket.on('subscribe:device', async (deviceId: string) => {
      const where = buildVisibleDevicesWhere(user)
      const device = await prisma.device.findFirst({
        where: { id: deviceId, ...where },
        select: { id: true },
      })
      if (device) {
        await socket.join(`device:${device.id}`)
        socket.emit('subscribed:device', deviceId)
      }
    })

    socket.on('subscribe:anlage', async (anlageId: string) => {
      const where = buildVisibleAnlagenWhere(user)
      const anlage = await prisma.anlage.findFirst({
        where: { id: anlageId, ...where },
        select: { id: true },
      })
      if (anlage) {
        await socket.join(`anlage:${anlage.id}`)
        socket.emit('subscribed:anlage', anlageId)
      }
    })

    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${user.email}`)
    })
  })

  return io
}
