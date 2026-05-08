export interface CliOptions {
    org: string;
    since?: string;
    sinceMap?: Record<string, string>;
    includeNew: boolean;
    /** Inclusive end-of-day timestamp passed to GitHub API. */
    until: string;
    /** Original CLI value (date or ISO) preserved for display in output. */
    untilDisplay: string;
    /** "commit" filters by GitHub commits API since/until. "push" uses events API push timestamps. */
    timeSource: "commit" | "push";
    format: "json" | "markdown";
    repos?: string[];
    excludeAuthors?: Set<string>;
    noForks: boolean;
    output?: string;
    patch: boolean;
    patchDir: string;
}

export interface GitHubRepo {
    name: string;
    archived: boolean;
    disabled: boolean;
    fork: boolean;
}

export interface GitHubCommit {
    sha: string;
    commit: {
        message: string;
        author: {
            name: string;
            date: string;
        };
    };
    author: {
        login: string;
    } | null;
}

export interface GitHubPushEvent {
    type: string;
    actor: { login: string };
    payload: {
        ref?: string;
        head?: string;
        before?: string;
    };
    created_at: string;
}

export interface CommitEntry {
    sha: string;
    url: string;
    message: string;
    description: string;
    author: string;
    /** YYYY-MM-DD: commit author date by default, push date when --time-source=push. */
    date: string;
    /** ISO timestamp of the push event; present only when --time-source=push. */
    pushDate?: string;
}

export interface RepoChangelog {
    repo: string;
    commits: CommitEntry[];
}

export interface ChangelogOutput {
    org: string;
    since: string;
    until: string;
    generatedAt: string;
    repos: RepoChangelog[];
}
