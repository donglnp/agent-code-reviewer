import * as github from "@actions/github";
import type { ChangedFile, Finding } from "./types.js";

type Octokit = ReturnType<typeof github.getOctokit>;

export interface PrContext {
  octokit: Octokit;
  owner: string;
  repo: string;
  pull_number: number;
  /** Head commit SHA — required when posting a review. */
  head_sha: string;
}

/**
 * Resolve the PR being reviewed. Order of precedence for the PR number:
 *   1. explicit `pr_number` input (manual / comment triggers)
 *   2. the `pull_request` event payload
 *   3. an `issue_comment` event on a PR
 */
export async function getPrContext(
  token: string,
  explicitPrNumber?: number,
): Promise<PrContext> {
  const { context } = github;
  const octokit = github.getOctokit(token);
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  let pull_number = explicitPrNumber;
  if (!pull_number && context.payload.pull_request) {
    pull_number = context.payload.pull_request.number;
  }
  if (!pull_number && context.payload.issue?.pull_request) {
    pull_number = context.payload.issue.number;
  }
  if (!pull_number) {
    throw new Error(
      "No pull request to review. Provide `pr_number`, or run on a `pull_request` event or a `/review` comment on a PR.",
    );
  }

  // The head SHA is on the pull_request payload; otherwise fetch it.
  let head_sha = context.payload.pull_request?.head?.sha as string | undefined;
  if (!head_sha) {
    const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number });
    head_sha = data.head.sha;
  }

  return { octokit, owner, repo, pull_number, head_sha };
}

/**
 * Parse a unified-diff patch and collect the new-file line numbers that were
 * added. GitHub only accepts inline review comments on lines that are part of
 * the diff, so this is the set we can attach comments to.
 */
export function parseCommentableLines(patch: string): Set<number> {
  const lines = new Set<number>();
  if (!patch) return lines;

  let newLine = 0;
  for (const row of patch.split("\n")) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      continue;
    }
    if (row.startsWith("+")) {
      lines.add(newLine);
      newLine++;
    } else if (row.startsWith("-")) {
      // removed line — does not advance the new-file counter
    } else {
      // context line
      newLine++;
    }
  }
  return lines;
}

/** Fetch every changed file in the PR along with its patch (auto-paginated). */
export async function getChangedFiles(
  ctx: PrContext,
  isExcluded: (path: string) => boolean,
): Promise<ChangedFile[]> {
  const files = await ctx.octokit.paginate(ctx.octokit.rest.pulls.listFiles, {
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pull_number,
    per_page: 100,
  });

  const changed: ChangedFile[] = [];
  for (const f of files) {
    if (f.status === "removed") continue;
    if (!f.patch) continue; // binary files / files too large have no patch
    if (isExcluded(f.filename)) continue;
    changed.push({
      path: f.filename,
      patch: f.patch,
      commentableLines: parseCommentableLines(f.patch),
    });
  }
  return changed;
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "⚪",
};

function renderFinding(f: Finding): string {
  const emoji = SEVERITY_EMOJI[f.severity] ?? "•";
  let md = `${emoji} **[${f.category} · ${f.severity}] ${f.title}**\n\n${f.body}`;
  if (f.suggestion) {
    md += `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``;
  }
  return md;
}

/**
 * Post a single review containing inline comments (for findings on commentable
 * lines) plus a summary body. Findings that don't map to a commentable line are
 * appended to the summary so nothing is lost.
 */
export async function postReview(
  ctx: PrContext,
  summary: string,
  findings: Finding[],
  changedFiles: ChangedFile[],
): Promise<void> {
  const lineIndex = new Map<string, Set<number>>();
  for (const f of changedFiles) lineIndex.set(f.path, f.commentableLines);

  const inlineComments: { path: string; line: number; side: "RIGHT"; body: string }[] = [];
  const orphanFindings: Finding[] = [];

  for (const f of findings) {
    if (lineIndex.get(f.path)?.has(f.line)) {
      inlineComments.push({
        path: f.path,
        line: f.line,
        side: "RIGHT",
        body: renderFinding(f),
      });
    } else {
      orphanFindings.push(f);
    }
  }

  const body = buildSummaryBody(summary, findings, orphanFindings);

  await ctx.octokit.rest.pulls.createReview({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pull_number,
    commit_id: ctx.head_sha,
    event: "COMMENT",
    body,
    comments: inlineComments,
  });
}

function buildSummaryBody(
  summary: string,
  allFindings: Finding[],
  orphanFindings: Finding[],
): string {
  const counts = allFindings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const order = ["critical", "high", "medium", "low", "info"];
  const countLine = order
    .filter((s) => counts[s])
    .map((s) => `${SEVERITY_EMOJI[s]} ${counts[s]} ${s}`)
    .join(" · ");

  let body = `## 🤖 Claude Code Review\n\n`;
  body += summary.trim() + "\n\n";
  if (allFindings.length === 0) {
    body += "✅ No issues found.\n";
  } else {
    body += `**${allFindings.length} finding(s):** ${countLine}\n`;
  }

  if (orphanFindings.length > 0) {
    body += `\n<details><summary>📋 Findings outside the diff (${orphanFindings.length})</summary>\n\n`;
    for (const f of orphanFindings) {
      body += `- ${renderFinding(f).replace(/\n+/g, " ")} — \`${f.path}:${f.line}\`\n`;
    }
    body += `\n</details>\n`;
  }

  body += `\n<sub>Reviewed by Agent Code Reviewer · powered by Claude</sub>`;
  return body;
}
