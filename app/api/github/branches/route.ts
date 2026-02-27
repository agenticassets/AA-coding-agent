import { NextRequest, NextResponse } from 'next/server'
import { getUserGitHubToken } from '@/lib/github/user-token'

/** GitHub branch object from API with protection status */
interface GitHubBranch {
  name: string
  protected: boolean
}

/** GitHub repository object to extract default branch info */
interface GitHubRepo {
  default_branch: string
}

function withServerTiming(response: NextResponse, startTime: number) {
  response.headers.set('Server-Timing', `total;dur=${(performance.now() - startTime).toFixed(2)}`)
  return response
}

/**
 * GET /api/github/branches
 *
 * Fetch all branches for a GitHub repository with authentication.
 * Returns branches sorted by default branch first, then alphabetically.
 *
 * Query parameters:
 * - owner: Repository owner/organization
 * - repo: Repository name
 *
 * Returns: { branches: GitHubBranch[], defaultBranch: string }
 */
export async function GET(request: NextRequest) {
  const requestStart = performance.now()

  try {
    const tokenPromise = getUserGitHubToken(request)
    const { searchParams } = new URL(request.url)
    const owner = searchParams.get('owner')
    const repo = searchParams.get('repo')
    const token = await tokenPromise

    if (!token) {
      return withServerTiming(NextResponse.json({ error: 'GitHub not connected' }, { status: 401 }), requestStart)
    }

    if (!owner || !repo) {
      return withServerTiming(
        NextResponse.json({ error: 'Owner and repo parameters are required' }, { status: 400 }),
        requestStart,
      )
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    }
    const perPage = 100 // GitHub's maximum per page
    const repoResponsePromise = fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        ...headers,
      },
    })
    const firstBranchesResponsePromise = fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=${perPage}&page=1`,
      {
        headers: {
          ...headers,
        },
      },
    )
    const [repoResponse, firstBranchesResponse] = await Promise.all([repoResponsePromise, firstBranchesResponsePromise])

    if (!repoResponse.ok) {
      if (repoResponse.status === 404) {
        return withServerTiming(NextResponse.json({ error: 'Repository not found' }, { status: 404 }), requestStart)
      }
      if (repoResponse.status === 403) {
        return withServerTiming(NextResponse.json({ error: 'Access denied' }, { status: 403 }), requestStart)
      }
      console.error('Failed to fetch repository metadata')
      return withServerTiming(NextResponse.json({ error: 'Failed to fetch repository' }, { status: 500 }), requestStart)
    }

    if (!firstBranchesResponse.ok) {
      if (firstBranchesResponse.status === 404) {
        return withServerTiming(NextResponse.json({ error: 'Repository not found' }, { status: 404 }), requestStart)
      }
      if (firstBranchesResponse.status === 403) {
        return withServerTiming(NextResponse.json({ error: 'Access denied' }, { status: 403 }), requestStart)
      }
      console.error('Failed to fetch branches')
      return withServerTiming(NextResponse.json({ error: 'Failed to fetch branches' }, { status: 500 }), requestStart)
    }

    const repoData: GitHubRepo = await repoResponse.json()
    const defaultBranch = repoData.default_branch

    // Fetch all branches with pagination
    const firstPageBranches: GitHubBranch[] = await firstBranchesResponse.json()
    const allBranches: GitHubBranch[] = [...firstPageBranches]
    let page = 2
    let currentPageBranches = firstPageBranches

    while (currentPageBranches.length === perPage) {
      const branchesResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`,
        {
          headers: {
            ...headers,
          },
        },
      )

      if (!branchesResponse.ok) {
        if (branchesResponse.status === 404) {
          return withServerTiming(NextResponse.json({ error: 'Repository not found' }, { status: 404 }), requestStart)
        }
        if (branchesResponse.status === 403) {
          return withServerTiming(NextResponse.json({ error: 'Access denied' }, { status: 403 }), requestStart)
        }
        console.error('Failed to fetch branches')
        return withServerTiming(NextResponse.json({ error: 'Failed to fetch branches' }, { status: 500 }), requestStart)
      }

      const branches: GitHubBranch[] = await branchesResponse.json()

      // If we get no branches, we've reached the end
      if (branches.length === 0) {
        break
      }

      allBranches.push(...branches)
      currentPageBranches = branches
      page++
    }

    // Sort branches: default branch first, then alphabetically
    const sortedBranches = allBranches.sort((a, b) => {
      // Default branch always comes first
      if (a.name === defaultBranch) return -1
      if (b.name === defaultBranch) return 1

      // Then alphabetically
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })

    return withServerTiming(
      NextResponse.json({
        branches: sortedBranches.map((branch) => ({
          name: branch.name,
          protected: branch.protected,
        })),
        defaultBranch,
      }),
      requestStart,
    )
  } catch (error) {
    console.error('Error fetching GitHub branches')
    return withServerTiming(NextResponse.json({ error: 'Failed to fetch branches' }, { status: 500 }), requestStart)
  }
}
