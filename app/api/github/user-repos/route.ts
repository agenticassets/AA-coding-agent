import { NextRequest, NextResponse } from 'next/server'
import { getUserGitHubToken } from '@/lib/github/user-token'

interface GitHubRepo {
  name: string
  full_name: string
  description?: string
  private: boolean
  clone_url: string
  updated_at: string
  language?: string
  owner: {
    login: string
  }
}

interface GitHubSearchResult {
  total_count: number
  incomplete_results: boolean
  items: GitHubRepo[]
}

function withServerTiming(response: NextResponse, startTime: number) {
  response.headers.set('Server-Timing', `total;dur=${(performance.now() - startTime).toFixed(2)}`)
  return response
}

export async function GET(request: NextRequest) {
  const requestStart = performance.now()

  try {
    const tokenPromise = getUserGitHubToken(request)
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const perPage = parseInt(searchParams.get('per_page') || '25', 10)
    const search = searchParams.get('search') || ''
    const token = await tokenPromise

    if (!token) {
      return withServerTiming(NextResponse.json({ error: 'GitHub not connected' }, { status: 401 }), requestStart)
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    }
    const userResponsePromise = fetch('https://api.github.com/user', {
      headers: {
        ...headers,
      },
    })

    // If there's a search query, use GitHub search API
    if (search.trim()) {
      const userResponse = await userResponsePromise
      if (!userResponse.ok) {
        return withServerTiming(NextResponse.json({ error: 'Failed to fetch user' }, { status: 401 }), requestStart)
      }

      const userPayload: { login: string } = await userResponse.json()
      const username = userPayload.login

      // Search for repos the user has access to matching the query
      const searchQuery = encodeURIComponent(`${search} in:name user:${username} fork:true`)
      const searchUrl = `https://api.github.com/search/repositories?q=${searchQuery}&sort=updated&order=desc&per_page=${perPage}&page=${page}`

      const searchResponse = await fetch(searchUrl, {
        headers: {
          ...headers,
        },
      })

      if (!searchResponse.ok) {
        throw new Error('Failed to search repositories')
      }

      const searchResult: GitHubSearchResult = await searchResponse.json()

      return withServerTiming(
        NextResponse.json({
          repos: searchResult.items.map((repo) => ({
            name: repo.name,
            full_name: repo.full_name,
            owner: repo.owner.login,
            description: repo.description,
            private: repo.private,
            clone_url: repo.clone_url,
            updated_at: repo.updated_at,
            language: repo.language,
          })),
          page,
          per_page: perPage,
          has_more: searchResult.total_count > page * perPage,
          total_count: searchResult.total_count,
          username,
        }),
        requestStart,
      )
    }

    // No search query - fetch repos sorted by updated_at (most recent first) for pagination
    // We use a larger page size and handle deduplication ourselves
    const githubPerPage = 100
    const githubPage = Math.ceil((page * perPage) / githubPerPage)

    // Fetch user's repos (owned repos, sorted by recently updated)
    const apiUrl = `https://api.github.com/user/repos?sort=updated&direction=desc&per_page=${githubPerPage}&page=${githubPage}&visibility=all&affiliation=owner,organization_member`
    const reposResponsePromise = fetch(apiUrl, {
      headers: {
        ...headers,
      },
    })

    const [userResponse, reposResponse] = await Promise.all([userResponsePromise, reposResponsePromise])
    if (!userResponse.ok) {
      return withServerTiming(NextResponse.json({ error: 'Failed to fetch user' }, { status: 401 }), requestStart)
    }
    if (!reposResponse.ok) {
      throw new Error('Failed to fetch repositories')
    }

    const [userPayload, repos] = await Promise.all([
      userResponse.json() as Promise<{ login: string }>,
      reposResponse.json() as Promise<GitHubRepo[]>,
    ])
    const username = userPayload.login

    // Calculate the offset within the GitHub page
    const offsetInGithubPage = ((page - 1) * perPage) % githubPerPage
    const slicedRepos = repos.slice(offsetInGithubPage, offsetInGithubPage + perPage)

    // Check if there are more repos
    const hasMore = repos.length === githubPerPage || slicedRepos.length === perPage

    return withServerTiming(
      NextResponse.json({
        repos: slicedRepos.map((repo) => ({
          name: repo.name,
          full_name: repo.full_name,
          owner: repo.owner.login,
          description: repo.description,
          private: repo.private,
          clone_url: repo.clone_url,
          updated_at: repo.updated_at,
          language: repo.language,
        })),
        page,
        per_page: perPage,
        has_more: hasMore,
        username,
      }),
      requestStart,
    )
  } catch (error) {
    console.error('Error fetching user repositories:')
    return withServerTiming(NextResponse.json({ error: 'Failed to fetch repositories' }, { status: 500 }), requestStart)
  }
}
