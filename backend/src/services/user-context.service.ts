import { prisma } from '../db/prisma'
import { AuthenticatedUser } from '../types/authenticated-user'
import { PERMISSION_CATALOG } from '../lib/permission-catalog'

export async function getUserAccessContext(userId: string): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      roleId: true,
      role: {
        select: {
          name: true,
          isSystem: true,
          permissions: {
            select: { permission: { select: { key: true } } },
          },
        },
      },
    },
  })

  if (!user) return null

  const isSystemRole = user.role?.isSystem === true
  const permissions = isSystemRole
    ? [...PERMISSION_CATALOG]
    : user.role?.permissions.map((rp) => rp.permission.key) ?? []

  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleId: user.roleId,
    roleName: user.role?.name ?? null,
    isSystemRole,
    permissions,
  }
}

/** Legacy-Export für bestehende Aufrufer (z.B. Routes). */
export function getEffectivePermissions(
  roleName: string | null,
  assignedPermissions: string[]
): string[] {
  // Erhält die alte Signatur für Kompatibilität.
  // Die echte Prüfung läuft jetzt über isSystemRole im UserContext.
  if (roleName === 'admin') return [...PERMISSION_CATALOG]
  return assignedPermissions
}
