import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api'
import type { MyTodo } from '../../types/model'

export type MyTodoScope = 'mine' | 'groups' | 'all'
export type MyTodoStatus = 'OPEN' | 'DONE'

export function useMyTodos(scope: MyTodoScope = 'all', status: MyTodoStatus = 'OPEN') {
  return useQuery({
    queryKey: ['me', 'todos', scope, status] as const,
    queryFn: () => apiGet<MyTodo[]>(`/me/todos?scope=${scope}&status=${status}`),
  })
}
