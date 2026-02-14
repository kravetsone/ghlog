#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatJSON, formatMarkdown } from "./formatter.ts";
import { fetchOrgRepos, fetchRepoCommits, getAuthToken } from "./github.ts";
import type { ChangelogOutput, CliOptions } from "./types.ts";

const VERSION = "0.1.0";

const HELP = `changelogen - Fetch commit history from a GitHub org

Usage:
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
  --version, -v           Show version`;

function isValidDate(value: string): boolean {
    return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    );
}

function parseCliArgs(): CliOptions {
    const { values } = parseArgs({
        options: {
            org: { type: "string", short: "o" },
            since: { type: "string", short: "s" },
            until: { type: "string", short: "u" },
            format: { type: "string", short: "f" },
            repos: { type: "string", short: "r" },
            output: { type: "string" },
            help: { type: "boolean", short: "h" },
            version: { type: "boolean", short: "v" },
        },
        strict: true,
    });

    if (values.help) {
        console.log(HELP);
        process.exit(0);
    }

    if (values.version) {
        console.log(VERSION);
        process.exit(0);
    }

    if (!values.org) {
        console.error("Error: --org is required.\n");
        console.error(HELP);
        process.exit(1);
    }

    if (!values.since) {
        console.error("Error: --since is required.\n");
        console.error(HELP);
        process.exit(1);
    }

    if (!isValidDate(values.since)) {
        console.error(
            `Error: --since must be a valid date (YYYY-MM-DD), got "${values.since}"`,
        );
        process.exit(1);
    }

    const until = values.until ?? new Date().toISOString().split("T")[0];
    if (values.until && !isValidDate(values.until)) {
        console.error(
            `Error: --until must be a valid date (YYYY-MM-DD), got "${values.until}"`,
        );
        process.exit(1);
    }

    const format = (values.format ?? "markdown") as "json" | "markdown";
    if (format !== "json" && format !== "markdown") {
        console.error(
            `Error: --format must be "json" or "markdown", got "${values.format}"`,
        );
        process.exit(1);
    }

    return {
        org: values.org,
        since: values.since,
        until,
        format,
        repos: values.repos?.split(",").map((r) => r.trim()),
        output: values.output,
    };
}

async function main() {
    const options = parseCliArgs();
    const token = getAuthToken();

    console.error(`Fetching repos for ${options.org}...`);
    let repos = await fetchOrgRepos(options.org, token);

    // Filter archived and disabled repos
    repos = repos.filter((r) => !r.archived && !r.disabled);

    // Apply --repos filter
    if (options.repos) {
        const allowed = new Set(options.repos);
        repos = repos.filter((r) => allowed.has(r.name));
    }

    // Sort alphabetically
    repos.sort((a, b) => a.name.localeCompare(b.name));

    console.error(`Found ${repos.length} repos to scan.`);

    const result: ChangelogOutput = {
        org: options.org,
        since: options.since,
        until: options.until,
        generatedAt: new Date().toISOString(),
        repos: [],
    };

    // Fetch commits sequentially to avoid GitHub abuse detection
    for (const repo of repos) {
        console.error(`  Fetching commits for ${repo.name}...`);
        const commits = await fetchRepoCommits(
            options.org,
            repo.name,
            options.since,
            options.until,
            token,
        );
        result.repos.push({ repo: repo.name, commits });
    }

    const totalCommits = result.repos.reduce(
        (sum, r) => sum + r.commits.length,
        0,
    );
    console.error(
        `Done. ${totalCommits} commits across ${result.repos.length} repos.`,
    );

    const output =
        options.format === "json" ? formatJSON(result) : formatMarkdown(result);

    if (options.output) {
        writeFileSync(options.output, output, "utf-8");
        console.error(`Output written to ${options.output}`);
    } else {
        console.log(output);
    }
}

main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
});
