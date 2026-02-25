import { Octokit } from '@octokit/rest'
import { getUserGitHubToken } from './user-token'

type GitHubErrorResult = { success: false; error: string }

function createErrorResult(error: string): GitHubErrorResult {
  return { success: false, error }
}

function getErrorMessageFromStatus(status: number, context: string): string {
  const messages: Record<number, string> = {
    403: 'Permission denied. Check repository access',
    404: context === 'pr' ? 'Pull request not found' : 'Repository not found or no access',
    405: 'Pull request is not mergeable',
    409: 'Merge conflict - cannot auto-merge',
    422: 'Pull request already exists or branch does not exist',
  }
  return messages[status] || `Failed to ${context}`
}

function handleGitHubError(error: unknown, context: string): GitHubErrorResult {
  console.error(`Error ${context}`)

  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    const message = getErrorMessageFromStatus(status, context)
    return createErrorResult(message)
  }

  return createErrorResult(`Failed to ${context}`)
}

/**
 * Create an Octokit instance for the currently authenticated user
 * Returns an Octokit instance with the user's GitHub token if connected, otherwise without authentication
 * Calling code should check octokit.auth to verify user has connected GitHub
 *
 * @param userId - Optional userId for API token authentication (bypasses session lookup)
 */
export async function getOctokit(userId?: string): Promise<Octokit> {
  const userToken = await getUserGitHubToken(userId)

  if (!userToken) {
    console.warn('No user GitHub token available')
  }

  return new Octokit({
    auth: userToken || undefined,
  })
}

/**
 * Get the authenticated GitHub user's information
 * Returns null if no GitHub account is connected
 *
 * @param userId - Optional userId for API token authentication (bypasses session lookup)
 */
export async function getGitHubUser(userId?: string): Promise<{
  username: string
  name: string | null
  email: string | null
} | null> {
  try {
    const octokit = await getOctokit(userId)

    if (!octokit.auth) {
      return null
    }

    const { data } = await octokit.rest.users.getAuthenticated()

    return {
      username: data.login,
      name: data.name,
      email: data.email,
    }
  } catch (error) {
    console.error('Error getting GitHub user')
    return null
  }
}

/**
 * Parse a GitHub repository URL to extract owner and repo
 */
export function parseGitHubUrl(repoUrl: string): { owner: string; repo: string } | null {
  try {
    // Handle both HTTPS and SSH URLs
    // HTTPS: https://github.com/owner/repo.git
    // SSH: git@github.com:owner/repo.git
    const match = repoUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+?)(\.git)?$/)

    if (match) {
      return {
        owner: match[1],
        repo: match[2],
      }
    }
    return null
  } catch (error) {
    console.error('Error parsing GitHub URL')
    return null
  }
}

interface CreatePullRequestParams {
  repoUrl: string
  branchName: string
  title: string
  body?: string
  baseBranch?: string
}

interface CreatePullRequestResult {
  success: boolean
  prUrl?: string
  prNumber?: number
  error?: string
}

async function requireGitHubAuth<T>(
  callback: (octokit: Octokit) => Promise<T>
): Promise<T | GitHubErrorResult> {
  const octokit = await getOctokit()

  if (!octokit.auth) {
    return createErrorResult('GitHub account not connected')
  }

  return callback(octokit)
}

/**
 * Create a pull request on GitHub
 */
export async function createPullRequest(params: CreatePullRequestParams): Promise<CreatePullRequestResult> {
  const { repoUrl, branchName, title, body = '', baseBranch = 'main' } = params

  try {
    const octokit = await getOctokit()

    if (!octokit.auth) {
      return createErrorResult('GitHub account not connected')
    }

    const parsed = parseGitHubUrl(repoUrl)
    if (!parsed) {
      return createErrorResult('Invalid GitHub repository URL')
    }

    const { owner, repo } = parsed

    const response = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head: branchName,
      base: baseBranch,
    })

    return {
      success: true,
      prUrl: response.data.html_url,
      prNumber: response.data.number,
    }
  } catch (error: unknown) {
    return handleGitHubError(error, 'create pull request')
  }
}

interface MergePullRequestParams {
  repoUrl: string
  prNumber: number
  commitTitle?: string
  commitMessage?: string
  mergeMethod?: 'merge' | 'squash' | 'rebase'
}

interface MergePullRequestResult {
  success: boolean
  merged?: boolean
  message?: string
  sha?: string
  error?: string
}

interface GetPullRequestStatusParams {
  repoUrl: string
  prNumber: number
}

interface GetPullRequestStatusResult {
  success: boolean
  status?: 'open' | 'closed' | 'merged'
  mergeCommitSha?: string
  error?: string
}

/**
 * Merge a pull request on GitHub
 */
export async function mergePullRequest(params: MergePullRequestParams): Promise<MergePullRequestResult> {
  const { repoUrl, prNumber, commitTitle, commitMessage, mergeMethod = 'squash' } = params

  try {
    const octokit = await getOctokit()

    if (!octokit.auth) {
      return createErrorResult('GitHub account not connected')
    }

    const parsed = parseGitHubUrl(repoUrl)
    if (!parsed) {
      return createErrorResult('Invalid GitHub repository URL')
    }

    const { owner, repo } = parsed

    const response = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      commit_title: commitTitle,
      commit_message: commitMessage,
      merge_method: mergeMethod,
    })

    return {
      success: true,
      merged: response.data.merged,
      message: response.data.message,
      sha: response.data.sha,
    }
  } catch (error: unknown) {
    return handleGitHubError(error, 'merge pull request')
  }
}

function getPrStatusFromResponse(data: { merged_at: string | null; state: string }): 'open' | 'closed' | 'merged' {
  if (data.merged_at) return 'merged'
  if (data.state === 'closed') return 'closed'
  return 'open'
}

/**
 * Get the current status of a pull request from GitHub
 */
export async function getPullRequestStatus(params: GetPullRequestStatusParams): Promise<GetPullRequestStatusResult> {
  const { repoUrl, prNumber } = params

  try {
    const octokit = await getOctokit()

    if (!octokit.auth) {
      return createErrorResult('GitHub account not connected')
    }

    const parsed = parseGitHubUrl(repoUrl)
    if (!parsed) {
      return createErrorResult('Invalid GitHub repository URL')
    }

    const { owner, repo } = parsed

    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    })

    return {
      success: true,
      status: getPrStatusFromResponse(response.data),
      mergeCommitSha: response.data.merge_commit_sha || undefined,
    }
  } catch (error: unknown) {
    return handleGitHubError(error, 'get pull request status')
  }
}
