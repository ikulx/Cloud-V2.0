import { Prisma } from '@prisma/client'
import { AuthenticatedUser } from '../types/authenticated-user'

export function buildVisibleDevicesWhere(user: AuthenticatedUser): Prisma.DeviceWhereInput {
  if (user.permissions.includes('devices:view_all')) {
    return {}
  }
  return {
    OR: [
      { directUsers: { some: { userId: user.userId } } },
      {
        directGroups: {
          some: { group: { members: { some: { userId: user.userId } } } },
        },
      },
      {
        anlageDevices: {
          some: {
            anlage: {
              OR: [
                { directUsers: { some: { userId: user.userId } } },
                {
                  groupAnlagen: {
                    some: { group: { members: { some: { userId: user.userId } } } },
                  },
                },
              ],
            },
          },
        },
      },
    ],
  }
}

export function buildVisibleAnlagenWhere(user: AuthenticatedUser): Prisma.AnlageWhereInput {
  if (user.permissions.includes('devices:view_all')) {
    return {}
  }
  return {
    OR: [
      { directUsers: { some: { userId: user.userId } } },
      {
        groupAnlagen: {
          some: { group: { members: { some: { userId: user.userId } } } },
        },
      },
    ],
  }
}
