import { redirect } from '@remix-run/node'

import type { User } from '~/models/user.server'
import { createUser, getUserByProviderId } from '~/models/user.server'

export async function getProviderId(request: Request): Promise<User['providerId'] | undefined> {
  const providerId = request.headers.get('X-MS-CLIENT-PRINCIPAL-ID')
  return providerId ?? undefined
}

export async function getUserId(request: Request): Promise<User['id'] | undefined> {
  const user = await getUser(request)
  if (!user) throw await logout(request)

  return user?.id ?? undefined
}

export async function getUser(request: Request) {
  const providerId = await getProviderId(request)
  if (providerId === undefined) return null

  const user = await getUserByProviderId(providerId)
  if (user) return user

  const name = request.headers.get('X-MS-CLIENT-PRINCIPAL-NAME')
  if (name) createUser(providerId, name)

  throw await logout(request)
}

export async function requireUserId(
  request: Request,
  redirectTo: string = new URL(request.url).pathname
) {
  const userId = await getUserId(request)
  if (!userId) {
    const searchParams = new URLSearchParams([['redirectTo', redirectTo]])
    throw redirect(`/login?${searchParams}`)
  }
  return userId
}

export async function requireUser(request: Request) {
  const userId = await requireUserId(request)

  const user = await getUserByProviderId(userId)
  if (user) return user

  throw await logout(request)
}

export async function logout(request: Request) {
  return redirect('/.auth/logout')
}
