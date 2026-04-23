import { Readable } from 'stream'
import type { BackupTarget, BackupObject, BackupTargetId } from './index'

interface WebDavConfig {
  id: BackupTargetId
  url: string
  user: string
  password: string
  basePath: string
}

function joinPath(base: string, key: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const k = key.startsWith('/') ? key : '/' + key
  return b + k
}

// webdav ist ein ESM-only-Paket. Wir laden es per dynamischem import (cached
// nach dem ersten Aufruf) und packen die Methoden in einen schmalen Wrapper,
// damit der restliche CJS-Backend ungeändert bleiben kann.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let webdavMod: any | null = null
// TS würde `import('webdav')` bei `module: CommonJS` zu require() umschreiben –
// das schlägt für das ESM-only-Paket fehl. Mit `new Function` bauen wir den
// Aufruf zur Laufzeit, sodass Node ihn als nativen dynamischen Import sieht.
// eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-explicit-any
const dynImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as never
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadWebdav(): Promise<any> {
  if (!webdavMod) {
    webdavMod = await dynImport('webdav')
  }
  return webdavMod
}

export function createWebdavTarget(cfg: WebDavConfig): BackupTarget {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let clientPromise: Promise<any> | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getClient(): Promise<any> {
    if (!clientPromise) {
      clientPromise = loadWebdav().then((mod) => mod.createClient(cfg.url, {
        username: cfg.user,
        password: cfg.password,
      }))
    }
    return clientPromise
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function ensureParents(client: any, remotePath: string): Promise<void> {
    const parts = remotePath.split('/').filter(Boolean)
    parts.pop() // letzter Eintrag = Datei
    let cur = ''
    for (const p of parts) {
      cur += '/' + p
      const exists = await client.exists(cur).catch(() => false)
      if (!exists) {
        try { await client.createDirectory(cur) } catch { /* race ok */ }
      }
    }
  }

  return {
    id: cfg.id,

    async put(key: string, body: Readable, size: number): Promise<void> {
      const client = await getClient()
      const remote = joinPath(cfg.basePath, key)
      await ensureParents(client, remote)
      await new Promise<void>((resolve, reject) => {
        const ws = client.createWriteStream(remote, {
          headers: size > 0 ? { 'Content-Length': String(size) } : undefined,
        })
        ws.on('error', reject)
        ws.on('finish', () => resolve())
        body.on('error', reject)
        body.pipe(ws)
      })
    },

    async list(prefix: string): Promise<BackupObject[]> {
      const client = await getClient()
      const remote = joinPath(cfg.basePath, prefix)
      const exists = await client.exists(remote).catch(() => false)
      if (!exists) return []
      const items = await client.getDirectoryContents(remote, { deep: false })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = Array.isArray(items) ? items : items.data
      return arr
        .filter((it: { type: string }) => it.type === 'file')
        .map((it: { basename: string; size: number; lastmod: string }) => ({
          key: prefix.replace(/\/$/, '') + '/' + it.basename,
          size: it.size,
          mtime: new Date(it.lastmod),
        }))
    },

    async get(key: string): Promise<Readable> {
      const client = await getClient()
      const remote = joinPath(cfg.basePath, key)
      return client.createReadStream(remote) as Readable
    },

    async delete(key: string): Promise<void> {
      const client = await getClient()
      const remote = joinPath(cfg.basePath, key)
      await client.deleteFile(remote)
    },

    async test(): Promise<void> {
      const client = await getClient()
      const exists = await client.exists(cfg.basePath).catch(() => false)
      if (!exists) {
        await client.createDirectory(cfg.basePath, { recursive: true })
      }
    },
  }
}
