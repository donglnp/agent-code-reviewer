export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = ["security", "bug", "performance", "style"] as const;
export type Category = (typeof CATEGORIES)[number];

/** A single issue Claude reports about the diff. */
export interface Finding {
  /** Repo-relative path of the changed file, e.g. "src/app.ts". */
  path: string;
  /** Line number in the new version of the file the comment applies to. */
  line: number;
  severity: Severity;
  category: Category;
  /** Short one-line headline. */
  title: string;
  /** Full explanation of the problem and why it matters. */
  body: string;
  /** Optional suggested replacement code for the line(s). */
  suggestion?: string;
}

/** The full structured result returned by the model. */
export interface ReviewResult {
  /** Markdown overview of the change and the most important findings. */
  summary: string;
  findings: Finding[];
}

/** A changed file in the PR, with its diff patch. */
export interface ChangedFile {
  path: string;
  patch: string;
  /** Line numbers (new-file side) that GitHub will accept inline comments on. */
  commentableLines: Set<number>;
}
