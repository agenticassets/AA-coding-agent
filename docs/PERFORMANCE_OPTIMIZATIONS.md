# Performance Optimizations

This guide summarizes the patterns used to eliminate request waterfalls and
improve perceived latency in the AI Coding Agent platform.

## Waterfall Elimination Patterns

### 1) Defer awaits until needed
- Only await data after you know the branch is required.
- Example: start `getGitHubStars()` early but await it after auth checks.

### 2) Parallelize independent work
- Use `Promise.all()` for independent queries (session, settings, stars, tokens).
- Start IO early, await later to minimize critical path.

### 3) Suspense boundaries for async server components
- Wrap data-fetching server components in `<Suspense />` so shells can render
  while async work completes.
- Useful for pages/layouts that block on session + API data.

### 4) Streaming for long-running responses
- Provide a streaming response option for large data payloads.
- Use NDJSON for incremental messages and keep compatibility with JSON clients.

## Implemented in this Codebase

### Server Components
- Pages now fetch session + GitHub stars in parallel.
- Task detail and repo layout render behind Suspense boundaries.

### API Routes
- Task creation and continuation now fetch API keys/tokens in parallel.
- File content endpoint supports `stream=1` for NDJSON responses.
- File content endpoint emits `Server-Timing` for benchmarking.

## Benchmarking

### Server-Timing Header
The file content endpoint adds a `Server-Timing` header:

```
Server-Timing: file-content;dur=123
```

Use the browser Network tab or curl to compare durations before/after changes.

### Curl Example
```
curl -sI "https://<host>/api/tasks/<taskId>/file-content?filename=README.md"
```

Look for `Server-Timing` in the response headers.

---

Keep these patterns in mind for future features that need fast UI feedback.
