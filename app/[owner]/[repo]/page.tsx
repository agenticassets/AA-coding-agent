import { cookies } from 'next/headers'
import { HomePageContent } from '@/components/home-page-content'
import { getServerSession } from '@/lib/session/get-server-session'
import { getGitHubStars } from '@/lib/github-stars'
import { getMaxSandboxDuration } from '@/lib/db/settings'
import { Suspense } from 'react'

interface OwnerRepoPageProps {
  params: Promise<{
    owner: string
    repo: string
  }>
}

export default function OwnerRepoPage({ params }: OwnerRepoPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading repository workspace...</p>
        </div>
      }
    >
      <OwnerRepoPageContent params={params} />
    </Suspense>
  )
}

async function OwnerRepoPageContent({ params }: OwnerRepoPageProps) {
  const { owner, repo } = await params

  const cookieStore = await cookies()
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
      initialSelectedOwner={owner}
      initialSelectedRepo={repo}
      initialInstallDependencies={installDependencies}
      initialMaxDuration={maxDuration}
      initialKeepAlive={keepAlive}
      maxSandboxDuration={maxSandboxDuration}
      user={session?.user ?? null}
      initialStars={stars}
    />
  )
}
