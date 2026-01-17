# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

agent-worker は、Claude Code や Codex などの AI コーディングアシスタントを実行するための Docker ベースの開発環境です。WebSocket ベースの PTY セッションを提供する WebUI を含み、ブラウザから複数のターミナルタブを管理できます。

## ビルドと実行

### 基本的なビルドと実行

```bash
docker build -t agent-worker .
docker run --rm -p 3000:3000 -v $(pwd)/config:/config agent-worker
```

### Claude Code の設定を持ち込む

```bash
# 設定ファイルをマウント
docker run --rm -p 3000:3000 \
  -v ~/.config/claude-code:/config/claude-code:ro \
  agent-worker

# 環境変数で API キーを渡す
docker run --rm -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your_api_key_here \
  -v $(pwd)/config:/config \
  agent-worker

# 設定を組み合わせる
docker run --rm -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your_api_key_here \
  -e OPENAI_API_KEY=your_openai_key_here \
  -v $(pwd)/config:/config \
  -v $(pwd)/workspace:/workspace \
  agent-worker
```

### ビルド引数のカスタマイズ

```bash
# ベースイメージの変更
docker build --build-arg BASE_IMAGE=node:20-alpine -t agent-worker .

# インストールするツールの調整
docker build \
  --build-arg INSTALL_CLAUDE_CODE=1 \
  --build-arg INSTALL_CODEX=1 \
  -t agent-worker .
```

### WebUI の起動

```bash
docker run --rm -p 3000:3000 \
  -e CLAUDE_CMD=claude \
  -e CODEX_CMD=codex \
  -v $(pwd)/config:/config \
  agent-worker
```

ブラウザで `http://localhost:3000` にアクセス。

## アーキテクチャ

### コンポーネント構成

- **Dockerfile**: Alpine Linux ベースの Node.js イメージに claude code / codex CLI、git、gh コマンドをインストール
- **webui/server.js**: WebSocket + PTY によるターミナルセッション管理、HTTP API による AI ツール実行
- **webui/index.html**: xterm.js ベースのブラウザターミナル UI（複数タブ対応）
- **config/**: `XDG_CONFIG_HOME=/config` にマウントされる設定ファイル置き場

### WebUI サーバーのアーキテクチャ

`webui/server.js` は以下の3つの主要機能を提供:

1. **HTTP API (`/api/run`, `/api/run/stream`)**: AI ツール（claude / codex）をコマンドラインから実行し、結果を JSON または NDJSON ストリームで返す
2. **WebSocket PTY セッション (`/ws/terminal`)**: node-pty で spawn したシェルと WebSocket で双方向通信。セッション ID でリロード後も復帰可能
3. **静的ファイル配信**: `index.html` を返す

### PTY セッション管理

- セッションは `sessions` Map で管理され、WebSocket 切断後も `AW_PTY_TTL_MS`（デフォルト 5 分）間保持
- `AW_PTY_MAX_BUFFER`（デフォルト 200KB）までのバッファを保存し、リロード時に `replay=1` で再送信
- クライアントはセッション ID をローカルストレージに保存して復帰に利用

## 環境変数

### WebUI サーバー設定

- `PORT`: WebUI のリスニングポート（デフォルト: 3000）
- `AW_SHELL`: 起動するシェル（デフォルト: bash）
- `AW_SHELL_CWD`: シェルの初期カレントディレクトリ（デフォルト: /workspace）
- `AW_PTY_TTL_MS`: PTY セッションの保持時間（デフォルト: 300000 = 5分）
- `AW_PTY_MAX_BUFFER`: PTY バッファの最大サイズ（デフォルト: 200000）
- `AW_REQUEST_TIMEOUT_MS`: AI ツール実行のタイムアウト（デフォルト: 120000 = 2分）
- `AW_MAX_BODY_BYTES`: HTTP リクエストボディの最大サイズ（デフォルト: 256KB）

### AI ツールコマンドと認証

- `CLAUDE_CMD`: claude ツールのコマンド（デフォルト: claude）
- `CODEX_CMD`: codex ツールのコマンド（デフォルト: codex）
- `ANTHROPIC_API_KEY`: Claude Code の API キー（環境変数で渡す）
- `OPENAI_API_KEY`: Codex の API キー（環境変数で渡す）

### Docker 固有

- `XDG_CONFIG_HOME`: 設定ファイルディレクトリ（`/config` に固定）
- `AGENT_WORKER_CONFIG`: agent-worker の設定ディレクトリ（`/config/agent-worker`）

## ファイル構成とコーディング規約

### Node.js サーバー (webui/server.js)

- CommonJS モジュールシステムを使用
- node-pty で PTY を spawn し、WebSocket で xterm.js クライアントと通信
- エラーハンドリングは try-catch で行い、適切な HTTP ステータスコードを返す
- タイムアウト処理にはタイマーを使用し、必ず cleanup を行う

### HTML/CSS (webui/index.html)

- xterm.js と xterm-addon-fit を CDN から読み込み
- WebSocket で `/ws/terminal` に接続し、PTY セッションを確立
- ローカルストレージでセッション ID とアクティブタブを永続化
- カスタム CSS でタブ UI とターミナルスタイルを実装

### Dockerfile

- Alpine Linux ベースで軽量化
- build-deps は最後に削除してイメージサイズを削減
- npm cache は clean してサイズを削減
- claude code / codex のパッケージ名は組織により異なる場合があるため、Dockerfile 内で npm install を差し替える

## WebUI の機能

- **複数タブ**: 複数のターミナルセッションを同時に管理
- **セッション復帰**: ブラウザをリロードしても同じセッションに復帰（最大 5 分間）
- **リプレイ**: リロード時に直前の画面バッファを再送信（Reconnect では再送しない）
- **タブ削除**: セッションを終了して PTY を kill

## 外部依存

- `github-cli`: Docker イメージに同梱。コンテナ内で `gh` コマンドが利用可能
- `xterm.js`: WebUI でブラウザターミナルを実装するライブラリ（CDN 経由）
- `node-pty`: Node.js から PTY を生成するネイティブモジュール
