import 'server-only'

import { db } from '@/lib/db/client'
import { keys, accounts, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { decrypt } from '@/lib/crypto'

type Provider = 'openai' | 'gemini' | 'cursor' | 'anthropic' | 'aigateway' | 'github'

/**
 * Get API keys for the currently authenticated user
 * Returns user's keys if available, otherwise falls back to system env vars
 */
export async function getUserApiKeys(): Promise<{
  OPENAI_API_KEY: string | undefined
  GEMINI_API_KEY: string | undefined
  CURSOR_API_KEY: string | undefined
  ANTHROPIC_API_KEY: string | undefined
  AI_GATEWAY_API_KEY: string | undefined
  GITHUB_TOKEN: string | undefined
}> {
  const session = await getServerSession()

  // Default to system keys
  const apiKeys = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    GITHUB_TOKEN: undefined as string | undefined,
  }

  if (!session?.user?.id) {
    return apiKeys
  }

  try {
    const userKeys = await db.select().from(keys).where(eq(keys.userId, session.user.id))

    userKeys.forEach((key) => {
      const decryptedValue = decrypt(key.value)

      switch (key.provider) {
        case 'openai':
          apiKeys.OPENAI_API_KEY = decryptedValue
          break
        case 'gemini':
          apiKeys.GEMINI_API_KEY = decryptedValue
          break
        case 'cursor':
          apiKeys.CURSOR_API_KEY = decryptedValue
          break
        case 'anthropic':
          apiKeys.ANTHROPIC_API_KEY = decryptedValue
          break
        case 'aigateway':
          apiKeys.AI_GATEWAY_API_KEY = decryptedValue
          break
        case 'github':
          apiKeys.GITHUB_TOKEN = decryptedValue
          break
      }
    })
  } catch (error) {
    console.error('Error fetching user API keys:', error)
    // Fall back to system keys on error
  }

  return apiKeys
}

/**
 * Get a specific API key for a provider
 * Returns user's key if available, otherwise falls back to system env var
 */
export async function getUserApiKey(provider: Provider): Promise<string | undefined> {
  const session = await getServerSession()

  // Default to system key
  const systemKeys = {
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    cursor: process.env.CURSOR_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    aigateway: process.env.AI_GATEWAY_API_KEY,
    github: undefined,
  }

  if (!session?.user?.id) {
    return systemKeys[provider]
  }

  try {
    const userKey = await db
      .select({ value: keys.value })
      .from(keys)
      .where(and(eq(keys.userId, session.user.id), eq(keys.provider, provider)))
      .limit(1)

    if (userKey[0]?.value) {
      return decrypt(userKey[0].value)
    }
  } catch (error) {
    console.error('Error fetching user API key:', error)
  }

  return systemKeys[provider]
}

/**
 * Get API keys for a user by their ID (no session required)
 * Used for MCP/API token-based authentication where session context is unavailable
 *
 * @param userId - The user's ID
 * @returns Object containing all API keys (user's or system defaults)
 */
export async function getApiKeysByUserId(userId: string): Promise<{
  OPENAI_API_KEY: string | undefined
  GEMINI_API_KEY: string | undefined
  CURSOR_API_KEY: string | undefined
  ANTHROPIC_API_KEY: string | undefined
  AI_GATEWAY_API_KEY: string | undefined
  GITHUB_TOKEN: string | undefined
}> {
  // Default to system keys
  const apiKeys = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    GITHUB_TOKEN: undefined as string | undefined,
  }

  try {
    const userKeys = await db.select().from(keys).where(eq(keys.userId, userId))

    userKeys.forEach((key) => {
      const decryptedValue = decrypt(key.value)

      switch (key.provider) {
        case 'openai':
          apiKeys.OPENAI_API_KEY = decryptedValue
          break
        case 'gemini':
          apiKeys.GEMINI_API_KEY = decryptedValue
          break
        case 'cursor':
          apiKeys.CURSOR_API_KEY = decryptedValue
          break
        case 'anthropic':
          apiKeys.ANTHROPIC_API_KEY = decryptedValue
          break
        case 'aigateway':
          apiKeys.AI_GATEWAY_API_KEY = decryptedValue
          break
        case 'github':
          apiKeys.GITHUB_TOKEN = decryptedValue
          break
      }
    })
  } catch {
    // Fall back to system keys on error
  }

  return apiKeys
}

/**
 * Get GitHub access token for a user by their ID (no session required)
 * Used for MCP/API token-based authentication where session context is unavailable
 *
 * Checks in order:
 * 1. GitHub PAT stored in keys table
 * 2. Connected GitHub account (accounts table)
 * 3. Primary GitHub account (users table if they signed in with GitHub)
 *
 * @param userId - The user's ID
 * @returns GitHub access token or null if not available
 */
export async function getGitHubTokenByUserId(userId: string): Promise<string | null> {
  try {
    // Priority 1: Check for GitHub PAT in keys table (explicitly stored by user)
    const githubKey = await db
      .select({ value: keys.value })
      .from(keys)
      .where(and(eq(keys.userId, userId), eq(keys.provider, 'github')))
      .limit(1)

    if (githubKey[0]?.value) {
      return decrypt(githubKey[0].value)
    }

    // Priority 2: Check if user has GitHub as a connected account
    const account = await db
      .select({ accessToken: accounts.accessToken })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'github')))
      .limit(1)

    if (account[0]?.accessToken) {
      return decrypt(account[0].accessToken)
    }

    // Priority 3: Check if user signed in with GitHub (primary account)
    const user = await db
      .select({ accessToken: users.accessToken })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.provider, 'github')))
      .limit(1)

    if (user[0]?.accessToken) {
      return decrypt(user[0].accessToken)
    }

    return null
  } catch {
    return null
  }
}
