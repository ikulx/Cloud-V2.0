export interface AuthenticatedUser {
  userId: string
  email: string
  firstName: string
  lastName: string
  roleId: string | null
  roleName: string | null
  /** true wenn die Rolle als System-Rolle markiert ist (voller Zugriff, nicht editierbar) */
  isSystemRole: boolean
  permissions: string[]
}
