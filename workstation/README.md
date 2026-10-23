# portable agent workstation

this bundle starts one private, privileged workstation container. it uses tailscale ssh for shell access. it does not publish an ssh or t3 code port on the host.

## host requirements

- a linux host with docker engine and the compose plugin
- a local image build, or your own published workstation image
- a tagged, reusable tailscale auth key
- a tailnet ssh policy that permits the operator to connect to the node as `coder`

`privileged: true` is required for docker-in-docker. a process that controls this container can control its nested docker daemon and all nested containers. do not mount the host docker socket.

## first start

1. copy this directory to the host. copy `.env.example` to `.env` and set a unique `WORKSTATION_HOSTNAME`.
2. build the local image from the repository root, or set `WORKSTATION_IMAGE` to an image you publish:

   ```bash
   docker compose -f compose.yaml -f compose.local.yaml build
   ```

   fill in `HONCHO_WORKSPACE`, `HONCHO_PEER_NAME`, and a strong `OPENCODE_SERVER_PASSWORD` in `.env`. there are no shared account defaults. a private registry requires your own login.

3. create the secret files. the three cli auth files can be empty. the container imports each nonempty cli auth file only when its persistent target does not exist.

   ```bash
   install -d -m 0700 secrets
   install -m 0600 /dev/null secrets/{tailscale_auth_key,honcho_api_key,porch_mcp_token,claude_auth,codex_auth,opencode_auth,cliproxy_api_key}
   printf '%s' "$TAILSCALE_AUTH_KEY" >secrets/tailscale_auth_key
   printf '%s' "$HONCHO_API_KEY" >secrets/honcho_api_key
   printf '%s' "$PORCH_MCP_TOKEN" >secrets/porch_mcp_token
   cp "$HOME/.claude/.credentials.json" secrets/claude_auth
   cp "$HOME/.codex/auth.json" secrets/codex_auth
   cp "$HOME/.local/share/opencode/auth.json" secrets/opencode_auth
   chmod 0600 secrets/*
   ```

   `secrets/cliproxy_api_key` may stay empty. `CLIPROXY_BASE_URL` is empty by default; when it and the cliproxy secret are both present, the image wires the `cliproxyapi` provider, otherwise it removes it.

4. confirm the tailnet ssh policy permits your tailnet identity to connect to the new tagged node as `coder`.
5. start the workstation and wait for health:

   ```bash
   docker compose up -d --pull never
   until [[ "$(docker inspect -f '{{.State.Health.Status}}' portable-agent-workstation-workstation-1)" == healthy ]]; do sleep 5; done
   ```

6. connect and check the pinned tools:

   ```bash
   ssh coder@"$WORKSTATION_HOSTNAME"
   claude --version
   codex --version
   opencode --version
   t3 --version
   tmux -V
   tokensieve --version
   semble --help
   doctrine-sync status
   tailscale status --self
   docker info
   /opt/claude-md/scripts/mcp-smoke.sh
   ```

an installed cli can still be unauthenticated. use `claude auth status`, `codex login status`, and `opencode auth list` to check imported login state.

the image runs OpenCode V2 in service mode, supervised by the entrypoint. open the OpenCode web/api interface at `http://<tailnet-hostname>:4096`, username `opencode`, password from `OPENCODE_SERVER_PASSWORD` (required; no default). the server binds `0.0.0.0:4096` inside the container; reach it over tailscale. import the `cliproxyapi` provider by setting `CLIPROXY_BASE_URL` (no default) and a value in `secrets/cliproxy_api_key`; the server reads `CLIPROXY_API_KEY` from the mounted secret, and the provider config carries an `{env:CLIPROXY_API_KEY}` reference, never the value.

open t3 code at `http://<tailnet-hostname>:3773`. confirm that t3 lists claude, codex, and opencode. start codex and opencode through t3 and confirm that each can list and call honcho and porch.

after enrollment and auth import, replace copied one-time inputs with empty files. keep the honcho and porch files mounted because login shells and t3 agent processes read them at runtime.

```bash
install -m 0600 /dev/null secrets/{tailscale_auth_key,claude_auth,codex_auth,opencode_auth}
```

rotate honcho and porch by replacing their files with mode `0600`, then replace the container. secret values do not enter compose environment fields or image layers.

## update

```bash
docker compose -f compose.yaml -f compose.local.yaml build
docker compose up -d --force-recreate --pull never
```

the named volumes preserve `/home/coder`, docker state, and the tailscale identity.

## local image

```bash
docker compose -f compose.yaml -f compose.local.yaml build
docker compose -f compose.yaml -f compose.local.yaml up -d
```

## backup and removal

stop the workstation before a consistent backup. archive each named volume to protected storage with a temporary container. the home volume contains cli credentials and agent data.

```bash
docker compose stop
docker run --rm -v portable-agent-workstation_coder-home:/data -v "$PWD/backups":/backup alpine tar -czf /backup/coder-home.tgz -C /data .
docker run --rm -v portable-agent-workstation_docker-data:/data -v "$PWD/backups":/backup alpine tar -czf /backup/docker-data.tgz -C /data .
docker run --rm -v portable-agent-workstation_tailscale-state:/data -v "$PWD/backups":/backup alpine tar -czf /backup/tailscale-state.tgz -C /data .
```

remove the container but keep state with `docker compose down`. remove the container and all workstation volumes with `docker compose down -v`. the second command deletes the home, docker, and tailnet state.
