import React, { createContext, useContext, useEffect, useState } from 'react'
import type { MeResponse, LoginResponse } from '../types/model'
import { setTokens, clearTokens, apiFetch } from '../lib/api'
import { connectSocket, disconnectSocket } from '../lib/socket'

interface SessionContextValue {
  me: MeResponse | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  hasPermission: (permission: string) => boolean
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (token) {
      apiFetch('/me')
        .then((res) => res.ok ? res.json() : null)
        .then((data: MeResponse | null) => {
          if (data) {
            setMe(data)
            connectSocket(token)
          } else {
            clearTokens()
          }
        })
        .finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }

    const handleLogout = () => {
      setMe(null)
      clearTokens()
      disconnectSocket()
    }
    window.addEventListener('auth:logout', handleLogout)
    return () => window.removeEventListener('auth:logout', handleLogout)
  }, [])

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      let message = 'Login fehlgeschlagen'
      try {
        const err = await res.json()
        message = err.message ?? message
      } catch {
        // Response had no JSON body (e.g. 502 proxy / backend not running)
      }
      throw new Error(message)
    }

    const data: LoginResponse = await res.json()
    setTokens(data.accessToken, data.refreshToken)
    setMe(data.me)
    connectSocket(data.accessToken)
  }

  const logout = () => {
    const refreshToken = localStorage.getItem('refreshToken')
    apiFetch('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {})
    setMe(null)
    clearTokens()
    disconnectSocket()
  }

  const hasPermission = (permission: string) => {
    if (!me) return false
    // Admin hat IMMER Zugriff auf alles — unabhängig vom permissions-Array
    if (me.roleName === 'admin') return true
    return me.permissions.includes(permission)
  }

  return (
    <SessionContext.Provider value={{ me, isLoading, login, logout, hasPermission }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
