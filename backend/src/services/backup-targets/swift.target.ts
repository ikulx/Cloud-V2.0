import { Readable } from 'stream'
import type { BackupTarget, BackupObject, BackupTargetId } from './index'

/**
 * OpenStack-Swift-Target für Infomaniak Swiss Backup (Swift-Protokoll).
 *
 * Authentifizierung: Keystone v3 (POST /auth/tokens).
 * Das zurückkommende X-Subject-Token + die Swift-URL aus dem Service-Catalog
 * werden gecacht bis kurz vor Ablauf; beim nächsten Call neu geholt.
 *
 * API-Operationen sind schnörkellose REST-Calls gegen den Swift-Proxy:
 *   PUT    /<container>/<object>      upload
 *   GET    /<container>/<object>      download
 *   DELETE /<container>/<object>      retention
 *   GET    /<container>?prefix=...    listing (JSON)
 *
 * Es gibt hier absichtlich keine pkgcloud-/openstack-Node-Abhängigkeit – das
 * sind träge zu wartende Mega-Libs, und der Swift-HTTP-Contract passt in
 * ~200 Zeilen.
 */

interface SwiftConfig {
  id: BackupTargetId
  authUrl: string            // z.B. https://swiss-backup02.infomaniak.com/identity/v3
  username: string           // User-ID oder Name (je nach Infomaniak-Setup)
  password: string
  userDomain: string         // default 'Default'
  projectName: string        // Project/Tenant Name
  projectDomain: string      // default 'Default'
  region: string             // z.B. 'RegionOne' (Infomaniak nutzt das)
  container: string          // "Bucket"-Name
}

interface SwiftToken {
  token: string
  swiftUrl: string           // z.B. https://swiss-backup02.infomaniak.com/v1/AUTH_xxx
  expiresAt: number          // epoch-ms
}

export function createSwiftTarget(cfg: SwiftConfig): BackupTarget {
  let tokenCache: SwiftToken | null = null

  /** Holt ein neues Keystone-v3-Token inkl. Swift-Endpoint aus dem Catalog. */
  async function authenticate(): Promise<SwiftToken> {
    const body = {
      auth: {
        identity: {
          methods: ['password'],
          password: {
            user: {
              name: cfg.username,
              domain: { name: cfg.userDomain || 'Default' },
              password: cfg.password,
            },
          },
        },
        scope: {
          project: {
            name: cfg.projectName,
            domain: { name: cfg.projectDomain || 'Default' },
          },
        },
      },
    }
    const url = cfg.authUrl.replace(/\/$/, '') + '/auth/tokens'
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Keystone-Auth fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 300)}`)
    }
    const token = res.headers.get('x-subject-token')
    if (!token) throw new Error('Keystone-Auth: X-Subject-Token-Header fehlt')

    const json = await res.json() as {
      token: {
        expires_at: string
        catalog: Array<{
          type: string
          endpoints: Array<{ interface: string; region: string; url: string }>
        }>
      }
    }

    // Swift-Endpoint im Catalog suchen: type=object-store, interface=public,
    // region matcht (case-insensitive).
    const objectStore = json.token.catalog.find((c) => c.type === 'object-store')
    if (!objectStore) throw new Error('Keystone-Catalog enthält kein object-store')
    const wantRegion = (cfg.region || '').toLowerCase()
    const endpoint =
      objectStore.endpoints.find((e) => e.interface === 'public' && e.region.toLowerCase() === wantRegion)
      || objectStore.endpoints.find((e) => e.interface === 'public')
      || objectStore.endpoints[0]
    if (!endpoint) throw new Error('Kein Swift-Endpoint im Keystone-Catalog')

    const expiresAt = Date.parse(json.token.expires_at) || (Date.now() + 30 * 60_000)
    return {
      token,
      swiftUrl: endpoint.url.replace(/\/$/, ''),
      // 60s Puffer, damit wir nicht mitten im Request ablaufen.
      expiresAt: expiresAt - 60_000,
    }
  }

  async function getToken(): Promise<SwiftToken> {
    if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache
    tokenCache = await authenticate()
    return tokenCache
  }

  /** Ruft eine Swift-Request auf; bei 401 einmal Token refreshen + erneut. */
  async function swiftFetch(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    async function doFetch(): Promise<Response> {
      const t = await getToken()
      const url = t.swiftUrl + path
      const headers: Record<string, string> = {
        'X-Auth-Token': t.token,
        ...(init.headers as Record<string, string> | undefined),
      }
      return fetch(url, { ...init, method, headers })
    }
    let res = await doFetch()
    if (res.status === 401) {
      tokenCache = null
      res = await doFetch()
    }
    return res
  }

  function objectPath(key: string): string {
    // Swift akzeptiert '/' in Object-Names nativ – nur URL-encoden.
    return `/${encodeURIComponent(cfg.container)}/${key.split('/').map(encodeURIComponent).join('/')}`
  }

  return {
    id: cfg.id,

    async put(key: string, body: Readable, size: number): Promise<void> {
      // Swift unterstützt Chunked-Transfer-Encoding, aber Infomaniak's Proxy
      // mag explizite Content-Length deutlich lieber. Für Streams mit bekannter
      // Size (wir haben die) setzen wir sie daher.
      const headers: Record<string, string> = { 'Content-Type': 'application/gzip' }
      if (size > 0) headers['Content-Length'] = String(size)
      // Fetch erwartet Node-Readable als Duplex-Request-Stream (Node 18+ ok).
      // duplex='half' ist Node-Fetch-Spezifikum und fehlt in lib.dom-Types.
      const init = {
        body: body as unknown as ReadableStream,
        headers,
        duplex: 'half',
      } as RequestInit
      const res = await swiftFetch('PUT', objectPath(key), init)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Swift PUT fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 300)}`)
      }
    },

    async list(prefix: string): Promise<BackupObject[]> {
      // Swift-JSON-Listing: ?format=json&prefix=...
      const res = await swiftFetch('GET', `/${encodeURIComponent(cfg.container)}?format=json&prefix=${encodeURIComponent(prefix)}`)
      if (res.status === 404) return []
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Swift LIST fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 300)}`)
      }
      const rows = await res.json() as Array<{ name: string; bytes: number; last_modified: string }>
      return rows.map((r) => ({
        key: r.name,
        size: r.bytes,
        mtime: new Date(r.last_modified + 'Z'),  // Swift liefert UTC ohne TZ-Marker
      }))
    },

    async get(key: string): Promise<Readable> {
      const res = await swiftFetch('GET', objectPath(key))
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Swift GET fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 300)}`)
      }
      if (!res.body) throw new Error('Swift GET: leerer Body')
      // Node WebStream → Node-Readable.
      return Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
    },

    async delete(key: string): Promise<void> {
      const res = await swiftFetch('DELETE', objectPath(key))
      // 404 ist OK (bereits gelöscht), alles andere außer 2xx ist Fehler.
      if (res.status === 404) return
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Swift DELETE fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 300)}`)
      }
    },

    async test(): Promise<void> {
      // HEAD aufs Container prüft Keystone-Auth + Bucket-Existenz + Rechte.
      const res = await swiftFetch('HEAD', `/${encodeURIComponent(cfg.container)}`)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Swift HEAD Container fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 300) || 'keine Antwort'}`)
      }
    },
  }
}
