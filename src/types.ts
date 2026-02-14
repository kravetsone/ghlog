export interface CliOptions {
    org: string;
    since: string;
    until: string;
    format: "json" | "markdown";
    repos?: string[];
    output?: string;
    patch: boolean;
    patchDir: string;
}

export interface GitHubRepo {
    name: string;
    archived: boolean;
    disabled: boolean;
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

export interface CommitEntry {
    sha: string;
    message: string;
    description: string;
    author: string;
    date: string;
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
