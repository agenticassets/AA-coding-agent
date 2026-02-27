import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/session/get-server-session'
import { db } from '@/lib/db/client'
import { taskMessages, tasks } from '@/lib/db/schema'
import { eq, and, asc, isNull } from 'drizzle-orm'

function withServerTiming(response: NextResponse, startTime: number) {
  response.headers.set('Server-Timing', `total;dur=${(performance.now() - startTime).toFixed(2)}`)
  return response
}

export async function GET(req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  const requestStart = performance.now()

  try {
    const [session, { taskId }] = await Promise.all([getServerSession(), context.params])

    if (!session?.user?.id) {
      return withServerTiming(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), requestStart)
    }

    // First, verify that the task belongs to the user
    const task = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
      .limit(1)

    if (!task.length) {
      return withServerTiming(NextResponse.json({ error: 'Task not found' }, { status: 404 }), requestStart)
    }

    // Fetch all messages for this task, ordered by creation time
    const messages = await db
      .select()
      .from(taskMessages)
      .where(eq(taskMessages.taskId, taskId))
      .orderBy(asc(taskMessages.createdAt))

    return withServerTiming(
      NextResponse.json({
        success: true,
        messages,
      }),
      requestStart,
    )
  } catch {
    console.error('Error fetching task messages:')
    return withServerTiming(NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 }), requestStart)
  }
}
