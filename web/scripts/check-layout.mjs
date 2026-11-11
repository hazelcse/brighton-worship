// Checks the owner's recorded layout measurements (LAYOUT.md, layout-baseline.json) are still in
// the code.
//
//   node web/scripts/check-layout.mjs          report every check; exit 1 if any changed
//   node web/scripts/check-layout.mjs --hook   Claude Code hook: reads the edit from stdin and,
//                                              if it touched a tracked file and a measurement
//                                              changed, tells the owner (and Claude)
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { checks } = JSON.parse(readFileSync(join(root, "web/scripts/layout-baseline.json"), "utf8"));
const norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();

function changed() {
  return checks.filter((c) => {
    try {
      return !readFileSync(join(root, c.file), "utf8").includes(c.snippet);
    } catch {
      return true; // file moved or deleted
    }
  });
}

// Before an edit: work out what the file would look like afterwards, and if a recorded measurement
// would go, ask the owner first (Claude Code shows them the reason and waits for yes or no).
if (process.argv.includes("--pre")) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let e;
  try {
    e = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const t = e.tool_input ?? {};
  const edited = t.file_path ?? "";
  const mine = edited ? checks.filter((c) => norm(join(root, c.file)) === norm(edited)) : [];
  if (!mine.length) process.exit(0);
  let before = "";
  try {
    before = readFileSync(edited, "utf8");
  } catch {}
  const apply = (text, oldS, newS, all) => (all ? text.split(oldS).join(newS) : text.replace(oldS, () => newS));
  let after = before;
  if (e.tool_name === "Write") after = String(t.content ?? "");
  else if (e.tool_name === "Edit") after = apply(before, String(t.old_string ?? ""), String(t.new_string ?? ""), t.replace_all);
  else if (e.tool_name === "MultiEdit") for (const x of t.edits ?? []) after = apply(after, String(x.old_string ?? ""), String(x.new_string ?? ""), x.replace_all);
  else process.exit(0);
  const lost = mine.filter((c) => before.includes(c.snippet) && !after.includes(c.snippet));
  if (!lost.length) process.exit(0);
  const list = lost.map((c) => `${c.name}: ${c.means}`).join("; ");
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `This edit would change a recorded layout (LAYOUT.md / PAGE-LAYOUTS.md): ${list}. Allow it only if you want this change.`,
      },
    }),
  );
  process.exit(0);
}

if (process.argv.includes("--hook")) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let edited = "";
  try {
    const e = JSON.parse(input);
    edited = e.tool_input?.file_path ?? e.tool_response?.filePath ?? "";
  } catch {}
  const tracked = new Set(checks.map((c) => norm(join(root, c.file))));
  if (!edited || !tracked.has(norm(edited))) process.exit(0);
  const bad = changed().filter((c) => norm(join(root, c.file)) === norm(edited));
  if (!bad.length) process.exit(0);
  const list = bad.map((c) => `${c.name} (${c.file}): was ${c.means}`).join("; ");
  console.log(
    JSON.stringify({
      systemMessage: `Layout measurement changed: ${list}. See LAYOUT.md.`,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `This edit changed a recorded layout measurement (LAYOUT.md): ${list}. Unless the owner asked for this exact change, undo it; either way say so plainly in your reply.`,
      },
    }),
  );
  process.exit(0);
}

const bad = changed();
for (const c of checks) console.log(`${bad.includes(c) ? "CHANGED" : "ok     "}  ${c.name}  (${c.means})`);
process.exit(bad.length ? 1 : 0);
