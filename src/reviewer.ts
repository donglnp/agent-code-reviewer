import Anthropic from "@anthropic-ai/sdk";
import {
  CATEGORIES,
  SEVERITIES,
  type ChangedFile,
  type ReviewResult,
} from "./types.js";

export interface ReviewOptions {
  apiKey: string;
  model: string;
  effort: string;
  maxDiffChars: number;
}

const SYSTEM_PROMPT = `You are a senior software engineer reviewing a GitHub pull request.

Review the diff for issues in these categories:
- security: injection, auth/authorization flaws, secrets in code, unsafe deserialization, SSRF, path traversal, missing input validation.
- bug: logic errors, off-by-one, null/undefined dereferences, unhandled errors, race conditions, incorrect edge-case handling, broken control flow.
- performance: needless work in loops, N+1 queries, unbounded memory growth, blocking I/O on hot paths, accidental quadratic behavior.
- style: naming, dead code, duplication, unclear structure, missing error handling for cases that can occur, violations of the surrounding code's conventions.

Rules:
- Only comment on lines that the diff actually adds or changes. Use the line number from the NEW version of the file (the "+" side of the hunk).
- Report every issue you find, including low-confidence and low-severity ones; a downstream filter ranks them. Do not silently drop a finding.
- Be specific and actionable. When a concrete fix fits on the affected line(s), include it in "suggestion" as the exact replacement code (no diff markers, no surrounding lines).
- Do not invent problems. If the diff is clean, return an empty findings array and say so in the summary.
- Keep "body" concise: what is wrong, why it matters, and how to fix it.
- Write the summary as short markdown: one or two sentences on the change, then the most important findings.`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Markdown overview of the change and the key findings.",
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repo-relative file path." },
          line: {
            type: "integer",
            description: "Line number in the new version of the file.",
          },
          severity: { type: "string", enum: [...SEVERITIES] },
          category: { type: "string", enum: [...CATEGORIES] },
          title: { type: "string", description: "Short headline." },
          body: { type: "string", description: "Explanation and fix." },
          suggestion: {
            type: "string",
            description: "Optional exact replacement code for the line(s).",
          },
        },
        required: ["path", "line", "severity", "category", "title", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "findings"],
  additionalProperties: false,
} as const;

function buildDiffText(files: ChangedFile[], maxChars: number): string {
  let out = "";
  let truncated = false;
  for (const f of files) {
    const block = `\n### File: ${f.path}\n\`\`\`diff\n${f.patch}\n\`\`\`\n`;
    if (out.length + block.length > maxChars) {
      truncated = true;
      break;
    }
    out += block;
  }
  if (truncated) {
    out += `\n[Diff truncated at ${maxChars} characters — some files were omitted.]\n`;
  }
  return out;
}

export async function reviewDiff(
  files: ChangedFile[],
  opts: ReviewOptions,
): Promise<ReviewResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const diffText = buildDiffText(files, opts.maxDiffChars);

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: opts.effort as "low" | "medium" | "high" | "max",
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Review the following pull request diff.\n${diffText}`,
      },
    ],
  });

  // output_config.format guarantees the first text block is valid JSON.
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Model returned no text content to parse.");
  }
  return JSON.parse(text.text) as ReviewResult;
}
