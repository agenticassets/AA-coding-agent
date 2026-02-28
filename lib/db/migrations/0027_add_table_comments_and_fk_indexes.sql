-- Migration: Add table comments for schema documentation and foreign key indexes for performance
-- Date: 2026-02-28
--
-- This migration adds two complementary improvements to the database schema:
-- 1. Table comments: Describe the purpose of each table for documentation and schema introspection
-- 2. Foreign key indexes: Optimize queries on frequently-filtered user_id columns
--
-- Table comments follow Supabase SQL Style Guide: max 1024 chars, descriptive of business logic
-- FK indexes follow database best practices: simple indexes on foreign key columns for JOIN optimization

-- ====================================
-- SECTION 1: TABLE COMMENTS
-- ====================================

comment on table "public"."users" is
  'User profiles with OAuth provider information and encrypted access tokens. Stores the primary account (GitHub or Vercel) used for authentication. Additional accounts can be linked via the accounts table.';

comment on table "public"."accounts" is
  'Additional linked OAuth accounts (e.g., GitHub connected to Vercel user). Allows multi-provider authentication for a single user. Enforced unique constraint: one account per provider per user.';

comment on table "public"."keys" is
  'User API keys for various AI services (Anthropic, OpenAI, Cursor, Gemini, AI Gateway, GitHub). Values encrypted at rest using AES-256-CBC. Enforced unique constraint: one key per provider per user.';

comment on table "public"."tasks" is
  'Coding tasks created by users for automated development work. Tracks execution status, logs (JSONB array with agent context), PR information, sandbox ID, and sub-agent activity. Supports soft deletes via deletedAt column. Heartbeat tracking enables timeout extension during long-running tasks.';

comment on table "public"."task_messages" is
  'Chat history between users and AI agents for multi-turn task conversations. Enables interactive refinement and follow-up instructions. Role field distinguishes user messages from agent responses.';

comment on table "public"."connectors" is
  'MCP (Model Context Protocol) server configurations connecting agents to external tools. Stores connection info for local (stdio) and remote (HTTP) servers. Environment variables and OAuth credentials encrypted at rest. Status tracks connection health.';

comment on table "public"."settings" is
  'User-specific settings stored as key-value pairs. Enables per-user overrides of global environment variables (e.g., maxMessagesPerDay, maxSandboxDuration). Enforced unique constraint: one setting per key per user.';

comment on table "public"."api_tokens" is
  'External API tokens for programmatic access via MCP clients and integrations. Tokens stored as SHA256 hashes (not encrypted, non-reversible). Raw token shown only once at creation. Supports optional expiration dates and lastUsedAt tracking.';

-- ====================================
-- SECTION 2: FOREIGN KEY INDEXES
-- ====================================

-- Index on connectors.user_id for fast lookup of user's MCP servers
-- Used in: agent execution, MCP server discovery
create index if not exists "idx_connectors_user_id" on "public"."connectors"("user_id");

-- Index on accounts.user_id for fast lookup of user's linked accounts
-- Used in: OAuth flow, account management, account merging
create index if not exists "idx_accounts_user_id" on "public"."accounts"("user_id");

-- Index on keys.user_id for fast lookup of user's API keys
-- Used in: agent execution (key retrieval), key management
create index if not exists "idx_keys_user_id" on "public"."keys"("user_id");

-- Index on settings.user_id for fast lookup of user's settings
-- Used in: settings override lookups, user preference retrieval
create index if not exists "idx_settings_user_id" on "public"."settings"("user_id");

-- Index on tasks.status for fast filtering by task status
-- Used in: task listing, status-based queries, cleanup operations
create index if not exists "idx_tasks_status" on "public"."tasks"("status");

-- Filtered index on tasks.sandbox_id for fast lookup of active sandboxes
-- Used in: sandbox cleanup operations, resource tracking
-- WHERE clause limits index to rows with actual sandbox IDs (excludes nulls)
create index if not exists "idx_tasks_sandbox_id" on "public"."tasks"("sandbox_id") where "sandbox_id" is not null;

-- NOTE: tasks.user_id already has composite indexes from migration 0025:
-- - idx_tasks_user_id_created_at (for rate limiting by date)
-- - idx_tasks_user_id_deleted_at (for soft delete filtering)
-- These composite indexes also serve simple lookups on user_id.
--
-- NOTE: task_messages.task_id already has an index (idx_task_messages_task_id) from migration 0025
--
-- NOTE: api_tokens.user_id already has an index (api_tokens_user_id_idx) from schema definition
