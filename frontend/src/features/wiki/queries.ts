import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

export interface WikiPageNode {
  id: string
  slug: string
  title: string
  icon: string | null
  parentId: string | null
  sortOrder: number
  updatedAt: string
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
    mutationFn: (data: { title: string; icon?: string | null; parentId?: string | null; content?: unknown }) =>
      apiPost<WikiPage>('/wiki/pages', data),
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
