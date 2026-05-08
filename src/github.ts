import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import type {
    CommitEntry,
    GitHubCommit,
    GitHubPushEvent,
    GitHubRepo,
} from "./types.ts";

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

class RetryableHttpError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

async function fetchWithRetry(
    url: string,
    init: RequestInit,
    { retries = 3, baseDelayMs = 1000 } = {},
): Promise<Response> {
    let attempt = 0;
    while (true) {
        try {
            const response = await fetch(url, init);
            if (response.status >= 500 && attempt < retries) {
                throw new RetryableHttpError(
                    response.status,
                    `GitHub API ${response.status}`,
                );
            }
            return response;
        } catch (err) {
            const isNetwork = err instanceof TypeError;
            const isRetryable5xx = err instanceof RetryableHttpError;
            if ((!isNetwork && !isRetryable5xx) || attempt >= retries) {
                throw err;
            }
            const delay = baseDelayMs * 2 ** attempt;
            const reason =
                err instanceof Error ? err.message : "network error";
            console.error(
                `  retry ${attempt + 1}/${retries} after ${delay}ms (${reason})`,
            );
            await sleep(delay);
            attempt++;
        }
    }
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
        const response = await fetchWithRetry(nextUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        });

        if (!response.ok) {
            if (response.status === 409) {
                // Empty repository — no data to return
                return results;
            }
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

export async function fetchCommitTimestamp(
    org: string,
    repo: string,
    sha: string,
    token: string,
): Promise<string> {
    const url = `${API_BASE}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`;
    const response = await fetchWithRetry(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(
                `SHA "${sha}" not found in repo "${org}/${repo}". Check your --since-map file.`,
            );
        }
        if (response.status === 401) {
            throw new Error("GitHub authentication failed. Check your token.");
        }
        throw new Error(
            `GitHub API error ${response.status}: ${await response.text()}`,
        );
    }

    const data = (await response.json()) as {
        commit: { committer: { date: string } };
    };
    return data.commit.committer.date;
}

export async function fetchRepoCommits(
    org: string,
    repo: string,
    since: string | undefined,
    until: string,
    token: string,
): Promise<CommitEntry[]> {
    const sinceParam = since ? `&since=${encodeURIComponent(since)}` : "";
    const commits = await githubFetchAll<GitHubCommit>(
        `${API_BASE}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/commits?until=${encodeURIComponent(until)}${sinceParam}&per_page=100`,
        token,
    );

    return commits.map((c) => {
        const lines = c.commit.message.split(/\r?\n/);
        return {
            sha: c.sha,
            url: `https://github.com/${org}/${repo}/commit/${c.sha}`,
            message: lines[0] ?? "",
            description: lines.slice(1).join("\n").trim(),
            author: c.author?.login ?? c.commit.author.name,
            date: c.commit.author.date.split("T")[0],
        };
    });
}

async function fetchRepoPushEvents(
    org: string,
    repo: string,
    token: string,
): Promise<GitHubPushEvent[]> {
    return githubFetchAll<GitHubPushEvent>(
        `${API_BASE}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/events?per_page=100`,
        token,
    );
}

async function fetchCompareCommits(
    org: string,
    repo: string,
    base: string,
    head: string,
    token: string,
): Promise<GitHubCommit[]> {
    const url = `${API_BASE}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    const response = await fetchWithRetry(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error(
            `GitHub compare API ${response.status}: ${await response.text()}`,
        );
    }
    const data = (await response.json()) as { commits?: GitHubCommit[] };
    return data.commits ?? [];
}

async function fetchSingleCommit(
    org: string,
    repo: string,
    sha: string,
    token: string,
): Promise<GitHubCommit | null> {
    const url = `${API_BASE}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`;
    const response = await fetchWithRetry(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!response.ok) return null;
    return (await response.json()) as GitHubCommit;
}

interface PushedCommitRaw {
    sha: string;
    commit: GitHubCommit["commit"];
    author: GitHubCommit["author"];
    pushedAt: string;
    actorLogin: string;
}

/**
 * Walk a repo's PushEvents (events API: last ~90 days / 300 events) and expand
 * each event's `before...head` range via the Compare API to get full commit
 * metadata tagged with the push timestamp.
 */
async function fetchAllPushedCommits(
    org: string,
    repo: string,
    token: string,
): Promise<PushedCommitRaw[]> {
    const events = await fetchRepoPushEvents(org, repo, token);
    const result: PushedCommitRaw[] = [];
    const seen = new Set<string>();

    for (const ev of events) {
        if (ev.type !== "PushEvent") continue;
        const before = ev.payload.before;
        const head = ev.payload.head;
        if (!head) continue;

        let commits: GitHubCommit[];
        // Repo-creation push uses an all-zero `before` SHA — Compare API can't
        // diff against it, so fall back to fetching the head commit alone.
        if (!before || /^0+$/.test(before)) {
            const single = await fetchSingleCommit(org, repo, head, token);
            commits = single ? [single] : [];
        } else {
            commits = await fetchCompareCommits(org, repo, before, head, token);
        }

        for (const c of commits) {
            if (seen.has(c.sha)) continue;
            seen.add(c.sha);
            result.push({
                sha: c.sha,
                commit: c.commit,
                author: c.author,
                pushedAt: ev.created_at,
                actorLogin: ev.actor?.login ?? "",
            });
        }
    }
    return result;
}

/**
 * Build a commit list using PushEvent timestamps as the time source.
 * Limited by the GitHub events API window (~90 days / 300 events per repo).
 * Each PushEvent costs one extra Compare API call to enumerate its commits.
 */
export async function fetchPushedCommits(
    org: string,
    repo: string,
    since: string | undefined,
    until: string,
    token: string,
): Promise<CommitEntry[]> {
    const all = await fetchAllPushedCommits(org, repo, token);
    const sinceTime = since ? new Date(since).getTime() : 0;
    const untilTime = new Date(until).getTime();
    const result: CommitEntry[] = [];

    for (const p of all) {
        const t = new Date(p.pushedAt).getTime();
        if (t < sinceTime || t > untilTime) continue;
        const lines = p.commit.message.split(/\r?\n/);
        result.push({
            sha: p.sha,
            url: `https://github.com/${org}/${repo}/commit/${p.sha}`,
            message: lines[0] ?? "",
            description: lines.slice(1).join("\n").trim(),
            author: p.author?.login ?? p.actorLogin ?? p.commit.author.name,
            date: p.pushedAt.split("T")[0],
            pushDate: p.pushedAt,
        });
    }
    return result;
}

/**
 * Resolve a SHA to its push event timestamp via events + compare APIs.
 * Returns null if the SHA is older than ~90 days or otherwise not found.
 */
export async function fetchPushTimestamp(
    org: string,
    repo: string,
    sha: string,
    token: string,
): Promise<string | null> {
    const all = await fetchAllPushedCommits(org, repo, token);
    return all.find((p) => p.sha === sha)?.pushedAt ?? null;
}

export async function fetchCommitPatch(
    org: string,
    repo: string,
    sha: string,
    token: string,
): Promise<string> {
    const url = `${API_BASE}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/commits/${sha}`;
    const response = await fetchWithRetry(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.patch",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("GitHub authentication failed. Check your token.");
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
            throw new Error(`GitHub resource not found: ${url}`);
        }
        throw new Error(
            `GitHub API error ${response.status}: ${await response.text()}`,
        );
    }

    return response.text();
}
