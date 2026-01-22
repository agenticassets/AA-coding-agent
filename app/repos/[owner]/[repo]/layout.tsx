import { RepoLayout } from '@/components/repo-layout'
import { getServerSession } from '@/lib/session/get-server-session'
import { getGitHubStars } from '@/lib/github-stars'
import { Metadata } from 'next'
import { Suspense } from 'react'

interface LayoutPageProps {
  params: Promise<{
    owner: string
    repo: string
  }>
  children: React.ReactNode
}

export default async function Layout({ params, children }: LayoutPageProps) {
  const { owner, repo } = await params
  return (
    <Suspense fallback={<RepoLayoutFallback />}>
      <RepoLayoutShell owner={owner} repo={repo}>
        {children}
      </RepoLayoutShell>
    </Suspense>
  )
}

async function RepoLayoutShell({ owner, repo, children }: { owner: string; repo: string; children: React.ReactNode }) {
  const [session, stars] = await Promise.all([getServerSession(), getGitHubStars()])

  return (
    <RepoLayout
      owner={owner}
      repo={repo}
      user={session?.user ?? null}
      authProvider={session?.authProvider ?? null}
      initialStars={stars}
    >
      {children}
    </RepoLayout>
  )
}

function RepoLayoutFallback() {
  return (
    <div className="flex-1 bg-background relative flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 p-3">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex-1 px-3">
        <div className="h-6 w-64 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}

export async function generateMetadata({ params }: LayoutPageProps): Promise<Metadata> {
  const { owner, repo } = await params

  return {
    title: `${owner}/${repo} - Coding Agent Platform`,
    description: 'View repository commits, issues, and pull requests',
  }
}
