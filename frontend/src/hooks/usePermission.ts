import { useSession } from '../context/SessionContext'

export function usePermission(permission: string): boolean {
  const { hasPermission } = useSession()
  return hasPermission(permission)
}
