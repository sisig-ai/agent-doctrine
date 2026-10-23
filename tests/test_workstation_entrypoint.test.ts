import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(path, 0o755);
}

const hasDocker = spawnSync("docker", ["info"], { timeout: 10_000 }).status === 0;

test.skipIf(!hasDocker)("entrypoint wires doctrine with honcho env and starts the opencode service", () => {

  const root = mkdtempSync(join(tmpdir(), "workstation-entrypoint-"));
  const bin = join(root, "bin");
  const source = join(root, "source");
  const secrets = join(root, "secrets");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(source, "workstation"), { recursive: true });
  mkdirSync(join(source, "scripts"), { recursive: true });
  mkdirSync(secrets, { recursive: true });
  writeFileSync(join(source, "workstation", "portable-LOCAL.md"), "# test\n");
  writeFileSync(join(secrets, "honcho_api_key"), "honcho-test");
  writeFileSync(join(secrets, "porch_mcp_token"), "porch-test");
  writeFileSync(join(secrets, "cliproxy_api_key"), "cliproxy-secret");

  executable(join(bin, "chown"), "exit 0");
  executable(join(bin, "docker"), '[[ "${1:-}" == info ]]');
  executable(join(bin, "dockerd"), "while true; do sleep 60; done");
  executable(
    join(bin, "tailscaled"),
    "python3 -c 'import socket,time; s=socket.socket(socket.AF_UNIX); s.bind(\"/var/run/tailscale/tailscaled.sock\"); s.listen(); time.sleep(60)'",
  );
  executable(
    join(bin, "tailscale"),
    'if [[ "${1:-}" == status ]]; then printf \'%s\\n\' \'{"BackendState":"Running"}\'; else exit 0; fi',
  );
  executable(
    join(bin, "runuser"),
    'while [[ "$#" -gt 0 && "$1" != -- ]]; do shift; done; shift; exec "$@"',
  );
  // `bun <file>` runs the doctrine .ts stubs as bash; the container has no real bun.
  executable(join(bin, "bun"), 'exec bash "$@"');
  // OpenCode V2 stub: `service set ...`, `serve --service` (opens port 4096), `--version`.
  executable(
    join(bin, "opencode"),
    `if [[ "\${1:-}" == service ]]; then
  echo "opencode-service-\${2:-}"
  exit 0
fi
if [[ "\${1:-}" == --version ]]; then
  echo "2.0.24"
  exit 0
fi
if [[ "\${1:-}" == serve ]]; then
  echo "opencode-serve-started"
  exec python3 -c 'import socket,time
s=socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("0.0.0.0", 4096))
s.listen()
time.sleep(120)'
fi
exit 0`,
  );

  executable(
    join(source, "sync.sh"),
    `[[ "\${1:-}" == apply-snapshot ]]
env -u HONCHO_API_KEY -u PORCH_MCP_TOKEN -u HONCHO_WORKSPACE -u HONCHO_PEER_NAME bash -c '
  source /etc/profile.d/workstation-secrets.sh
  [[ "$HONCHO_API_KEY" == honcho-test ]] || { echo "honcho key mismatch" >&2; exit 11; }
  [[ "$PORCH_MCP_TOKEN" == porch-test ]] || { echo "porch token mismatch" >&2; exit 12; }
  [[ "$HONCHO_WORKSPACE" == "workspace with spaces; false" ]] || { echo "workspace mismatch" >&2; exit 13; }
  [[ "$HONCHO_PEER_NAME" == "peer with spaces" ]] || { echo "peer mismatch" >&2; exit 14; }
  [[ "$CLIPROXY_BASE_URL" == "http://127.0.0.1:8317/v1" ]] || { echo "cliproxy base mismatch" >&2; exit 15; }
  [[ "$CLIPROXY_API_KEY" == "cliproxy-secret" ]] || { echo "cliproxy key mismatch" >&2; exit 16; }
'
echo "profile-environment-loaded"
echo "apply-snapshot-called"`,
  );

  writeFileSync(
    join(source, "scripts", "wire-mcp.py"),
    `import os
assert os.environ.get("HONCHO_API_KEY") == "honcho-test"
assert os.environ.get("PORCH_MCP_TOKEN") == "porch-test"
assert os.environ.get("HONCHO_WORKSPACE") == "workspace with spaces; false"
assert os.environ.get("HONCHO_PEER_NAME") == "peer with spaces"
print("wire-mcp-called")
`,
  );

  executable(
    join(source, "scripts", "wire-opencode-mcp.ts"),
    `[[ "$HONCHO_WORKSPACE" == "workspace with spaces; false" ]] || { echo "workspace missing at opencode mcp" >&2; exit 21; }
[[ "$HONCHO_PEER_NAME" == "peer with spaces" ]] || { echo "peer missing at opencode mcp" >&2; exit 22; }
echo "wire-opencode-mcp-called"`,
  );

  executable(
    join(source, "scripts", "wire-opencode-provider.ts"),
    `[[ "\${CLIPROXY_BASE_URL:-}" == "http://127.0.0.1:8317/v1" ]] || { echo "cliproxy base missing" >&2; exit 23; }
[[ "\${CLIPROXY_API_KEY:-}" == "cliproxy-secret" ]] || { echo "cliproxy key missing" >&2; exit 24; }
echo "wire-opencode-provider-called"`,
  );

  executable(join(source, "scripts", "mcp-smoke.sh"), 'echo "mcp-smoke-called"');

  const entrypoint = join(import.meta.dir, "..", "workstation", "entrypoint.sh");
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-e", "PATH=/stubs:/usr/local/bin:/usr/bin:/bin",
      "-e", "HONCHO_WORKSPACE=workspace with spaces; false",
      "-e", "HONCHO_PEER_NAME=peer with spaces",
      "-e", "WORKSTATION_HOSTNAME=entrypoint-test",
      "-e", "CLIPROXY_BASE_URL=http://127.0.0.1:8317/v1",
      "-e", "OPENCODE_SERVER_PASSWORD=fixture-only-password",
      "-v", `${entrypoint}:/entrypoint.sh:ro`,
      "-v", `${bin}:/stubs:ro`,
      "-v", `${source}:/opt/claude-md:ro`,
      "-v", `${secrets}:/run/secrets:ro`,
      "python:3.13-slim",
      "bash",
      "-c",
      "mkdir -p /etc/profile.d /home/coder/.local/bin /home/coder/.claude; touch /home/coder/.claude/LOCAL.md; cp /stubs/opencode /home/coder/.local/bin/opencode; chmod +x /home/coder/.local/bin/opencode; exec bash /entrypoint.sh",
    ],
    { encoding: "utf-8", timeout: 120_000 },
  );

  const output = `${result.stdout}\n${result.stderr}`;
  expect(result.status, output).toBe(1);
  expect(result.stdout).toContain("profile-environment-loaded");
  expect(result.stdout).toContain("apply-snapshot-called");
  expect(result.stdout).toContain("wire-mcp-called");
  expect(result.stdout).toContain("wire-opencode-mcp-called");
  expect(result.stdout).toContain("wire-opencode-provider-called");
  expect(result.stdout).toContain("mcp-smoke-called");
  expect(result.stdout).toContain("opencode-service-set");
  // Reaching the tailscale-ip guard proves the opencode server wait passed.
  expect(result.stderr).toContain("tailscale has no ipv4 address");
  expect(result.stderr).not.toContain("opencode service exited before becoming ready");
  expect(result.stderr).not.toContain("as_coder: command not found");
}, 120_000);
