import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
process.env.CLAUDE_MD_DIR = root;
const generators = await import("../src/generators.ts");
const { writeText } = await import("../src/lib.ts");

for (const generate of [
  generators.generatedCodexAgentsMd,
  generators.generatedCursorRule,
  generators.generatedOpencodeAgentsMd,
]) {
  const [target, body] = generate();
  writeText(target, body);
}
generators.agentReflectApply();
generators.cursorAgentReflectApply();
generators.opencodeAgentReflectApply();
generators.renderGrokDoctrine();
generators.renderMuseDoctrine();

for (const [source, fixture] of [
  ["codex/AGENTS.md", "AGENTS.md"],
  ["cursor/rules/doctrine.mdc", "doctrine.mdc"],
  ["opencode/AGENTS.md", "opencode-AGENTS.md"],
]) {
  copyFileSync(resolve(root, source), resolve(root, "tests/fixtures/generators", fixture));
}
console.log("Generated host doctrine, role adapters, and text fixtures locally.");
