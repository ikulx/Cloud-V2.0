import { prisma } from '../db/prisma'
import { AuthenticatedUser } from '../types/authenticated-user'
import { PERMISSION_CATALOG, PRIVILEGED_ROLE_NAMES } from '../lib/permission-catalog'

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
          permissions: {
            select: { permission: { select: { key: true } } },
          },
        },
      },
    },
  })

  if (!user) return null

  const permissions = getEffectivePermissions(
    user.role?.name ?? null,
    user.role?.permissions.map((rp) => rp.permission.key) ?? []
  )

  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleId: user.roleId,
    roleName: user.role?.name ?? null,
    permissions,
  }
}

export function getEffectivePermissions(
  roleName: string | null,
  assignedPermissions: string[]
): string[] {
  if (roleName && PRIVILEGED_ROLE_NAMES.includes(roleName as typeof PRIVILEGED_ROLE_NAMES[number])) {
    return [...PERMISSION_CATALOG]
  }
  return assignedPermissions
}
