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

        const repoUrl = `https://github.com/${data.org}/${repo.repo}`;
        lines.push(
            `### [${repo.repo}](${repoUrl}) (${repo.commits.length} commits)`,
        );
        for (const commit of repo.commits) {
            const sha = commit.sha.slice(0, 7);
            lines.push(
                `- [\`${sha}\`](${commit.url}) ${commit.message} (@${commit.author}, ${commit.date})`,
            );
            if (commit.description) {
                lines.push("");
                for (const line of commit.description.split(/\r?\n/)) {
                    lines.push(`  ${line}`);
                }
                lines.push("");
            }
        }
        lines.push("");
    }

    return lines.join("\n");
}
