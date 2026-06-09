# Agent Code Reviewer

A reusable **GitHub Action** that reviews pull requests with **Claude**. It reads
the PR diff, asks Claude to find issues across four categories, and posts the
results back as **inline comments** on the changed lines plus a single
**summary comment**.

Categories reviewed:

- 🔒 **Security** — injection, auth flaws, secrets, unsafe input handling
- 🐛 **Bugs** — logic errors, null derefs, unhandled errors, bad edge cases
- ⚡ **Performance** — work in loops, N+1 queries, accidental quadratic behavior
- 🎨 **Style** — naming, duplication, dead code, convention violations

## Usage

1. Add your Anthropic API key as a repository secret named `ANTHROPIC_API_KEY`
   (Settings → Secrets and variables → Actions). Get a key at
   <https://console.anthropic.com/>.

2. Add a workflow at `.github/workflows/code-review.yml`:

   ```yaml
   name: Code Review
   on:
     pull_request:
       types: [opened, synchronize, reopened]

   permissions:
     contents: read
     pull-requests: write

   jobs:
     review:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: donglnp/agent-code-reviewer@v1
           with:
             anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
   ```

> `permissions: pull-requests: write` is required so the action can post comments.

## Inputs

| Input               | Required | Default            | Description                                                        |
| ------------------- | -------- | ------------------ | ------------------------------------------------------------------ |
| `anthropic_api_key` | yes      | —                  | Anthropic API key (use a secret).                                  |
| `github_token`      | no       | `${{ github.token }}` | Token used to read the diff and post comments.                  |
| `model`             | no       | `claude-opus-4-8`  | Claude model id.                                                   |
| `effort`            | no       | `high`             | Reasoning effort: `low` \| `medium` \| `high` \| `max`.            |
| `max_diff_chars`    | no       | `200000`           | Diff is truncated past this many characters.                      |
| `exclude`           | no       | `""`               | Comma/newline-separated globs to skip (e.g. `*.lock,dist/**`).     |
| `min_severity`      | no       | `low`              | Lowest severity to report: `info`..`critical`.                    |

## Outputs

| Output          | Description                                  |
| --------------- | -------------------------------------------- |
| `finding_count` | Number of findings posted (after filtering). |

## Development

```bash
npm install
npm run all        # typecheck + bundle into dist/
```

The action runs the bundled `dist/index.js` (node20). **`dist/` is committed** —
run `npm run all` and commit the result whenever you change `src/`. CI fails if
`dist/` is stale.

### Project layout

| File              | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `action.yml`      | Action metadata and inputs.                                   |
| `src/main.ts`     | Entry point: reads inputs, orchestrates the review.           |
| `src/github.ts`   | Fetch PR files, parse diffs, post the review.                 |
| `src/reviewer.ts` | Call Claude with structured output to get findings.           |
| `src/types.ts`    | Shared types.                                                 |

## How it works

1. Fetch every changed file in the PR and its diff patch.
2. Parse each patch to learn which lines GitHub will accept inline comments on.
3. Send the diff to Claude with a structured-output schema, so the response is a
   typed list of findings plus a summary.
4. Post one review: inline comments for findings on changed lines, and a summary
   comment listing the rest.

## License

MIT
