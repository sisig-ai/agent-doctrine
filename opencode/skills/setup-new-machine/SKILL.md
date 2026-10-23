---
name: setup-new-machine
description: provision a new portable agent workstation container on a remote vm that already has docker. use when you must set up, deploy, or provision a new agent machine or workstation over ssh, for example "/setup-new-machine root@1.2.3.4". the skill copies the workstation bundle, stages the secrets, runs docker compose, and waits for health.
---

# setup-new-machine

provision one portable agent workstation on a remote vm that already has docker and the compose plugin. the deploy bundle is `workstation/` in this repo. the packaged script does the work.

## mandatory first step

ask the operator what to call the new workstation. this is its tailscale hostname. do not run a command and do not proceed until the operator answers. you must do this ask on every run.

## steps

1. ask the operator for the workstation name (its tailscale hostname). wait for the answer.
2. confirm the ssh target from the argument (for example `root@1.2.3.4` or a host alias).
3. confirm the required inputs exist on this machine: `TAILSCALE_AUTH_KEY`, `HONCHO_WORKSPACE`, `HONCHO_PEER_NAME`, `OPENCODE_SERVER_PASSWORD`, and your own `WORKSTATION_IMAGE` (or `--image`). provide `GHCR_USER` and a ghcr token when the image requires registry login. the placeholder image is for dry runs only. if a required input is missing, ask the operator. never invent a value and never print one.
4. preview when the operator wants it: run `scripts/setup-new-machine.sh <ssh-target> --name <name> --dry-run`. it prints the plan and the secret file names, and it touches nothing.
5. deploy: run `scripts/setup-new-machine.sh <ssh-target> --name <name>`. the script stops with an error when ssh, docker, the compose plugin, or a required secret is missing.
6. report the result: the tailnet name `<name>`, the login `ssh coder@<name>`, and the opencode endpoint `http://<name>:4096`.
7. point the operator to `workstation/README.md` for the host requirements, secret rotation, update, and backup.

## notes

- the target vm must already have docker and the compose plugin. this skill does not install docker.
- the script stages the secrets in a temporary directory with mode 0600, copies them to the target, and removes the staging directory on exit. it never prints a secret value.
- an empty optional secret is correct for `cliproxy_api_key`.
- the container uses `privileged: true` for docker-in-docker. treat its docker daemon as root access to the container.
