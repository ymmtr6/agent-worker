const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const pty = require("node-pty");

const port = process.env.PORT || 3000;
const indexPath = path.join(__dirname, "index.html");
const requestTimeoutMs = Number(process.env.AW_REQUEST_TIMEOUT_MS || 120000);
const maxBodyBytes = Number(process.env.AW_MAX_BODY_BYTES || 256 * 1024);
const shellPath = process.env.AW_SHELL || "bash";
const defaultCwd = process.env.AW_SHELL_CWD || "/workspace";
const ptyTtlMs = Number(process.env.AW_PTY_TTL_MS || 300000);
const maxPtyBuffer = Number(process.env.AW_PTY_MAX_BUFFER || 200000);

const toolCommands = {
  claude: process.env.CLAUDE_CMD || "claude",
  codex: process.env.CODEX_CMD || "codex",
};

const sessions = new Map();

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBodyBytes) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const runTool = ({ tool, prompt }) =>
  new Promise((resolve, reject) => {
    const command = toolCommands[tool];
    if (!command) {
      reject(new Error("unknown tool"));
      return;
    }

    const child = spawn(command, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("request timed out"));
    }, requestTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `process exited with ${code}`));
      }
    });

    child.stdin.write(prompt || "");
    child.stdin.end();
  });

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.url === "/api/run" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const tool = String(payload.tool || "claude");
      const prompt = String(payload.prompt || "");
      const result = await runTool({ tool, prompt });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, tool, ...result }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: err.message || "failed to run tool",
        })
      );
    }
    return;
  }

  if (req.url === "/api/run/stream" && req.method === "POST") {
    let child;
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const tool = String(payload.tool || "claude");
      const prompt = String(payload.prompt || "");
      const command = toolCommands[tool];
      if (!command) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unknown tool" }));
        return;
      }

      res.writeHead(200, {
        "content-type": "application/x-ndjson",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      child = spawn(command, [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        res.write(
          JSON.stringify({ type: "error", data: "request timed out" }) + "\n"
        );
        res.end();
      }, requestTimeoutMs);

      const writeChunk = (type, data) => {
        res.write(JSON.stringify({ type, data }) + "\n");
      };

      child.stdout.on("data", (chunk) => {
        writeChunk("stdout", chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk) => {
        writeChunk("stderr", chunk.toString("utf8"));
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        writeChunk("error", err.message || "failed to run tool");
        res.end();
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        writeChunk("exit", String(code));
        res.end();
      });

      req.on("close", () => {
        if (child) {
          child.kill("SIGTERM");
        }
      });

      child.stdin.write(prompt || "");
      child.stdin.end();
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: err.message || "failed to run tool",
          })
        );
      }
    }
    return;
  }

  fs.readFile(indexPath, (err, data) => {
    if (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("failed to load ui");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ noServer: true });

const spawnShell = (cols, rows) =>
  pty.spawn(shellPath, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: defaultCwd,
    env: { ...process.env, TERM: "xterm-256color" },
  });

const trimBuffer = (buffer) => {
  if (buffer.length <= maxPtyBuffer) {
    return buffer;
  }
  return buffer.slice(-maxPtyBuffer);
};

const sendToSession = (session, payload) => {
  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify(payload));
  }
};

const createSession = (id, cols, rows) => {
  const term = spawnShell(cols, rows);
  const session = {
    id,
    pty: term,
    buffer: "",
    ws: null,
    cleanupTimer: null,
  };
  term.onData((data) => {
    session.buffer = trimBuffer(session.buffer + data);
    sendToSession(session, { type: "output", data });
  });
  term.onExit(({ exitCode }) => {
    sendToSession(session, { type: "exit", code: exitCode });
    sessions.delete(id);
    if (session.ws) {
      session.ws.close();
    }
  });
  sessions.set(id, session);
  return session;
};

const scheduleCleanup = (session) => {
  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
  }
  session.cleanupTimer = setTimeout(() => {
    session.pty.kill();
    sessions.delete(session.id);
  }, ptyTtlMs);
};

server.on("upgrade", (req, socket, head) => {
  if (!req.url || !req.url.startsWith("/ws/terminal")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const cols = Number(url.searchParams.get("cols") || 80);
  const rows = Number(url.searchParams.get("rows") || 24);
  const requestedId = url.searchParams.get("sessionId");
  const sessionId =
    requestedId ||
    (globalThis.crypto && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2));
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession(sessionId, cols, rows);
  } else {
    session.pty.resize(cols, rows);
  }

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
  }

  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.close();
  }
  session.ws = ws;

  sendToSession(session, { type: "session", id: sessionId });
  if (url.searchParams.get("replay") === "1" && session.buffer) {
    sendToSession(session, { type: "output", data: session.buffer });
  }

  ws.on("message", (message) => {
    let payload;
    try {
      payload = JSON.parse(message.toString("utf8"));
    } catch (err) {
      return;
    }
    if (payload.type === "input") {
      session.pty.write(String(payload.data || ""));
    }
    if (payload.type === "resize") {
      const nextCols = Number(payload.cols || cols);
      const nextRows = Number(payload.rows || rows);
      session.pty.resize(nextCols, nextRows);
    }
    if (payload.type === "terminate") {
      session.pty.kill();
      sessions.delete(sessionId);
      ws.close();
    }
  });

  ws.on("close", () => {
    session.ws = null;
    scheduleCleanup(session);
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`agent-worker webui listening on ${port}`);
});
