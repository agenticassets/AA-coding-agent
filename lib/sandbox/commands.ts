import { Sandbox } from '@vercel/sandbox'
import { redactSensitiveInfo } from '@/lib/utils/logging'
import { TaskLogger } from '@/lib/utils/task-logger'

// Project directory where repo is cloned
export const PROJECT_DIR = '/vercel/sandbox/project'

export interface CommandResult {
  success: boolean
  exitCode?: number
  output?: string
  error?: string
  streamingLogs?: unknown[]
  command?: string
}

export interface StreamingCommandOptions {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  onJsonLine?: (jsonData: unknown) => void
}

export async function runCommandInSandbox(
  sandbox: Sandbox,
  command: string,
  args: string[] = [],
): Promise<CommandResult> {
  try {
    const result = await sandbox.runCommand(command, args)

    // Handle stdout and stderr properly
    let stdout = ''
    let stderr = ''

    try {
      stdout = await (result.stdout as () => Promise<string>)()
    } catch {
      // Failed to read stdout
    }

    try {
      stderr = await (result.stderr as () => Promise<string>)()
    } catch {
      // Failed to read stderr
    }

    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      output: stdout,
      error: stderr,
      command: fullCommand,
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Command execution failed'
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
    return {
      success: false,
      error: errorMessage,
      command: fullCommand,
    }
  }
}

// Helper function to run command in project directory
export async function runInProject(sandbox: Sandbox, command: string, args: string[] = []): Promise<CommandResult> {
  // Properly escape arguments for shell execution
  const escapeArg = (arg: string) => {
    // Escape single quotes by replacing ' with '\''
    return `'${arg.replace(/'/g, "'\\''")}'`
  }

  const fullCommand = args.length > 0 ? `${command} ${args.map(escapeArg).join(' ')}` : command
  const cdCommand = `cd ${PROJECT_DIR} && ${fullCommand}`
  return await runCommandInSandbox(sandbox, 'sh', ['-c', cdCommand])
}

/**
 * Shared utility: run a command in the project directory and log the result.
 * Replaces duplicate runAndLogCommand helpers across agent files.
 * @param cwd - Optional working directory override (defaults to PROJECT_DIR via runInProject)
 */
export async function runAndLogCommand(
  sandbox: Sandbox,
  command: string,
  args: string[],
  logger: TaskLogger,
  cwd?: string,
): Promise<CommandResult> {
  const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
  const redactedCommand = redactSensitiveInfo(fullCommand)

  await logger.command(redactedCommand)

  let result: CommandResult
  if (cwd) {
    const cdCommand = `cd ${cwd} && ${fullCommand}`
    result = await runCommandInSandbox(sandbox, 'sh', ['-c', cdCommand])
  } else {
    result = await runInProject(sandbox, command, args)
  }

  if (result && result.output && result.output.trim()) {
    const redactedOutput = redactSensitiveInfo(result.output.trim())
    await logger.info(redactedOutput)
  }

  if (result && !result.success && result.error) {
    const redactedError = redactSensitiveInfo(result.error)
    await logger.error(redactedError)
  }

  if (!result) {
    await logger.error('Command execution failed - no result returned')
    return {
      success: false,
      error: 'Command execution failed - no result returned',
      exitCode: -1,
      output: '',
      command: redactedCommand,
    }
  }

  return result
}

export async function runStreamingCommandInSandbox(
  sandbox: Sandbox,
  command: string,
  args: string[] = [],
  options: StreamingCommandOptions = {},
): Promise<CommandResult> {
  try {
    const result = await sandbox.runCommand(command, args)

    let stdout = ''
    let stderr = ''

    try {
      // stdout is always a function that returns a promise
      if (typeof result.stdout === 'function') {
        stdout = await result.stdout()
        // Process the complete output for JSON lines
        if (options.onJsonLine) {
          const lines = stdout.split('\n')
          for (const line of lines) {
            const trimmedLine = line.trim()
            if (trimmedLine) {
              try {
                const jsonData = JSON.parse(trimmedLine)
                options.onJsonLine(jsonData)
              } catch {
                // Not valid JSON, ignore
              }
            }
          }
        }
        if (options.onStdout) {
          options.onStdout(stdout)
        }
      }
    } catch {
      // Failed to read stdout
    }

    try {
      // stderr is always a function that returns a promise
      if (typeof result.stderr === 'function') {
        stderr = await result.stderr()
        if (options.onStderr) {
          options.onStderr(stderr)
        }
      }
    } catch {
      // Failed to read stderr
    }

    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      output: stdout,
      error: stderr,
      command: fullCommand,
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to run streaming command in sandbox'
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
    return {
      success: false,
      error: errorMessage,
      command: fullCommand,
    }
  }
}
