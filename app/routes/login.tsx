import type { LoaderArgs, MetaFunction } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import { getProviderId } from '~/session.server'

export async function loader({ request }: LoaderArgs) {
  const userId = await getProviderId(request)
  if (userId) return redirect('/')
  return json({})
}

export const meta: MetaFunction = () => {
  return {
    title: 'Login',
  }
}

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-8">
        <a href="/.auth/login/google">Log in with Google</a>
      </div>
    </div>
  )
}
