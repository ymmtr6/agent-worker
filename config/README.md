# 設定ファイルディレクトリ

このディレクトリは Docker コンテナ内の `/config` にマウントされます。

## 使い方

### 環境変数ファイル

`.env.example` をコピーして `.env` を作成し、API キーを設定してください：

```bash
cp .env.example .env
# .env を編集して API キーを設定
```

Docker 実行時に環境変数を読み込む場合は `--env-file` を使用：

```bash
docker run --rm -p 3000:3000 \
  --env-file config/.env \
  -v $(pwd)/config:/config \
  agent-worker
```

### Claude Code 設定ファイル

Claude Code の設定ファイル（`config.json` など）を `claude-code/` サブディレクトリに配置：

```
config/
  ├── .env
  ├── .env.example
  ├── README.md
  └── claude-code/
      ├── config.json
      └── ...
```

コンテナ内では `XDG_CONFIG_HOME=/config` となるため、Claude Code は `/config/claude-code/` を設定ディレクトリとして認識します。

### gh コマンドの認証

GitHub CLI の認証情報も同様に保存されます：

```bash
# ホスト側で gh auth login を実行してから
docker run --rm -p 3000:3000 \
  -v ~/.config/gh:/config/gh:ro \
  agent-worker
```
