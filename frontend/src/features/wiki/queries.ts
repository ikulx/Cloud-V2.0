import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from '../../lib/api'

export type WikiNodeType = 'FOLDER' | 'PAGE'
export type WikiAccessLevel = 'VIEW' | 'EDIT'
export type WikiAccessTarget = 'ROLE' | 'GROUP' | 'USER'

export interface WikiPageNode {
  id: string
  slug: string
  title: string
  icon: string | null
  parentId: string | null
  sortOrder: number
  updatedAt: string
  type: WikiNodeType
  canEdit: boolean
  canView: boolean
}

export interface WikiPermissionEntry {
  targetType: WikiAccessTarget
  targetId: string
  level: WikiAccessLevel
}

export interface WikiAuthor {
  id: string
  firstName: string
  lastName: string
  email: string
}

export interface WikiPage extends WikiPageNode {
  content: unknown // TipTap-JSON
  createdAt: string
  createdBy: WikiAuthor
  updatedBy: WikiAuthor
  sourceLang: string
  activeLang: string
  availableLangs: string[]
  translation: { isEdited: boolean } | null
  translatable: boolean
  autoTargets: string[]
}

export function useWikiPermissions(pageId: string | null) {
  return useQuery({
    queryKey: ['wiki', 'permissions', pageId ?? ''] as const,
    queryFn: () => apiGet<WikiPermissionEntry[]>(`/wiki/pages/${pageId}/permissions`),
    enabled: Boolean(pageId),
  })
}

export function useSaveWikiPermissions(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (entries: WikiPermissionEntry[]) => {
      const res = await apiFetch(`/wiki/pages/${pageId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ entries }),
      })
      if (!res.ok) {
        let msg = 'Fehler beim Speichern'
        try { const err = await res.json(); msg = err.message ?? msg } catch { /* noop */ }
        throw new Error(msg)
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'permissions', pageId] })
      qc.invalidateQueries({ queryKey: wikiKeys.tree })
    },
  })
}

export const wikiKeys = {
  tree: ['wiki', 'tree'] as const,
  page: (id: string, lang?: string | null) =>
    ['wiki', 'page', id, lang ?? ''] as const,
}

export function useWikiTree() {
  return useQuery({
    queryKey: wikiKeys.tree,
    queryFn: () => apiGet<WikiPageNode[]>('/wiki/tree'),
  })
}

export function useWikiPage(id: string | undefined, lang?: string | null) {
  return useQuery({
    queryKey: wikiKeys.page(id ?? '', lang),
    queryFn: () => apiGet<WikiPage>(
      `/wiki/pages/${id}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`,
    ),
    enabled: Boolean(id),
  })
}

export function useCreateWikiPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      title: string
      icon?: string | null
      parentId?: string | null
      content?: unknown
      type?: WikiNodeType
    }) => apiPost<WikiPage>('/wiki/pages', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wikiKeys.tree })
    },
  })
}

export function useUpdateWikiPage(id: string, lang?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiPatch<WikiPage>(`/wiki/pages/${id}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`, data),
    onSuccess: () => {
      // Beim Source-Save auch alle anderen Sprach-Caches invalidieren
      // (Übersetzungen werden im Hintergrund neu berechnet).
      qc.invalidateQueries({ queryKey: ['wiki', 'page', id] })
      qc.invalidateQueries({ queryKey: wikiKeys.tree })
    },
  })
}

export function useRetranslateWikiPage(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lang: string) => {
      const res = await apiFetch(`/wiki/pages/${id}/retranslate?lang=${encodeURIComponent(lang)}`, {
        method: 'POST',
      })
      if (!res.ok) {
        let msg = 'Neu-Übersetzung fehlgeschlagen'
        try { const err = await res.json() as { message?: string }; msg = err.message ?? msg } catch { /* noop */ }
        throw new Error(msg)
      }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki', 'page', id] }),
  })
}

export function useDeleteWikiPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/wiki/pages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.tree }),
  })
}

export function useDuplicateWikiPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<WikiPage>(`/wiki/pages/${id}/duplicate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: wikiKeys.tree }),
  })
}

export interface WikiSearchHit {
  id: string
  slug: string
  title: string
  icon: string | null
  parentId: string | null
  excerpt: string
}

export function useWikiSearch(q: string) {
  return useQuery({
    queryKey: ['wiki', 'search', q] as const,
    queryFn: () => apiGet<WikiSearchHit[]>(`/wiki/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  })
}
