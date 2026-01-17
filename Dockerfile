ARG BASE_IMAGE=node:20-alpine
FROM ${BASE_IMAGE}

ARG INSTALL_CLAUDE_CODE=1
ARG INSTALL_CODEX=1

RUN apk add --no-cache \
    bash \
    ca-certificates \
    curl \
    git \
    github-cli \
    openssh-client \
  && apk add --no-cache --virtual .build-deps \
    g++ \
    make \
    python3 \
  && mkdir -p /opt/webui

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
  && apk del .build-deps

COPY webui /opt/webui

EXPOSE 3000
VOLUME ["/config"]

CMD ["node", "/opt/webui/server.js"]
