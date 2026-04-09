export interface AuthenticatedUser {
  userId: string
  email: string
  firstName: string
  lastName: string
  roleId: string | null
  roleName: string | null
  permissions: string[]
}
