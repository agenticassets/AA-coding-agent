/**
 * Internal Task Execution Endpoint
 *
 * This endpoint triggers task execution using userId-based authentication
 * instead of session context. Used by MCP tools and external API calls.
 *
 * Authentication: Internal API secret OR Bearer token with userId in body
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { Sandbox } from '@vercel/sandbox'
import { db } from '@/lib/db/client'
import { tasks, connectors, taskMessages } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import { createSandbox } from '@/lib/sandbox/creation'
import { executeAgentInSandbox, AgentType } from '@/lib/sandbox/agents'
import { pushChangesToBranch, shutdownSandbox } from '@/lib/sandbox/git'
import { detectPortFromRepo } from '@/lib/sandbox/port-detection'
import { eq, and } from 'drizzle-orm'
import { createTaskLogger } from '@/lib/utils/task-logger'
import { generateBranchName, createFallbackBranchName } from '@/lib/utils/branch-name-generator'
import { generateTaskTitle, createFallbackTitle } from '@/lib/utils/title-generator'
import { generateCommitMessage, createFallbackCommitMessage } from '@/lib/utils/commit-message-generator'
import { decrypt } from '@/lib/crypto'
import { getApiKeysByUserId, getGitHubTokenByUserId } from '@/lib/api-keys/user-keys'
import { getMaxSandboxDuration } from '@/lib/db/settings'

// Verify that this is a legitimate internal call
function verifyInternalCall(request: NextRequest): boolean {
  // Check for internal secret header (for server-to-server calls)
  const internalSecret = request.headers.get('X-Internal-Secret')
  if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    return true
  }
  return false
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params

    // Parse request body
    const body = await request.json()
    const { userId } = body

    // Verify this is a legitimate internal call
    // Either via internal secret OR if the request comes from our own server
    const isInternal = verifyInternalCall(request)

    // For now, we also accept requests with valid userId (for MCP which doesn't have internal secret)
    // The MCP handler already verified the user via Bearer token
    if (!isInternal && !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch the task
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Verify user owns this task
    if (userId && task.userId !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if task is already processing or completed
    if (task.status !== 'pending') {
      return NextResponse.json(
        { error: 'Task is already being processed or completed', status: task.status },
        { status: 400 },
      )
    }

    // Fetch user's API keys and GitHub token using userId (no session required)
    const userApiKeys = await getApiKeysByUserId(task.userId)
    const userGithubToken = await getGitHubTokenByUserId(task.userId)

    // Get max sandbox duration for this user
    const maxSandboxDuration = await getMaxSandboxDuration(task.userId)

    // Trigger async execution using after()
    after(async () => {
      try {
        // Generate AI branch name
        if (process.env.AI_GATEWAY_API_KEY) {
          try {
            const logger = createTaskLogger(taskId)
            await logger.info('Generating AI-powered branch name...')

            let repoName: string | undefined
            try {
              const url = new URL(task.repoUrl || '')
              const pathParts = url.pathname.split('/')
              if (pathParts.length >= 3) {
                repoName = pathParts[pathParts.length - 1].replace(/\.git$/, '')
              }
            } catch {
              // Ignore URL parsing errors
            }

            const aiBranchName = await generateBranchName({
              description: task.prompt,
              repoName,
              context: `${task.selectedAgent} agent task`,
            })

            await db
              .update(tasks)
              .set({
                branchName: aiBranchName,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, taskId))

            await logger.success('Generated AI branch name')
          } catch {
            // Fallback to timestamp-based branch name
            const fallbackBranchName = createFallbackBranchName(taskId)
            await db
              .update(tasks)
              .set({
                branchName: fallbackBranchName,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, taskId))
          }
        }

        // Generate AI title
        if (process.env.AI_GATEWAY_API_KEY) {
          try {
            let repoName: string | undefined
            try {
              const url = new URL(task.repoUrl || '')
              const pathParts = url.pathname.split('/')
              if (pathParts.length >= 3) {
                repoName = pathParts[pathParts.length - 1].replace(/\.git$/, '')
              }
            } catch {
              // Ignore URL parsing errors
            }

            const aiTitle = await generateTaskTitle({
              prompt: task.prompt,
              repoName,
              context: `${task.selectedAgent} agent task`,
            })

            await db
              .update(tasks)
              .set({
                title: aiTitle,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, taskId))
          } catch {
            const fallbackTitle = createFallbackTitle(task.prompt)
            await db
              .update(tasks)
              .set({
                title: fallbackTitle,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, taskId))
          }
        }

        // Process the task
        await processTaskWithTimeout(
          taskId,
          task.prompt,
          task.repoUrl || '',
          task.maxDuration || maxSandboxDuration,
          task.selectedAgent || 'claude',
          task.selectedModel || undefined,
          task.installDependencies || false,
          task.keepAlive || false,
          {
            OPENAI_API_KEY: userApiKeys.OPENAI_API_KEY,
            GEMINI_API_KEY: userApiKeys.GEMINI_API_KEY,
            CURSOR_API_KEY: userApiKeys.CURSOR_API_KEY,
            ANTHROPIC_API_KEY: userApiKeys.ANTHROPIC_API_KEY,
            AI_GATEWAY_API_KEY: userApiKeys.AI_GATEWAY_API_KEY,
          },
          userGithubToken,
          task.userId,
        )
      } catch (error) {
        console.error('Task execution failed')
      }
    })

    return NextResponse.json({
      success: true,
      taskId,
      message: 'Task execution started',
    })
  } catch (error) {
    console.error('Error starting task execution')
    return NextResponse.json({ error: 'Failed to start task execution' }, { status: 500 })
  }
}

async function processTaskWithTimeout(
  taskId: string,
  prompt: string,
  repoUrl: string,
  maxDuration: number,
  selectedAgent: string = 'claude',
  selectedModel?: string,
  installDependencies: boolean = false,
  keepAlive: boolean = false,
  apiKeys?: {
    OPENAI_API_KEY?: string
    GEMINI_API_KEY?: string
    CURSOR_API_KEY?: string
    ANTHROPIC_API_KEY?: string
    AI_GATEWAY_API_KEY?: string
  },
  githubToken?: string | null,
  userId?: string,
) {
  const TASK_TIMEOUT_MS = maxDuration * 60 * 1000

  const warningTimeMs = Math.max(TASK_TIMEOUT_MS - 60 * 1000, 0)
  const warningTimeout = setTimeout(async () => {
    try {
      const warningLogger = createTaskLogger(taskId)
      await warningLogger.info('Task is approaching timeout, will complete soon')
    } catch {
      // Ignore errors
    }
  }, warningTimeMs)

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Task execution timed out after ${maxDuration} minutes`))
    }, TASK_TIMEOUT_MS)
  })

  try {
    await Promise.race([
      processTask(
        taskId,
        prompt,
        repoUrl,
        maxDuration,
        selectedAgent,
        selectedModel,
        installDependencies,
        keepAlive,
        apiKeys,
        githubToken,
        userId,
      ),
      timeoutPromise,
    ])

    clearTimeout(warningTimeout)
  } catch (error: unknown) {
    clearTimeout(warningTimeout)
    if (error instanceof Error && error.message?.includes('timed out after')) {
      const timeoutLogger = createTaskLogger(taskId)
      await timeoutLogger.error('Task execution timed out')
      await timeoutLogger.updateStatus('error', 'Task execution timed out. The operation took too long to complete.')
    } else {
      throw error
    }
  }
}

// Helper function to check if task was stopped
async function isTaskStopped(taskId: string): Promise<boolean> {
  try {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    return task?.status === 'stopped'
  } catch {
    return false
  }
}

// Helper function to wait for AI-generated branch name
async function waitForBranchName(taskId: string, maxWaitMs: number = 10000): Promise<string | null> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
      if (task?.branchName) {
        return task.branchName
      }
    } catch {
      // Ignore errors
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return null
}

async function processTask(
  taskId: string,
  prompt: string,
  repoUrl: string,
  maxDuration: number,
  selectedAgent: string = 'claude',
  selectedModel?: string,
  installDependencies: boolean = false,
  keepAlive: boolean = false,
  apiKeys?: {
    OPENAI_API_KEY?: string
    GEMINI_API_KEY?: string
    CURSOR_API_KEY?: string
    ANTHROPIC_API_KEY?: string
    AI_GATEWAY_API_KEY?: string
  },
  githubToken?: string | null,
  userId?: string,
) {
  let sandbox: Sandbox | null = null
  const logger = createTaskLogger(taskId)

  try {
    await logger.updateStatus('processing', 'Task created, preparing to start...')
    await logger.updateProgress(10, 'Initializing task execution...')

    // Save the user's message
    try {
      await db.insert(taskMessages).values({
        id: generateId(12),
        taskId,
        role: 'user',
        content: prompt,
      })
    } catch {
      // Ignore errors
    }

    if (githubToken) {
      await logger.info('Using authenticated GitHub access')
    } else if (repoUrl) {
      await logger.info('No GitHub token available, attempting unauthenticated access')
    } else {
      await logger.info('Running in standalone mode (no repository)')
    }
    await logger.info('API keys configured for selected agent')

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped before execution began')
      return
    }

    const aiBranchName = await waitForBranchName(taskId, 10000)

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped during branch name generation')
      return
    }

    if (aiBranchName) {
      await logger.info('Using AI-generated branch name')
    } else {
      await logger.info('AI branch name not ready, will use fallback during sandbox creation')
    }

    await logger.updateProgress(15, 'Creating sandbox environment')

    // Detect the appropriate port for the project
    const port = repoUrl ? await detectPortFromRepo(repoUrl, githubToken) : 3000

    // Create sandbox
    const sandboxResult = await createSandbox(
      {
        taskId,
        repoUrl,
        githubToken,
        gitAuthorName: 'Coding Agent',
        gitAuthorEmail: 'agent@example.com',
        apiKeys,
        timeout: `${maxDuration}m`,
        ports: [port],
        runtime: 'node22',
        resources: { vcpus: 4 },
        taskPrompt: prompt,
        selectedAgent,
        selectedModel,
        installDependencies,
        keepAlive,
        preDeterminedBranchName: aiBranchName || undefined,
        onProgress: async (progress: number, message: string) => {
          await logger.updateProgress(progress, message)
        },
        onCancellationCheck: async () => {
          return await isTaskStopped(taskId)
        },
      },
      logger,
    )

    if (!sandboxResult.success) {
      if (sandboxResult.cancelled) {
        await logger.info('Task was cancelled during sandbox creation')
        return
      }
      throw new Error(sandboxResult.error || 'Failed to create sandbox')
    }

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped during sandbox creation')
      if (sandboxResult.sandbox) {
        try {
          await shutdownSandbox(sandboxResult.sandbox)
        } catch {
          // Ignore cleanup errors
        }
      }
      return
    }

    const { sandbox: createdSandbox, domain, branchName } = sandboxResult
    sandbox = createdSandbox || null

    const updateData: { sandboxUrl?: string; sandboxId?: string; updatedAt: Date; branchName?: string } = {
      sandboxId: sandbox?.sandboxId || undefined,
      sandboxUrl: domain || undefined,
      updatedAt: new Date(),
    }

    if (!aiBranchName) {
      updateData.branchName = branchName
    }

    await db.update(tasks).set(updateData).where(eq(tasks.id, taskId))

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped before agent execution')
      return
    }

    await logger.updateProgress(50, 'Installing and executing agent')

    if (!sandbox) {
      throw new Error('Sandbox is not available for agent execution')
    }

    type Connector = typeof connectors.$inferSelect
    let mcpServers: Connector[] = []

    if (userId) {
      try {
        const userConnectors = await db
          .select()
          .from(connectors)
          .where(and(eq(connectors.userId, userId), eq(connectors.status, 'connected')))

        mcpServers = userConnectors.map((connector: Connector) => {
          const decryptedEnv = connector.env ? JSON.parse(decrypt(connector.env)) : null
          return {
            ...connector,
            env: decryptedEnv,
            oauthClientSecret: connector.oauthClientSecret ? decrypt(connector.oauthClientSecret) : null,
          }
        })

        if (mcpServers.length > 0) {
          await logger.info('Found connected MCP servers')
          await db
            .update(tasks)
            .set({
              mcpServerIds: JSON.parse(JSON.stringify(mcpServers.map((s) => s.id))),
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, taskId))
        }
      } catch {
        await logger.info('Warning: Could not fetch MCP servers, continuing without them')
      }
    }

    const sanitizedPrompt = prompt.replace(/`/g, "'").replace(/\$/g, '').replace(/\\/g, '').replace(/^-/gm, ' -')

    const agentMessageId = generateId()

    const agentResult = await executeAgentInSandbox(
      sandbox,
      sanitizedPrompt,
      selectedAgent as AgentType,
      logger,
      selectedModel,
      mcpServers,
      undefined,
      apiKeys,
      undefined,
      undefined,
      taskId,
      agentMessageId,
    )

    if (!agentResult.success) {
      if (await isTaskStopped(taskId)) {
        await logger.info('Agent execution was stopped')
        return
      }
      throw new Error(agentResult.error || 'Agent execution failed')
    }

    await logger.success('Agent completed work')
    await logger.updateProgress(90, 'Committing and pushing changes')

    // Get the final branch name
    const [currentTask] = await db.select().from(tasks).where(eq(tasks.id, taskId))
    const finalBranchName = currentTask?.branchName || branchName || `ai-agent-${taskId}`

    // Push changes if we have a repo
    if (repoUrl && githubToken) {
      const commitDescription = agentResult.agentResponse || agentResult.output || prompt

      let commitMessage: string
      try {
        commitMessage = await generateCommitMessage({
          description: commitDescription,
          context: `${selectedAgent} agent task`,
        })
      } catch {
        commitMessage = createFallbackCommitMessage(commitDescription)
      }

      const pushResult = await pushChangesToBranch(sandbox, finalBranchName, commitMessage, logger)

      if (pushResult.success && !pushResult.pushFailed) {
        await logger.success('Changes pushed to branch')
      } else if (pushResult.pushFailed) {
        await logger.info('Changes committed locally but could not be pushed to remote')
      }
    }

    await logger.updateProgress(100, 'Task completed')
    await logger.updateStatus('completed', 'Task completed successfully')

    // Shutdown sandbox if not keepAlive
    if (!keepAlive && sandbox) {
      await logger.info('Shutting down sandbox')
      try {
        await shutdownSandbox(sandbox)
      } catch {
        // Ignore shutdown errors
      }
    }
  } catch (error) {
    await logger.error('Task failed')
    await logger.updateStatus('error', error instanceof Error ? error.message : 'An unexpected error occurred')

    if (sandbox) {
      try {
        await shutdownSandbox(sandbox)
      } catch {
        // Ignore shutdown errors
      }
    }
  }
}
