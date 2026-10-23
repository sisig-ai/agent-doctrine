#!/usr/bin/env python3
import json
import os
import re
import stat
from pathlib import Path

HOME = Path.home()


def merge_mcp_json(path: Path, servers: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    if path.exists() and path.stat().st_size:
        data = json.loads(path.read_text())
    current = data.get("mcpServers") or {}
    current.update(servers)
    data["mcpServers"] = current
    path.write_text(json.dumps(data, indent=2) + "\n")


def write_porch_env(token: str) -> None:
    env_path = HOME / ".config" / "porch" / "mcp.env"
    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text(f"export PORCH_MCP_TOKEN={token}\n")
    env_path.chmod(stat.S_IRUSR | stat.S_IWUSR)


def honcho_headers() -> dict | None:
    api_key = os.environ.get("HONCHO_API_KEY", "").strip()
    workspace = os.environ.get("HONCHO_WORKSPACE", "").strip()
    peer = os.environ.get("HONCHO_PEER_NAME", "agent").strip() or "agent"
    if not api_key or not workspace:
        return None
    return {
        "Authorization": f"Bearer {api_key}",
        "X-Honcho-User-Name": peer,
        "X-Honcho-Workspace-ID": workspace,
    }


def porch_server() -> dict | None:
    token = os.environ.get("PORCH_MCP_TOKEN", "").strip()
    if not token:
        return None
    write_porch_env(token)
    return {
        "url": "https://porch.sh/mcp",
        "headers": {"Authorization": f"Bearer {token}"},
    }


def write_honcho_client_config() -> bool:
    api_key = os.environ.get("HONCHO_API_KEY", "").strip()
    workspace = os.environ.get("HONCHO_WORKSPACE", "").strip()
    peer = os.environ.get("HONCHO_PEER_NAME", "agent").strip() or "agent"
    if not api_key or not workspace:
        return False
    path = HOME / ".honcho" / "config.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "apiKey": api_key,
        "workspace": workspace,
        "peerName": peer,
        "globalOverride": True,
        "url": "https://api.honcho.dev/v3",
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    return True


def merge_codex_toml(path: Path) -> None:
    blocks = [
        """
[mcp_servers.semble]
command = "semble"
args = []
""",
    ]
    if honcho_headers():
        blocks.append(
            """
[mcp_servers.honcho]
url = "https://mcp.honcho.dev"
bearer_token_env_var = "HONCHO_API_KEY"
"""
        )
    porch = os.environ.get("PORCH_MCP_TOKEN", "").strip()
    if porch:
        blocks.append(
            """
[mcp_servers.porch]
url = "https://porch.sh/mcp"
bearer_token_env_var = "PORCH_MCP_TOKEN"
"""
        )
    text = path.read_text() if path.exists() else ""
    for block in blocks:
        name = re.search(r"\[mcp_servers\.(\w+)\]", block)
        if not name:
            continue
        marker = f"[mcp_servers.{name.group(1)}]"
        if marker in text:
            continue
        text = text.rstrip() + "\n" + block.strip() + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text if text.endswith("\n") else text + "\n")


def merge_claude_settings(path: Path, mcp: dict) -> None:
    data = {}
    if path.exists() and path.stat().st_size:
        data = json.loads(path.read_text())
    data.setdefault("crossSessionInbound", "accept")
    servers = data.get("mcpServers") or {}
    servers.update(mcp)
    data["mcpServers"] = servers
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def main() -> int:
    servers = {"semble": {"command": "semble", "args": []}}
    honcho = honcho_headers()
    if honcho:
        servers["honcho"] = {"url": "https://mcp.honcho.dev", "headers": honcho}
    porch = porch_server()
    if porch:
        servers["porch"] = porch

    merge_mcp_json(HOME / ".cursor" / "mcp.json", servers)
    merge_claude_settings(HOME / ".claude" / "settings.json", servers)
    merge_codex_toml(HOME / ".codex" / "config.toml")
    write_honcho_client_config()
    print("wired cursor mcp.json, claude settings.json, codex config.toml (merged)")
    if not honcho:
        print("WARN: HONCHO_API_KEY or HONCHO_WORKSPACE missing; honcho mcp skipped")
    if not porch:
        print("WARN: PORCH_MCP_TOKEN missing; porch mcp skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
