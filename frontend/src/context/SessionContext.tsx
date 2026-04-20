import React, { createContext, useContext, useEffect, useState } from 'react'
import type { MeResponse, LoginResponse } from '../types/model'
import { setTokens, clearTokens, apiFetch } from '../lib/api'
import { connectSocket, disconnectSocket } from '../lib/socket'

export interface TwoFAChallenge {
  challengeId: string
  email: string
  expiresAt: string
}

interface SessionContextValue {
  me: MeResponse | null
  isLoading: boolean
  /** Liefert eine Challenge zurück, wenn der Benutzer 2FA benötigt. */
  login: (email: string, password: string) => Promise<TwoFAChallenge | null>
  verify2FA: (challengeId: string, code: string) => Promise<void>
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

  const login = async (email: string, password: string): Promise<TwoFAChallenge | null> => {
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

    const data = await res.json() as LoginResponse | { needs2FA: true; challengeId: string; email: string; expiresAt: string }

    if ('needs2FA' in data && data.needs2FA) {
      return { challengeId: data.challengeId, email: data.email, expiresAt: data.expiresAt }
    }

    const tokens = data as LoginResponse
    setTokens(tokens.accessToken, tokens.refreshToken)
    setMe(tokens.me)
    connectSocket(tokens.accessToken)
    return null
  }

  const verify2FA = async (challengeId: string, code: string) => {
    const res = await fetch('/api/auth/verify-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, code }),
    })

    if (!res.ok) {
      let message = 'Code ungültig'
      try {
        const err = await res.json()
        message = err.message ?? message
      } catch { /* ignore */ }
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
    // System-Rolle (nur vom Seed gesetzt) hat IMMER Zugriff auf alles.
    // Fallback auf roleName-Match für API-Antworten die isSystemRole noch nicht liefern.
    if (me.isSystemRole === true) return true
    if (me.roleName === 'admin') return true
    return me.permissions.includes(permission)
  }

  return (
    <SessionContext.Provider value={{ me, isLoading, login, verify2FA, logout, hasPermission }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
