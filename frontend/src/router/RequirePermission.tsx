import { Navigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'

interface Props {
  permission: string
  children: React.ReactNode
}

export function RequirePermission({ permission, children }: Props) {
  const { hasPermission } = useSession()
  if (!hasPermission(permission)) return <Navigate to="/" replace />
  return <>{children}</>
}
