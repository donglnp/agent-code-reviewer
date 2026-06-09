#!/usr/bin/env node
// Local code reviewer — collects a git diff and pipes it to the `claude` CLI
// (your Claude Pro/Max subscription) for review. No API key / credits needed.
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const HELP = `
review — review your code changes locally with Claude (uses the \`claude\` CLI)

Usage:
  review [options]

Modes (pick one; default = diff vs base branch, like reviewing a PR):
  -w, --working        Review uncommitted changes (git diff HEAD)
      --staged         Review only staged changes (git diff --cached)
  -b, --base <ref>     Base branch/ref to diff against (default: main or master)

Other:
  -m, --model <id>     Pass a specific model to the claude CLI
  -h, --help           Show this help

Examples:
  review                       # review current branch vs main/master
  review -w                    # review what you're editing right now
  review -b develop            # review current branch vs develop
`;

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8" });
}

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function detectBase() {
  for (const b of ["main", "master"]) {
    if (run("git", ["rev-parse", "--verify", "--quiet", b]).status === 0) {
      return b;
    }
  }
  return null;
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      working: { type: "boolean", short: "w" },
      staged: { type: "boolean" },
      base: { type: "string", short: "b" },
      model: { type: "string", short: "m" },
      help: { type: "boolean", short: "h" },
    },
  }));
} catch (e) {
  fail(e.message);
}

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

// Must be inside a git repo.
if (run("git", ["rev-parse", "--is-inside-work-tree"]).status !== 0) {
  fail("Not a git repository.");
}

// The `claude` CLI must be installed and logged in.
if (run("claude", ["--version"]).status !== 0) {
  fail(
    "The `claude` CLI was not found. Install Claude Code and run `claude` once to log in:\n" +
      "  https://docs.claude.com/en/docs/claude-code/overview",
  );
}

// Decide what to diff.
let diffArgs;
let label;
if (values.working) {
  diffArgs = ["diff", "HEAD"];
  label = "uncommitted changes (vs HEAD)";
} else if (values.staged) {
  diffArgs = ["diff", "--cached"];
  label = "staged changes";
} else {
  const base = values.base || detectBase();
  if (!base) {
    fail(
      "Could not find a base branch (main/master). Pass one with --base <ref>, or use -w for uncommitted changes.",
    );
  }
  diffArgs = ["diff", `${base}...HEAD`];
  label = `current branch vs ${base}`;
}

const diffResult = run("git", diffArgs);
if (diffResult.status !== 0) {
  fail(`git ${diffArgs.join(" ")} failed:\n${diffResult.stderr}`);
}
const diff = diffResult.stdout;

if (!diff.trim()) {
  console.log(`✓ No changes to review (${label}).`);
  process.exit(0);
}

console.error(`Reviewing ${label} — ${diff.split("\n").length} diff lines…\n`);

const prompt = `Bạn là một senior software engineer đang review code. Dưới đây là một git diff (đọc từ stdin).

Hãy review kỹ và tìm vấn đề thuộc 4 nhóm:
- Bảo mật: injection, lỗ hổng xác thực/phân quyền, secret lộ trong code, input không kiểm tra.
- Bug: lỗi logic, off-by-one, null/undefined, lỗi không xử lý, edge case sai, race condition.
- Hiệu năng: việc thừa trong vòng lặp, N+1 query, tốn bộ nhớ, độ phức tạp xấu.
- Style: đặt tên, code chết, trùng lặp, cấu trúc khó hiểu, không theo quy ước xung quanh.

Quy tắc:
- Chỉ nhận xét những dòng diff thực sự thêm/sửa.
- Mỗi vấn đề ghi: \`file:dòng\` · mức độ (cao/trung bình/thấp) · mô tả ngắn gọn vì sao sai và cách sửa.
- Báo cả vấn đề nhỏ; đừng tự ý bỏ qua.
- Nếu diff sạch, nói rõ "Không phát hiện vấn đề".
- Trả lời hoàn toàn bằng tiếng Việt, ngắn gọn, đi thẳng vào vấn đề.`;

const claudeArgs = ["-p", prompt];
if (values.model) claudeArgs.push("--model", values.model);

const child = spawn("claude", claudeArgs, {
  stdio: ["pipe", "inherit", "inherit"],
});
child.stdin.write(diff);
child.stdin.end();
child.on("error", (e) => fail(`Failed to run claude: ${e.message}`));
child.on("exit", (code) => process.exit(code ?? 0));
