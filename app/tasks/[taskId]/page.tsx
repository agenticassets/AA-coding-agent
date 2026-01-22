import { TaskPageClient } from '@/components/task-page-client'
import { getServerSession } from '@/lib/session/get-server-session'
import { getGitHubStars } from '@/lib/github-stars'
import { getMaxSandboxDuration } from '@/lib/db/settings'
import { Metadata } from 'next'
import { Suspense } from 'react'

interface TaskPageProps {
  params: Promise<{
    taskId: string
  }>
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { taskId } = await params
  return (
    <Suspense fallback={<TaskPageFallback />}>
      <TaskPageShell taskId={taskId} />
    </Suspense>
  )
}

async function TaskPageShell({ taskId }: { taskId: string }) {
  const sessionPromise = getServerSession()
  const starsPromise = getGitHubStars()
  const session = await sessionPromise

  // Get max sandbox duration for this user (user-specific > global > env var)
  const maxSandboxDurationPromise = getMaxSandboxDuration(session?.user?.id)
  const [maxSandboxDuration, stars] = await Promise.all([maxSandboxDurationPromise, starsPromise])

  return (
    <TaskPageClient
      taskId={taskId}
      user={session?.user ?? null}
      authProvider={session?.authProvider ?? null}
      initialStars={stars}
      maxSandboxDuration={maxSandboxDuration}
    />
  )
}

function TaskPageFallback() {
  return (
    <div className="flex h-full flex-1 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-r-transparent" />
    </div>
  )
}

export async function generateMetadata({ params }: TaskPageProps): Promise<Metadata> {
  const [{ taskId }, session] = await Promise.all([params, getServerSession()])

  // Try to fetch the task to get its title
  let pageTitle = `Task ${taskId}`

  if (session?.user?.id) {
    try {
      const [{ db }, { tasks }, { eq, and, isNull }] = await Promise.all([
        import('@/lib/db/client'),
        import('@/lib/db/schema'),
        import('drizzle-orm'),
      ])

      const task = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
        .limit(1)

      if (task[0]) {
        // Use title if available, otherwise use truncated prompt
        if (task[0].title) {
          pageTitle = task[0].title
        } else if (task[0].prompt) {
          // Truncate prompt to 60 characters
          pageTitle = task[0].prompt.length > 60 ? task[0].prompt.slice(0, 60) + '...' : task[0].prompt
        }
      }
    } catch {
      // If fetching fails, fall back to task ID
      console.error('Failed to fetch task metadata')
    }
  }

  return {
    title: `${pageTitle} - Coding Agent Platform`,
    description: 'View task details and execution logs',
  }
}
