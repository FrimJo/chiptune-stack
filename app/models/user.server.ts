import type { User } from '@prisma/client'

import { prisma } from '~/db.server'

export type { User } from '@prisma/client'

export async function getUserByProviderId(providerId: User['providerId']) {
  return prisma.user.findUnique({ where: { providerId } })
}

export async function getUserById(id: User['id']) {
  return prisma.user.findUnique({ where: { id } })
}

export async function createUser(providerId: User['providerId'], name: User['name']) {
  return prisma.user.create({
    data: {
      providerId,
      name,
    },
  })
}

export async function deleteUserByProviderId(providerId: User['providerId']) {
  return prisma.user.delete({ where: { providerId } })
}
