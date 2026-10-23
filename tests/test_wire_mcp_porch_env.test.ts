import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

const SCRIPT = join(import.meta.dir, "..", "scripts", "wire-mcp.py");

/**
 * Execute only the `write_porch_env` function source (not the whole module), so
 * the check also runs on the system python3 (3.9) where other module-level
 * `X | None` annotations would fail at import.
 */
function writePorchEnv(home: string, token: string): void {
  const code = `
import ast, pathlib, stat
script = ${JSON.stringify(SCRIPT)}
src = pathlib.Path(script).read_text()
tree = ast.parse(src)
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "write_porch_env")
ns = {"HOME": pathlib.Path(${JSON.stringify(home)}), "stat": stat}
exec(compile(ast.Module(body=[fn], type_ignores=[]), script, "exec"), ns)
ns["write_porch_env"](${JSON.stringify(token)})
`;
  const result = spawnSync("python3", ["-c", code], { encoding: "utf-8" });
  expect(result.status, result.stderr).toBe(0);
}

test("write_porch_env exports the token", () => {
  const home = mkdtempSync(join(tmpdir(), "porch-env-"));
  writePorchEnv(home, "tok-123");

  const envPath = join(home, ".config", "porch", "mcp.env");
  const content = readFileSync(envPath, "utf-8");
  expect(content.startsWith("export PORCH_MCP_TOKEN=")).toBe(true);
  expect(content).toContain("export PORCH_MCP_TOKEN=tok-123");
  expect(statSync(envPath).mode & 0o777).toBe(0o600);
});
