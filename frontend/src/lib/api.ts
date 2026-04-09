const BASE = '/api'

function getTokens() {
  return {
    accessToken: localStorage.getItem('accessToken'),
    refreshToken: localStorage.getItem('refreshToken'),
  }
}

function setTokens(access: string, refresh: string) {
  localStorage.setItem('accessToken', access)
  localStorage.setItem('refreshToken', refresh)
}

export function clearTokens() {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
}

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken } = getTokens()
  if (!refreshToken) return null

  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })

  if (!res.ok) {
    clearTokens()
    return null
  }

  const data = await res.json()
  setTokens(data.accessToken, data.refreshToken)
  return data.accessToken
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { accessToken } = getTokens()

  const makeRequest = (token: string | null) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers as Record<string, string> ?? {}),
      },
    })

  let res = await makeRequest(accessToken)

  if (res.status === 401) {
    if (isRefreshing) {
      const newToken = await new Promise<string>((resolve) => {
        refreshQueue.push(resolve)
      })
      res = await makeRequest(newToken)
    } else {
      isRefreshing = true
      const newToken = await refreshAccessToken()
      isRefreshing = false

      if (newToken) {
        refreshQueue.forEach((cb) => cb(newToken))
        refreshQueue = []
        res = await makeRequest(newToken)
      } else {
        window.dispatchEvent(new Event('auth:logout'))
      }
    }
  }

  return res
}

async function parseJsonSafe<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  if (!res.ok) throw new Error(await res.text())
  return parseJsonSafe<T>(res)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return parseJsonSafe<T>(res)
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return parseJsonSafe<T>(res)
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'PUT', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return parseJsonSafe<T>(res)
}

export async function apiDelete(path: string): Promise<void> {
  const res = await apiFetch(path, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export { setTokens }
