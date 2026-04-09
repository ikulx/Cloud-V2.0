import { io, Socket } from 'socket.io-client'
import { useEffect } from 'react'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      path: '/api/socket',
      auth: { token: localStorage.getItem('accessToken') },
      autoConnect: false,
    })
  }
  return socket
}

export function connectSocket(token: string) {
  const s = getSocket()
  s.auth = { token }
  if (!s.connected) s.connect()
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}

export function useSocketEvent<T>(event: string, handler: (data: T) => void) {
  useEffect(() => {
    const s = getSocket()
    s.on(event, handler)
    return () => { s.off(event, handler) }
  }, [event, handler])
}
