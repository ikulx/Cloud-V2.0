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
  page: (id: string) => ['wiki', 'page', id] as const,
}

export function useWikiTree() {
  return useQuery({
    queryKey: wikiKeys.tree,
    queryFn: () => apiGet<WikiPageNode[]>('/wiki/tree'),
  })
}

export function useWikiPage(id: string | undefined) {
  return useQuery({
    queryKey: wikiKeys.page(id ?? ''),
    queryFn: () => apiGet<WikiPage>(`/wiki/pages/${id}`),
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

export function useUpdateWikiPage(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch<WikiPage>(`/wiki/pages/${id}`, data),
    onSuccess: (page) => {
      qc.setQueryData(wikiKeys.page(id), page)
      qc.invalidateQueries({ queryKey: wikiKeys.tree })
    },
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
