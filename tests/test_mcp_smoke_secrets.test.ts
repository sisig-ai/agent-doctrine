import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function waitFor(path: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (existsSync(path)) return;
    await Bun.sleep(25);
  }
  throw new Error(`timed out waiting for ${path}`);
}

test("mcp smoke keeps bearer values out of curl argv and output", async () => {
  if (!existsSync("/proc/self/cmdline")) return;
  const root = mkdtempSync(join(tmpdir(), "mcp-secret-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  mkdirSync(join(home, ".cursor"), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".config", "opencode"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(home, ".cursor", "mcp.json"), '{"mcpServers":{"semble":{}}}\n');
  writeFileSync(join(home, ".claude", "settings.json"), '{"mcpServers":{"semble":{}}}\n');
  writeFileSync(join(home, ".config", "opencode", "opencode.json"), '{"mcp":{"servers":{"semble":{}}}}\n');

  writeFileSync(join(bin, "semble"), "#!/usr/bin/env bash\n[[ \"${1:-}\" == --help ]]\n");
  writeFileSync(join(bin, "opencode"), "#!/usr/bin/env bash\necho semble\n");
  const fakeCurl = join(bin, "fake-curl");
  writeFileSync(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
root="${root}"
config="$(cat)"
if grep -q porch.sh <<<"$config"; then n=2; else n=1; fi
printf '%s' "$$" >"$root/pid-$n"
while [[ ! -e "$root/release-$n" ]]; do sleep 0.02; done
if [[ "$n" == 2 ]]; then printf '%s' '{"result":{"tools":[{"name":"vault_search"},{"name":"vault_save"}]}}'; fi
`,
  );
  for (const path of [join(bin, "semble"), join(bin, "opencode"), fakeCurl]) chmodSync(path, 0o755);

  const honcho = "honcho-canary-secret";
  const porch = "porch-canary-secret";
  const proc = Bun.spawn([join(import.meta.dir, "..", "scripts", "mcp-smoke.sh")], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      MCP_SMOKE_CURL_BIN: fakeCurl,
      HONCHO_API_KEY: honcho,
      HONCHO_WORKSPACE: "workspace",
      PORCH_MCP_TOKEN: porch,
      OPENCODE_MD_TARGET: join(home, ".config", "opencode"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  for (const n of [1, 2]) {
    const pidFile = join(root, `pid-${n}`);
    await waitFor(pidFile);
    const pid = readFileSync(pidFile, "utf-8");
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    expect(cmdline).not.toContain(honcho);
    expect(cmdline).not.toContain(porch);
    writeFileSync(join(root, `release-${n}`), "");
  }

  const [status, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  expect(status, `${stdout}\n${stderr}`).toBe(0);
  expect(stdout).not.toContain(honcho);
  expect(stdout).not.toContain(porch);
  expect(stderr).not.toContain(honcho);
  expect(stderr).not.toContain(porch);
}, 30_000);
