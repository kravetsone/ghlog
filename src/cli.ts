#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatJSON, formatMarkdown } from "./formatter.ts";
import {
    fetchCommitPatch,
    fetchCommitTimestamp,
    fetchOrgRepos,
    fetchRepoCommits,
    getAuthToken,
} from "./github.ts";
import type { ChangelogOutput, CliOptions } from "./types.ts";

const VERSION = "0.1.0";

const HELP = `ghlog - Fetch commit history from a GitHub org

Usage:
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
            "since-map": { type: "string" },
            "include-new": { type: "boolean" },
            until: { type: "string", short: "u" },
            format: { type: "string", short: "f" },
            repos: { type: "string", short: "r" },
            output: { type: "string" },
            patch: { type: "boolean" },
            "patch-dir": { type: "string" },
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

    let sinceMap: Record<string, string> | undefined;
    if (values["since-map"]) {
        let raw: string;
        try {
            raw = readFileSync(values["since-map"], "utf-8");
        } catch {
            console.error(
                `Error: Cannot read --since-map file "${values["since-map"]}"`,
            );
            process.exit(1);
        }
        try {
            sinceMap = JSON.parse(raw) as Record<string, string>;
            if (typeof sinceMap !== "object" || Array.isArray(sinceMap)) {
                throw new Error("not an object");
            }
        } catch {
            console.error(
                `Error: --since-map file "${values["since-map"]}" contains invalid JSON (expected {"repo": "sha"})`,
            );
            process.exit(1);
        }
    }

    if (!values.since && !sinceMap) {
        console.error("Error: --since or --since-map is required.\n");
        console.error(HELP);
        process.exit(1);
    }

    if (values["include-new"] && !values.since) {
        console.error(
            "Error: --include-new requires --since as a date fallback for new repos.\n",
        );
        console.error(HELP);
        process.exit(1);
    }

    if (values.since && !isValidDate(values.since)) {
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
        sinceMap,
        includeNew: values["include-new"] ?? false,
        until,
        format,
        repos: values.repos?.split(",").map((r) => r.trim()),
        output: values.output,
        patch: values.patch ?? !!values["patch-dir"],
        patchDir: values["patch-dir"] ?? "./patches",
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
        since: options.since ?? "commit-map",
        until: options.until,
        generatedAt: new Date().toISOString(),
        repos: [],
    };

    // Fetch commits sequentially to avoid GitHub abuse detection
    for (const repo of repos) {
        let startSince: string | undefined;
        let sinceLabel: string;

        if (options.sinceMap && repo.name in options.sinceMap) {
            const sha = options.sinceMap[repo.name];
            const timestamp = await fetchCommitTimestamp(
                options.org,
                repo.name,
                sha,
                token,
            );
            startSince = timestamp;
            sinceLabel = sha;
        } else if (options.sinceMap && !options.includeNew) {
            // Repo not in map and --include-new not set — skip
            continue;
        } else {
            startSince = options.since;
            sinceLabel = options.since ?? "beginning";
        }

        console.error(
            `  Fetching commits for ${repo.name} (since ${sinceLabel})...`,
        );
        const commits = await fetchRepoCommits(
            options.org,
            repo.name,
            startSince,
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

    if (options.patch) {
        console.error(`Downloading patches to ${options.patchDir}...`);
        for (const repo of result.repos) {
            for (const commit of repo.commits) {
                const repoDir = join(options.patchDir, repo.repo);
                mkdirSync(repoDir, { recursive: true });
                const filename = `${commit.date}_${commit.sha.slice(0, 7)}.patch`;
                const filepath = join(repoDir, filename);
                console.error(`  ${repo.repo}/${filename}`);
                const patch = await fetchCommitPatch(
                    options.org,
                    repo.repo,
                    commit.sha,
                    token,
                );
                writeFileSync(filepath, patch, "utf-8");
            }
        }
        console.error("Patches downloaded.");
    }

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
