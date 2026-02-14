import { execSync } from "node:child_process";
import type { CommitEntry, GitHubCommit, GitHubRepo } from "./types.ts";

const API_BASE = "https://api.github.com";

export function getAuthToken(): string {
    try {
        const token = execSync("gh auth token", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        if (token) return token;
    } catch {}

    const envToken = process.env.GITHUB_TOKEN;
    if (envToken) return envToken;

    throw new Error(
        "GitHub authentication required.\n" +
            "Either install GitHub CLI and run `gh auth login`,\n" +
            "or set the GITHUB_TOKEN environment variable.",
    );
}

function parseLinkHeader(header: string | null): string | null {
    if (!header) return null;
    const match = header.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
}

async function githubFetchAll<T>(url: string, token: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = url;

    while (nextUrl) {
        const response = await fetch(nextUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error(
                    "GitHub authentication failed. Check your token.",
                );
            }
            if (response.status === 403) {
                const rateLimitRemaining = response.headers.get(
                    "x-ratelimit-remaining",
                );
                if (rateLimitRemaining === "0") {
                    const resetTime = response.headers.get("x-ratelimit-reset");
                    const resetDate = resetTime
                        ? new Date(Number(resetTime) * 1000).toISOString()
                        : "unknown";
                    throw new Error(
                        `GitHub API rate limit exceeded. Resets at ${resetDate}.`,
                    );
                }
                throw new Error(
                    `GitHub API forbidden (403): ${await response.text()}`,
                );
            }
            if (response.status === 404) {
                throw new Error(`GitHub resource not found: ${nextUrl}`);
            }
            throw new Error(
                `GitHub API error ${response.status}: ${await response.text()}`,
            );
        }

        const rateLimitRemaining = response.headers.get(
            "x-ratelimit-remaining",
        );
        if (rateLimitRemaining !== null && Number(rateLimitRemaining) < 100) {
            console.error(
                `Warning: GitHub API rate limit low (${rateLimitRemaining} remaining)`,
            );
        }

        const data = (await response.json()) as T[];
        results.push(...data);

        nextUrl = parseLinkHeader(response.headers.get("link"));
    }

    return results;
}

export async function fetchOrgRepos(
    org: string,
    token: string,
): Promise<GitHubRepo[]> {
    return githubFetchAll<GitHubRepo>(
        `${API_BASE}/orgs/${encodeURIComponent(org)}/repos?type=all&per_page=100`,
        token,
    );
}

export async function fetchRepoCommits(
    org: string,
    repo: string,
    since: string,
    until: string,
    token: string,
): Promise<CommitEntry[]> {
    const commits = await githubFetchAll<GitHubCommit>(
        `${API_BASE}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/commits?since=${since}&until=${until}&per_page=100`,
        token,
    );

    return commits.map((c) => ({
        sha: c.sha,
        message: c.commit.message.split("\n")[0],
        author: c.author?.login ?? c.commit.author.name,
        date: c.commit.author.date.split("T")[0],
    }));
}
