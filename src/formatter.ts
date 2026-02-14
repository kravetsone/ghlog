import type { ChangelogOutput } from "./types.ts";

export function formatJSON(data: ChangelogOutput): string {
    return JSON.stringify(data, null, 2);
}

export function formatMarkdown(data: ChangelogOutput): string {
    const lines: string[] = [];

    lines.push(`# Changelog: ${data.org}`);
    lines.push(`## Period: ${data.since} to ${data.until}`);
    lines.push("");

    for (const repo of data.repos) {
        if (repo.commits.length === 0) continue;

        lines.push(`### ${repo.repo} (${repo.commits.length} commits)`);
        for (const commit of repo.commits) {
            const sha = commit.sha.slice(0, 7);
            lines.push(
                `- \`${sha}\` ${commit.message} (@${commit.author}, ${commit.date})`,
            );
        }
        lines.push("");
    }

    return lines.join("\n");
}
