# ghlog

CLI tool that fetches commit history from a GitHub organization and outputs structured JSON or LLM-friendly Markdown.

## Tech Stack

- TypeScript, zero runtime dependencies
- Node.js built-ins only (`node:util`, `node:child_process`, `node:fs`, `node:path`) + native `fetch`
- Biome for linting/formatting
- pkgroll for building

## Commands

```bash
bun install          # Install dev dependencies
bun run dev          # Run CLI in dev mode (e.g. bun run dev -- --help)
bun run build        # Build with pkgroll to dist/
bun run typecheck    # TypeScript type checking
bun run lint         # Biome lint + format check
bun run lint:fix     # Biome auto-fix
```

## Architecture

```
src/
  types.ts        -- Shared TypeScript interfaces
  github.ts       -- GitHub API client (auth, repos, commits, patches, pagination)
  formatter.ts    -- JSON and Markdown output formatters
  cli.ts          -- Entry point: arg parsing, orchestration, output
```

## Conventions

- All progress/status output goes to stderr, data output to stdout
- Sequential repo fetching to avoid GitHub abuse detection
- Archived/disabled repos filtered by default
- Auth: `gh auth token` first, then `GITHUB_TOKEN` env var fallback
