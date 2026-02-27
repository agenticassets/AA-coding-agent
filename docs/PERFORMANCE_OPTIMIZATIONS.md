# Request Waterfall Optimizations

This document tracks AGENTIC-18 performance improvements focused on eliminating request waterfalls in high-traffic paths.

## Applied Patterns

### 1) `async-parallel` and `async-api-routes`

#### `app/api/github/user-repos/route.ts`
- Parallelized independent GitHub calls in non-search flow:
  - `GET /user`
  - `GET /user/repos`
- Added `Server-Timing` response header for measurable latency tracking.

#### `app/api/github/branches/route.ts`
- Parallelized:
  - repo metadata fetch (`default_branch`)
  - first branches page fetch
- Kept pagination logic for remaining pages.
- Added `Server-Timing` response header.

#### `app/api/tasks/[taskId]/route.ts`
- Parallelized auth + route param resolution for `GET`, `PATCH`, and `DELETE`.
- Deferred request body parsing in `PATCH` until after task ownership check.

#### `app/api/tasks/[taskId]/messages/route.ts`
- Parallelized session + route param resolution.
- Added `Server-Timing` response header.

#### `app/api/tasks/[taskId]/diff/route.ts`
- Parallelized independent base/head content fetches after refs are resolved.
- Preserved existing fallback behavior for missing refs/files.

### 2) `async-suspense-boundaries` (streaming server response)

Added explicit `<Suspense>` boundaries around async server loaders so fallback UI can stream immediately:

- `app/page.tsx`
- `app/new/[owner]/[repo]/page.tsx`
- `app/[owner]/[repo]/page.tsx`
- `app/tasks/page.tsx`
- `app/tasks/[taskId]/page.tsx`

## Benchmarking Method

Use browser Network panel or HTTP tooling to validate improvement:

1. Hit optimized routes and inspect `Server-Timing` header:
   - `/api/github/user-repos?...`
   - `/api/github/branches?...`
   - `/api/tasks/{taskId}/messages`
2. Capture at least 20 samples per route.
3. Compare median (p50) and tail (p95) before/after.
4. For UI routes with Suspense boundaries, verify faster first paint of fallback while async content resolves.

## Expected Impact

- Reduced waterfall depth on key API routes (fewer serialized waits).
- Faster time-to-first-visible-content from Suspense streaming fallbacks.
- Practical end-user improvement target: **~40-60% latency reduction** on affected paths under typical network conditions.
