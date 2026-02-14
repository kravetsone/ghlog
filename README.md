# changelogen

Fetch commit history from a GitHub organization and output structured JSON or LLM-friendly Markdown. Feed the output to Claude to generate polished changelogs for a multi-repo organization.

## Installation

```bash
npm install -g changelogen
```

Or run directly:

```bash
npx changelogen --org my-org --since 2026-01-01
```

## Authentication

changelogen needs a GitHub token. It tries these in order:

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
changelogen --org <name> --since <date> [options]

Required:
  --org, -o <name>        GitHub organization name
  --since, -s <date>      Start date (YYYY-MM-DD)

Options:
  --until, -u <date>      End date [default: today]
  --format, -f <format>   json | markdown [default: markdown]
  --repos, -r <repos>     Comma-separated repo filter
  --output <file>         Write to file instead of stdout
  --help, -h              Show help
  --version, -v           Show version
```

## Examples

```bash
# Markdown output for an org since Jan 1
changelogen --org my-org --since 2026-01-01

# JSON output for specific repos
changelogen --org my-org --since 2026-01-01 -f json -r api,web,docs

# Save to file
changelogen --org my-org --since 2026-01-01 --output changelog.md

# Pipe to clipboard (macOS)
changelogen --org my-org --since 2026-01-01 | pbcopy
```

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
