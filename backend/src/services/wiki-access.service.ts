import { prisma } from '../db/prisma'

export type AccessLevel = 'VIEW' | 'EDIT'

export interface WikiUserCtx {
  userId: string
  roleId: string | null
  roleName: string | null
  isSystemRole: boolean
  groupIds: string[]
  /** Flat global permissions (e.g. 'wiki:read', 'wiki:update') – bereits aufgelöst. */
  permissions: string[]
}

/** Holt User + Rolle + Gruppen + aufgelöste Global-Permissions in einem Schritt. */
export async function loadWikiUserCtx(userId: string): Promise<WikiUserCtx | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    include: {
      role: {
        select: {
          id: true,
          name: true,
          isSystem: true,
          permissions: { include: { permission: { select: { key: true } } } },
        },
      },
      groupMemberships: { select: { groupId: true } },
    },
  })
  if (!user) return null
  return {
    userId: user.id,
    roleId: user.role?.id ?? null,
    roleName: user.role?.name ?? null,
    isSystemRole: user.role?.isSystem === true,
    groupIds: user.groupMemberships.map((g) => g.groupId),
    permissions: user.role?.permissions.map((rp) => rp.permission.key) ?? [],
  }
}

interface PageNode {
  id: string
  parentId: string | null
}

interface PermissionRow {
  pageId: string
  targetType: 'ROLE' | 'GROUP' | 'USER'
  targetId: string
  level: 'VIEW' | 'EDIT'
}

/** Baut eine Map pageId → { view, edit } für den gegebenen User.
 *
 *  Semantik: Für jede Seite gehen wir die Eltern-Kette hoch. Der erste
 *  Vorfahre (inkl. der Seite selbst), der eigene Permission-Einträge hat,
 *  bestimmt das Ergebnis: Matcht ein Eintrag den User → erlaubt, sonst →
 *  verboten. Hat kein Knoten in der Kette Einträge, fallen wir auf die
 *  globalen wiki:*-Permissions zurück.
 *  Admin / System-Rolle haben immer Vollzugriff.
 */
export async function buildWikiAccessMap(ctx: WikiUserCtx): Promise<Map<string, { view: boolean; edit: boolean }>> {
  const pages: PageNode[] = await prisma.wikiPage.findMany({
    select: { id: true, parentId: true },
  })
  const grants: PermissionRow[] = await prisma.wikiPagePermission.findMany({
    select: { pageId: true, targetType: true, targetId: true, level: true },
  })

  const parentOf = new Map<string, string | null>()
  for (const p of pages) parentOf.set(p.id, p.parentId)

  const grantsByPage = new Map<string, PermissionRow[]>()
  for (const g of grants) {
    let arr = grantsByPage.get(g.pageId)
    if (!arr) { arr = []; grantsByPage.set(g.pageId, arr) }
    arr.push(g)
  }

  const globalView = ctx.isSystemRole || ctx.permissions.includes('wiki:read')
  const globalEdit = ctx.isSystemRole || ctx.permissions.includes('wiki:update')

  const matches = (g: PermissionRow): boolean => {
    if (g.targetType === 'USER')  return g.targetId === ctx.userId
    if (g.targetType === 'ROLE')  return !!ctx.roleId && g.targetId === ctx.roleId
    if (g.targetType === 'GROUP') return ctx.groupIds.includes(g.targetId)
    return false
  }

  const cache = new Map<string, { view: boolean; edit: boolean }>()

  const resolve = (pageId: string): { view: boolean; edit: boolean } => {
    const cached = cache.get(pageId)
    if (cached) return cached

    if (ctx.isSystemRole) {
      const res = { view: true, edit: true }
      cache.set(pageId, res)
      return res
    }

    // Walk up to find first ancestor with its own grants
    let cursor: string | null = pageId
    const visited = new Set<string>()
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor)
      const g = grantsByPage.get(cursor)
      if (g && g.length > 0) {
        let view = false
        let edit = false
        for (const row of g) {
          if (!matches(row)) continue
          view = true
          if (row.level === 'EDIT') edit = true
        }
        const res = { view, edit }
        cache.set(pageId, res)
        return res
      }
      cursor = parentOf.get(cursor) ?? null
    }

    // No grants anywhere in chain → global permissions
    const res = { view: globalView, edit: globalEdit }
    cache.set(pageId, res)
    return res
  }

  for (const p of pages) resolve(p.id)
  return cache
}

/** Single-Page Access-Check – für einzelne PATCH/DELETE/GET-Pfade effizient. */
export async function canAccessPage(ctx: WikiUserCtx, pageId: string, need: AccessLevel): Promise<boolean> {
  const map = await buildWikiAccessMap(ctx)
  const entry = map.get(pageId)
  if (!entry) return false
  return need === 'EDIT' ? entry.edit : entry.view
}
