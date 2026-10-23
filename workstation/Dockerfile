# syntax=docker/dockerfile:1.7
FROM codercom/enterprise-node:ubuntu@sha256:c2e8e2bdfbd671327b358b8c4c2bc3337a216fc8eb319b0ead0e1fbbb46b8f68 AS tokensieve-builder

USER root
ARG TARGETARCH
ARG TOKENSIEVE_COMMIT=64872d39fb1eed234d8e82fc3278cceb43b14ea9
ARG ZIG_VERSION=0.16.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates=20260601~26.04.1 curl=8.18.0-1ubuntu2.7 \
       git=1:2.55.0-0ppa1~ubuntu26.04.2 xz-utils=5.8.3-1 \
    && case "$TARGETARCH" in amd64) zig_arch=x86_64 ;; arm64) zig_arch=aarch64 ;; *) exit 2 ;; esac \
    && curl -fsSLo /tmp/zig.tar.xz "https://ziglang.org/download/${ZIG_VERSION}/zig-${zig_arch}-linux-${ZIG_VERSION}.tar.xz" \
    && mkdir /opt/zig \
    && tar -xJf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 \
    && git clone --filter=blob:none https://github.com/sisig-ai/tokensieve.git /src/tokensieve \
    && git -C /src/tokensieve checkout --detach "$TOKENSIEVE_COMMIT" \
    && /opt/zig/zig build -Doptimize=ReleaseSafe --build-file /src/tokensieve/build.zig --prefix /out

FROM codercom/enterprise-node:ubuntu@sha256:c2e8e2bdfbd671327b358b8c4c2bc3337a216fc8eb319b0ead0e1fbbb46b8f68

USER root
ARG TARGETARCH
ARG BUN_VERSION=1.3.13
ARG CLAUDE_VERSION=2.1.285
ARG CODEX_VERSION=0.155.0
ARG OPENCODE_VERSION=2.0.24
ARG T3_VERSION=0.0.44
ARG TAILSCALE_VERSION=1.88.3
ARG DOCKER_VERSION=29.8.2
ARG COMPOSE_VERSION=5.6.0
ARG BUILDX_VERSION=0.37.2
ARG UV_VERSION=0.12.22
ARG SEMBLE_VERSION=0.3.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates=20260601~26.04.1 curl=8.18.0-1ubuntu2.7 \
       git=1:2.55.0-0ppa1~ubuntu26.04.2 iproute2=6.19.0-1ubuntu1.1 \
       iptables=1.8.11-2ubuntu3 python3=3.14.3-0ubuntu2 tmux=3.6a-2ubuntu0.1 \
    && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in \
         amd64) docker_arch=x86_64; tailscale_arch=amd64; compose_arch=x86_64; buildx_arch=amd64 ;; \
         arm64) docker_arch=aarch64; tailscale_arch=arm64; compose_arch=aarch64; buildx_arch=arm64 ;; \
         *) exit 2 ;; \
       esac \
    && curl -fsSL "https://download.docker.com/linux/static/stable/${docker_arch}/docker-${DOCKER_VERSION}.tgz" \
       | tar -xz -C /usr/local/bin --strip-components=1 \
    && install -d /usr/local/lib/docker/cli-plugins \
    && curl -fsSLo /usr/local/lib/docker/cli-plugins/docker-compose \
       "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-${compose_arch}" \
    && curl -fsSLo /usr/local/lib/docker/cli-plugins/docker-buildx \
       "https://github.com/docker/buildx/releases/download/v${BUILDX_VERSION}/buildx-v${BUILDX_VERSION}.linux-${buildx_arch}" \
    && chmod 0755 /usr/local/lib/docker/cli-plugins/docker-* \
    && curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_${tailscale_arch}.tgz" \
       | tar -xz -C /tmp \
    && install -m 0755 "/tmp/tailscale_${TAILSCALE_VERSION}_${tailscale_arch}/tailscale" /usr/local/bin/tailscale \
    && install -m 0755 "/tmp/tailscale_${TAILSCALE_VERSION}_${tailscale_arch}/tailscaled" /usr/local/bin/tailscaled \
    && rm -rf "/tmp/tailscale_${TAILSCALE_VERSION}_${tailscale_arch}" \
    && curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v${BUN_VERSION}" \
    && curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | env UV_INSTALL_DIR=/usr/local/bin sh \
    && npm install -g --allow-scripts=@anthropic-ai/claude-code,@opencode/cli \
       "@anthropic-ai/claude-code@${CLAUDE_VERSION}" \
       "@openai/codex@${CODEX_VERSION}" \
       "@opencode/cli@${OPENCODE_VERSION}" \
       "t3@${T3_VERSION}" \
    && UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin \
       uv tool install --python /usr/bin/python3 --python-preference only-system "semble[mcp]==${SEMBLE_VERSION}" \
    && rm -rf /root/.npm /root/.cache /tmp/*

COPY --from=tokensieve-builder /out/bin/tokensieve /usr/local/bin/tokensieve
COPY package.json bun.lock bunfig.toml tsconfig.json /opt/claude-md/
WORKDIR /opt/claude-md
RUN bun install --frozen-lockfile --production
COPY . /opt/claude-md
RUN chmod -R a-w /opt/claude-md \
    && chmod 0755 /opt/claude-md/sync.sh /opt/claude-md/scripts/*.sh \
    && install -m 0755 /opt/claude-md/workstation/entrypoint.sh /usr/local/bin/workstation-entrypoint \
    && install -m 0755 /opt/claude-md/workstation/healthcheck.sh /usr/local/bin/workstation-healthcheck \
    && groupadd -f docker \
    && usermod -aG docker coder \
    && mkdir -p /var/lib/docker /var/lib/tailscale /var/run/tailscale /run/workstation \
    && chown coder:coder /home/coder

ENV PATH=/home/coder/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    CLAUDE_MD_DIR=/opt/claude-md \
    CLAUDE_MD_SNAPSHOT=1 \
    DOCKER_HOST=unix:///var/run/docker.sock

LABEL org.opencontainers.image.title="portable agent workstation" \
      org.opencontainers.image.source="https://github.com/sisig-ai/agent-doctrine"

VOLUME ["/home/coder", "/var/lib/docker", "/var/lib/tailscale"]
HEALTHCHECK --interval=15s --timeout=10s --start-period=90s --retries=4 CMD ["/usr/local/bin/workstation-healthcheck"]
ENTRYPOINT ["/usr/local/bin/workstation-entrypoint"]
