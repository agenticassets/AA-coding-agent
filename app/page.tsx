import { cookies } from 'next/headers'
import { HomePageContent } from '@/components/home-page-content'
import { getServerSession } from '@/lib/session/get-server-session'
import { getGitHubStars } from '@/lib/github-stars'
import { getMaxSandboxDuration } from '@/lib/db/settings'
import { Suspense } from 'react'

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading workspace...</p>
        </div>
      }
    >
      <HomePageContentLoader />
    </Suspense>
  )
}

async function HomePageContentLoader() {
  const cookieStore = await cookies()
  const selectedOwner = cookieStore.get('selected-owner')?.value || ''
  const selectedRepo = cookieStore.get('selected-repo')?.value || ''
  const installDependencies = cookieStore.get('install-dependencies')?.value === 'true'
  const keepAlive = cookieStore.get('keep-alive')?.value === 'true'

  // Start independent work early to avoid waterfalls.
  const sessionPromise = getServerSession()
  const starsPromise = getGitHubStars()
  const session = await sessionPromise

  // Get max sandbox duration for this user (user-specific > global > env var)
  const maxSandboxDurationPromise = getMaxSandboxDuration(session?.user?.id)
  const [maxSandboxDuration, stars] = await Promise.all([maxSandboxDurationPromise, starsPromise])
  const maxDuration = parseInt(cookieStore.get('max-duration')?.value || maxSandboxDuration.toString(), 10)

  return (
    <HomePageContent
      initialSelectedOwner={selectedOwner}
      initialSelectedRepo={selectedRepo}
      initialInstallDependencies={installDependencies}
      initialMaxDuration={maxDuration}
      initialKeepAlive={keepAlive}
      maxSandboxDuration={maxSandboxDuration}
      user={session?.user ?? null}
      initialStars={stars}
    />
  )
}
