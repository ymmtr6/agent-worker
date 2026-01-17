ARG BASE_IMAGE=rockylinux:9
FROM ${BASE_IMAGE}

ARG INSTALL_CLAUDE_CODE=1
ARG INSTALL_CODEX=1

# Install Node.js 20 from NodeSource
RUN dnf install -y --allowerasing \
    ca-certificates \
    curl \
  && curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - \
  && dnf install -y --allowerasing \
    nodejs \
    bash \
    git \
    openssh-clients \
    gcc-c++ \
    make \
    python3 \
  && mkdir -p /opt/webui

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/rpm/gh-cli.repo -o /etc/yum.repos.d/gh-cli.repo \
  && dnf install -y gh

# Install claude code and codex CLIs (replace packages if your org uses different sources).
RUN if [ "${INSTALL_CLAUDE_CODE}" = "1" ]; then npm install -g @anthropic-ai/claude-code; fi \
  && if [ "${INSTALL_CODEX}" = "1" ]; then npm install -g @openai/codex; fi \
  && npm cache clean --force

ENV XDG_CONFIG_HOME=/config
ENV AGENT_WORKER_CONFIG=/config/agent-worker

WORKDIR /workspace

COPY webui/package*.json /opt/webui/
RUN cd /opt/webui \
  && npm install --omit=dev \
  && npm cache clean --force \
  && dnf clean all \
  && rm -rf /var/cache/dnf

COPY webui /opt/webui

EXPOSE 3000
VOLUME ["/config"]

CMD ["node", "/opt/webui/server.js"]
