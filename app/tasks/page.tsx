import { getServerSession } from '@/lib/session/get-server-session'
import { getGitHubStars } from '@/lib/github-stars'
import { TasksListClient } from '@/components/tasks-list-client'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export default function TasksListPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading tasks...</p>
        </div>
      }
    >
      <TasksListPageContent />
    </Suspense>
  )
}

async function TasksListPageContent() {
  // Fetch session and stars in parallel for better performance
  const sessionPromise = getServerSession()
  const starsPromise = getGitHubStars()
  const session = await sessionPromise

  // Redirect to home if not authenticated
  if (!session?.user) {
    redirect('/')
  }

  const stars = await starsPromise

  return <TasksListClient user={session.user} authProvider={session.authProvider} initialStars={stars} />
}
