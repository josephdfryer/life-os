#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = run("git", ["-C", __dirname, "rev-parse", "--show-toplevel"]) || join(__dirname, "..");
const syncDir = join(repoRoot, ".agent-sync");
const activityPath = join(syncDir, "activity.md");
const maxLogLines = 24;

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd || repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function git(args) {
  return run("git", args);
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const next = argv[i + 1];

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function ensureSyncDir() {
  mkdirSync(syncDir, { recursive: true });
}

// Minimal .env reader so this script can pick up LINEAR_API_KEY without
// pulling in a dependency — root scripts must run in bare-node environments.
function loadDotEnvValue(key) {
  if (process.env[key]) {
    return process.env[key];
  }

  for (const filename of [".env.local", ".env"]) {
    const envPath = join(repoRoot, filename);
    if (!existsSync(envPath)) {
      continue;
    }

    const line = readFileSync(envPath, "utf8")
      .split("\n")
      .find((row) => row.trim().startsWith(`${key}=`));
    if (line) {
      return line
        .slice(line.indexOf("=") + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }

  return undefined;
}

function findIssueKey(...sources) {
  for (const source of sources) {
    const match = String(source || "").match(/\b([A-Za-z]{2,10}-\d+)\b/);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return undefined;
}

async function linearGraphQL(apiKey, query, variables) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(json.errors ? JSON.stringify(json.errors) : `HTTP ${res.status}`);
  }
  return json.data;
}

// Posts the handoff as a durable Linear comment so it survives past this
// machine's gitignored .agent-sync/ cache — every agent gets one code path,
// not just the one with native Linear MCP access.
async function postLinearHandoff({ agent, command, summary, next, issue }) {
  const apiKey = loadDotEnvValue("LINEAR_API_KEY");
  const issueKey = issue || findIssueKey(getBranch());

  if (!apiKey) {
    return { posted: false, reason: "LINEAR_API_KEY not set (checked env, .env.local, .env) — skipping Linear comment." };
  }
  if (!issueKey) {
    return { posted: false, reason: "No issue key found in branch name and no --issue given — skipping Linear comment." };
  }

  const body = [
    `**${command === "started" ? "Starting" : "Handoff"} — ${agent}**`,
    "",
    summary ? summary : "_No summary provided._",
    next ? `\nNext: ${next}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    const data = await linearGraphQL(
      apiKey,
      `query($id: String!) { issue(id: $id) { id } }`,
      { id: issueKey },
    );
    const issueId = data?.issue?.id;
    if (!issueId) {
      return { posted: false, reason: `Linear issue ${issueKey} not found.` };
    }

    await linearGraphQL(
      apiKey,
      `mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }`,
      { issueId, body },
    );
    return { posted: true, issueKey };
  } catch (error) {
    return { posted: false, reason: `Linear comment failed: ${error.message}` };
  }
}

function statePath(agent) {
  return join(syncDir, `${agent}.json`);
}

function readJson(path) {
  if (!existsSync(path)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function getStatus() {
  return git(["status", "--short", "--branch"]);
}

function getStatusHash(status) {
  return createHash("sha256").update(status).digest("hex");
}

function getHead() {
  return git(["rev-parse", "HEAD"]) || "unknown";
}

function getBranch() {
  return git(["branch", "--show-current"]) || "(detached)";
}

function getUpstream() {
  return git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
}

function getDivergence() {
  const upstream = getUpstream();
  if (!upstream) {
    return "No upstream configured.";
  }

  const counts = git(["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
  if (!counts) {
    return `Could not compare with ${upstream}.`;
  }

  const [ahead, behind] = counts.split(/\s+/);
  return `${upstream}: ahead ${ahead}, behind ${behind}`;
}

function getRecentCommits(range) {
  const args = ["log", "--oneline", "--decorate", `--max-count=${maxLogLines}`];
  if (range) {
    args.splice(1, 0, range);
  }

  return git(args);
}

function getChangedFiles() {
  const status = git(["status", "--short"]);
  if (!status) {
    return "Clean worktree.";
  }

  return status
    .split("\n")
    .slice(0, maxLogLines)
    .join("\n");
}

function getDiffStat() {
  const unstaged = git(["diff", "--stat"]);
  const staged = git(["diff", "--cached", "--stat"]);

  return [staged && `Staged:\n${staged}`, unstaged && `Unstaged:\n${unstaged}`].filter(Boolean).join("\n\n");
}

function readActivityTail() {
  if (!existsSync(activityPath)) {
    return "No local handoffs yet.";
  }

  return readFileSync(activityPath, "utf8")
    .trim()
    .split("\n")
    .slice(-80)
    .join("\n");
}

function buildBrief(agent, state) {
  const head = getHead();
  const branch = getBranch();
  const status = getStatus();
  const statusHash = getStatusHash(status);
  const previousHead = state.lastSeenHead;
  const previousStatusHash = state.lastStatusHash;
  const commitsSinceSeen =
    previousHead && previousHead !== head
      ? getRecentCommits(`${previousHead}..HEAD`) || "No commits found in range. The previous commit may have been rebased away."
      : "No new local commits since this agent last checked in.";
  let statusChange = "No previous worktree snapshot for this agent.";
  if (previousStatusHash) {
    statusChange =
      previousStatusHash !== statusHash
        ? "Worktree status changed since this agent last checked in."
        : "Worktree status matches this agent's last check-in.";
  }
  const diffStat = getDiffStat();

  return {
    head,
    branch,
    status,
    statusHash,
    text: [
      `# Agent Sync Brief (${agent})`,
      "",
      `Repo: ${repoRoot}`,
      `Branch: ${branch}`,
      `HEAD: ${head}`,
      `Upstream: ${getDivergence()}`,
      "",
      "## Since This Agent Last Checked In",
      commitsSinceSeen,
      "",
      "## Worktree",
      statusChange,
      "",
      getChangedFiles(),
      diffStat ? `\nDiff stat:\n${diffStat}` : "",
      "",
      "## Recent Commits",
      getRecentCommits() || "No commits found.",
      "",
      "## Recent Local Handoffs",
      readActivityTail(),
      "",
    ]
      .filter((line) => line !== false)
      .join("\n"),
  };
}

function recordActivity({ agent, command, summary, next }) {
  const now = new Date().toISOString();
  const head = getHead();
  const branch = getBranch();
  const changedFiles = getChangedFiles();
  const entry = [
    `## ${now} - ${agent} ${command}`,
    "",
    `Branch: ${branch}`,
    `HEAD: ${head}`,
    "",
    summary ? `Summary: ${summary}` : "Summary: No summary provided.",
    next ? `Next: ${next}` : "",
    "",
    "Changed files:",
    "```",
    changedFiles,
    "```",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const previous = existsSync(activityPath) ? readFileSync(activityPath, "utf8") : "# Agent Activity\n\n";
  writeFileSync(activityPath, `${previous.trimEnd()}\n\n${entry}`);
}

function saveState(agent, state, brief) {
  writeJson(statePath(agent), {
    ...state,
    agent,
    lastSeenAt: new Date().toISOString(),
    lastSeenHead: brief.head,
    lastSeenBranch: brief.branch,
    lastStatusHash: brief.statusHash,
    lastStatus: brief.status,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "status";
  const agent = String(args.agent || process.env.AGENT || process.env.USER || "agent").toLowerCase();

  ensureSyncDir();

  if (args.fetch) {
    git(["fetch", "--prune"]);
  }

  const path = statePath(agent);
  const state = readJson(path);
  const brief = buildBrief(agent, state);

  if (command === "start") {
    saveState(agent, state, brief);
    recordActivity({ agent, command: "started", summary: args.summary, next: args.next });
    if (args.summary || args.next) {
      const result = await postLinearHandoff({ agent, command: "started", summary: args.summary, next: args.next, issue: args.issue });
      console.log(result.posted ? `Posted start note to Linear ${result.issueKey}.` : result.reason);
    }
    console.log(brief.text);
    return;
  }

  if (command === "finish" || command === "checkpoint") {
    recordActivity({ agent, command: "finished", summary: args.summary, next: args.next });
    saveState(agent, state, brief);
    console.log(`Recorded ${agent} handoff in .agent-sync/activity.md`);
    const result = await postLinearHandoff({ agent, command: "finished", summary: args.summary, next: args.next, issue: args.issue });
    console.log(result.posted ? `Posted handoff to Linear ${result.issueKey}.` : result.reason);
    console.log("");
    console.log(brief.text);
    return;
  }

  if (command === "status") {
    console.log(brief.text);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Use start, finish, checkpoint, or status.");
  process.exitCode = 1;
}

main();
