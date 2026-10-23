import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dir, "..");
const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
if (listed.status !== 0) throw new Error("Cannot inspect tracked public files");
const paths = listed.stdout.split("\0").filter(Boolean);
if (!paths.length) throw new Error("No tracked files to check; stage the release first");
const forbiddenPath = /(^|\/)(projects|\.local|\.scratch|secrets|__pycache__|node_modules)(\/|$)|(^|\/)LOCAL\.md$|(^|\/)\.env(?:\..*)?$|(?:-ledger\.jsonl|\.pyc|\.tgz|\.zip)$|(^|\/)(auth\.json|\.credentials\.json|mcp\.env)$/;
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];
// binaries reviewed by hand, pinned by sha256 so any change needs a new review.
const reviewedBinaries: Record<string, string> = {
  ".github/assets/banner.png": "755e22ecc84918bea01cb92fde6106667c7f3b17fd3db4a958d4a306477ece35",
};
const failures: string[] = [];
for (const path of paths) {
  if (forbiddenPath.test(path) && !path.endsWith("/.env.example")) failures.push(`${path}: private state path`);
  const content = readFileSync(resolve(root, path));
  if (content.includes(0) && reviewedBinaries[path] !== createHash("sha256").update(content).digest("hex")) {
    failures.push(`${path}: binary content requires explicit review`);
  }
  const text = content.toString("utf8");
  if (credentialPatterns.some((pattern) => pattern.test(text))) failures.push(`${path}: credential pattern`);
  if (/\b(?:[a-z0-9-]+\.)?tail[a-z0-9]+\.ts\.net\b/i.test(text)) failures.push(`${path}: private tailnet hostname`);
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(`Public-content checks passed for ${paths.length} tracked text files.`);
console.log("Pattern checks supplement manual review; they do not prove that content is nonconfidential.");
