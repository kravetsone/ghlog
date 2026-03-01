# ghlog

Fetch commit history from a GitHub organization and output structured JSON or LLM-friendly Markdown. Feed the output to Claude to generate polished changelogs for a multi-repo organization.

## Installation

```bash
npm install -g ghlog
```

Or run directly:

```bash
npx ghlog --org my-org --since 2026-01-01
```

## Authentication

ghlog needs a GitHub token. It tries these in order:

1. **GitHub CLI** - if `gh` is installed and authenticated, it uses `gh auth token`
2. **Environment variable** - set `GITHUB_TOKEN`

```bash
# Option 1: GitHub CLI (recommended)
gh auth login

# Option 2: Environment variable
export GITHUB_TOKEN=ghp_...
```

## Usage

```
ghlog --org <name> --since <date> [options]
ghlog --org <name> --since-map <file> [options]

Required:
  --org, -o <name>        GitHub organization name

Required (one of):
  --since, -s <date>      Start date (YYYY-MM-DD) — global or fallback for new repos
  --since-map <file>      JSON file {"repo": "sha"} — per-repo start commit SHA

Options:
  --include-new           Include repos not in --since-map (requires --since)
  --until, -u <date>      End date [default: today]
  --format, -f <format>   json | markdown [default: markdown]
  --repos, -r <repos>     Comma-separated repo filter
  --output <file>         Write to file instead of stdout
  --patch                 Download .patch files for each commit
  --patch-dir <dir>       Directory for patch files [default: ./patches]
  --help, -h              Show help
  --version, -v           Show version
```

## Examples

```bash
# Markdown output for an org since Jan 1
ghlog --org my-org --since 2026-01-01

# JSON output for specific repos
ghlog --org my-org --since 2026-01-01 -f json -r api,web,docs

# Save to file
ghlog --org my-org --since 2026-01-01 --output changelog.md

# Download .patch files for all commits
ghlog --org my-org --since 2026-01-01 --patch

# Download patches to a custom directory (--patch-dir implies --patch)
ghlog --org my-org --since 2026-01-01 --patch-dir ./my-patches

# Pipe to clipboard (macOS)
ghlog --org my-org --since 2026-01-01 | pbcopy
```

## Incremental fetching with `--since-map`

`--since-map` lets you start each repo from a specific commit SHA rather than a date. This is more precise than `--since` (no day-boundary ambiguity) and is the natural way to implement incremental runs — save the last-seen SHA per repo, pass it on the next run.

```bash
# Create a map of last-seen SHAs
echo '{"api": "a1b2c3d", "web": "e4f5g6h"}' > since.json

# Fetch only new commits for repos in the map (others are skipped)
ghlog --org my-org --since-map since.json

# Also include repos not in the map, using --since as a date fallback
ghlog --org my-org --since-map since.json --include-new --since 2026-01-01
```

The SHA is resolved to its exact commit timestamp before fetching, so commits are never double-counted or missed at day boundaries.

## Development

```bash
bun install
bun run dev -- --help
bun run dev -- --org my-org --since 2026-01-01
bun run typecheck
bun run lint
bun run build
```

## License

MIT
