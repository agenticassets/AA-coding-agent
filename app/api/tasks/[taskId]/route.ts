import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { createTaskLogger } from '@/lib/utils/task-logger'
import { killSandbox, stopSandboxFromDB } from '@/lib/sandbox/sandbox-registry'
import { getAuthFromRequest } from '@/lib/auth/api-token'

interface RouteParams {
  params: Promise<{
    taskId: string
  }>
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

async function getAuthenticatedUser(request: NextRequest) {
  const user = await getAuthFromRequest(request)
  if (!user?.id) return null
  return user
}

async function getUserTask(taskId: string, userId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1)
  return task || null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const [user, { taskId }] = await Promise.all([getAuthenticatedUser(request), params])
    if (!user) return jsonError('Unauthorized', 401)

    const task = await getUserTask(taskId, user.id)

    if (!task) return jsonError('Task not found', 404)

    return NextResponse.json({ task })
  } catch (error) {
    console.error('Error fetching task')
    return jsonError('Failed to fetch task', 500)
  }
}

async function stopTaskExecution(taskId: string, userId: string) {
  const logger = createTaskLogger(taskId)

  try {
    await logger.info('Stop request received - terminating task execution...')

    const [updatedTask] = await db
      .update(tasks)
      .set({
        status: 'stopped',
        error: 'Task was stopped by user',
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))
      .returning()

    await terminateSandbox(taskId, logger)
    await logger.error('Task execution stopped by user')

    return { success: true, task: updatedTask }
  } catch (error) {
    console.error('Error stopping task')
    await logger.error('Failed to stop task properly')
    return { success: false }
  }
}

async function terminateSandbox(taskId: string, logger: ReturnType<typeof createTaskLogger>) {
  try {
    const dbStopResult = await stopSandboxFromDB(taskId)
    if (dbStopResult.success) {
      await logger.success('Sandbox terminated successfully')
      return
    }

    const killResult = await killSandbox(taskId)
    if (killResult.success) {
      await logger.success('Sandbox terminated successfully')
    } else {
      await logger.error('Failed to terminate sandbox')
    }
  } catch (killError) {
    console.error('Failed to kill sandbox during stop')
    await logger.error('Failed to terminate sandbox')
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const [user, { taskId }] = await Promise.all([getAuthenticatedUser(request), params])
    if (!user) return jsonError('Unauthorized', 401)

    const existingTask = await getUserTask(taskId, user.id)
    if (!existingTask) return jsonError('Task not found', 404)

    const body = await request.json()
    if (body.action !== 'stop') return jsonError('Invalid action', 400)

    if (existingTask.status !== 'processing') {
      return jsonError('Task can only be stopped when it is in progress', 400)
    }

    const result = await stopTaskExecution(taskId, user.id)

    if (!result.success) return jsonError('Failed to stop task', 500)

    return NextResponse.json({
      message: 'Task stopped successfully',
      task: result.task,
    })
  } catch (error) {
    console.error('Error updating task')
    return jsonError('Failed to update task', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const [user, { taskId }] = await Promise.all([getAuthenticatedUser(request), params])
    if (!user) return jsonError('Unauthorized', 401)

    const existingTask = await getUserTask(taskId, user.id)
    if (!existingTask) return jsonError('Task not found', 404)

    await db
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, user.id)))

    return NextResponse.json({ message: 'Task deleted successfully' })
  } catch (error) {
    console.error('Error deleting task')
    return jsonError('Failed to delete task', 500)
  }
}
