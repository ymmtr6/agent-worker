# agent-worker

claude code や codex を動作させる開発用 Docker イメージと WebUI。

## 使い方

```
docker build -t agent-worker .
docker run --rm -p 3000:3000 -v $(pwd)/config:/config agent-worker
```

## ベースイメージの変更

```
docker build --build-arg BASE_IMAGE=node:20-alpine -t agent-worker .
```

## インストールの調整

```
docker build \
  --build-arg INSTALL_CLAUDE_CODE=1 \
  --build-arg INSTALL_CODEX=1 \
  -t agent-worker .
```

claude code / codex の配布元が異なる場合は `Dockerfile` の `npm install -g` を差し替えてください。

## 設定ファイルの注入

- `XDG_CONFIG_HOME=/config` を使用しています。
- `-v /path/to/config:/config` で外部から注入してください。

### Claude Code の設定

Claude Code の設定は以下の2つの方法で注入できます。

#### 1. 設定ファイルをマウント

ホスト側の Claude Code 設定をコンテナにマウント：

```bash
# ホスト側の ~/.config/claude-code をコンテナの /config/claude-code にマウント
docker run --rm -p 3000:3000 \
  -v ~/.config/claude-code:/config/claude-code:ro \
  agent-worker
```

または、config ディレクトリ全体をマウント：

```bash
# config/claude-code/ に設定ファイルを配置しておく
docker run --rm -p 3000:3000 \
  -v $(pwd)/config:/config \
  agent-worker
```

#### 2. 環境変数で API キーを渡す

```bash
docker run --rm -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your_api_key_here \
  -v $(pwd)/config:/config \
  agent-worker
```

#### 複数の設定を組み合わせる例

```bash
docker run --rm -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your_api_key_here \
  -e CLAUDE_CMD=claude \
  -v $(pwd)/config:/config \
  -v $(pwd)/workspace:/workspace \
  agent-worker
```

#### 環境変数ファイルを使う

`config/.env.example` をコピーして設定：

```bash
cp config/.env.example config/.env
# config/.env を編集して API キーを設定

docker run --rm -p 3000:3000 \
  --env-file config/.env \
  -v $(pwd)/config:/config \
  agent-worker
```

### Codex の設定

同様に Codex の設定も環境変数で渡せます：

```bash
docker run --rm -p 3000:3000 \
  -e OPENAI_API_KEY=your_openai_key_here \
  -e CODEX_CMD=codex \
  -v $(pwd)/config:/config \
  agent-worker
```

## gh コマンド

`github-cli` を同梱しているため、コンテナ内で `gh` が利用できます。

## WebUI と CUI

WebUI はコンテナ内の bash を WebSocket + PTY で操作できます。
タブで複数の tty を開き、削除も可能です。

```
docker run --rm -p 3000:3000 \
  -e CLAUDE_CMD=claude \
  -e CODEX_CMD=codex \
  -v $(pwd)/config:/config \
  agent-worker
```

シェルの指定やカレントディレクトリは以下で調整できます。

- `AW_SHELL` (default: `bash`)
- `AW_SHELL_CWD` (default: `/workspace`)

PTY セッションはサーバ側で一定時間保持され、リロード後に復帰できます。
リロード時のみ直前の画面内容を再送します（Reconnect では再送しません）。

- `AW_PTY_TTL_MS` (default: 300000)
- `AW_PTY_MAX_BUFFER` (default: 200000)

ブラウザ側はセッション ID を保存して復帰に利用します。
