# Lessons Learned

Capture patterns and mistakes here to prevent recurring errors.

## Patterns

### Security
- ALL log statements must use static strings only - never interpolate dynamic values
- Credentials must never be passed via `echo` pipes in shell commands (visible in process list)
- Always validate encryption/decryption results before storing or using

### Performance
- Use `Promise.all()` for independent database operations instead of sequential awaits
- Always validate API responses before consuming the body

### Code Quality
- Avoid duplicate utility functions across agent files - extract shared modules
- Never silently swallow database errors with empty `.catch()` handlers
- Deduplicate logger calls - call once, not twice for the same message
