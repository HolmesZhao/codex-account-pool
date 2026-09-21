# Codex 号池

从 AI Asset Center 中独立提取的 Codex 账号池应用。目录内包含独立服务端、React 管理后台、迁移脚本和仅负责账号切换的 `codex-pool-helper` Plugin，不依赖资产、制品、Registry、投稿或 MCP 能力。

## 环境要求

- Node.js 22.5+
- npm 10+
- 可执行的 `codex` 命令（仅 Device Code 登录和真实额度刷新需要）
- 默认使用 SQLite；号池领域数据也可使用 PostgreSQL 14+

## 启动

```bash
cd codex-account-pool
npm install
cp .env.example .env
```

至少修改 `.env` 中的管理员密码、32 字节会话密钥和 32 字节凭证密钥。凭证密钥可用下面的命令生成：

```bash
openssl rand -hex 32
```

Node 不会自动读取 `.env`，可在当前 shell 中加载后启动：

```bash
set -a
source .env
set +a
npm run build
npm start
```

默认地址为 `http://127.0.0.1:4317`。首次启动会在认证库为空时创建 `.env` 中的管理员。

Device Code 和额度刷新都通过 `codex app-server` 的 stdio JSON-RPC 协议执行。每个账号操作使用独立的临时 `CODEX_HOME`：Device Code 流程保持 app-server 进程直到授权完成，额度查询只把该账号解密后的凭证写入权限为 `0600` 的临时 `auth.json`，操作结束即清理。

## Docker

镜像内固定安装 `@openai/codex@0.155.0-alpha.9.2`，避免 app-server 协议随 `latest` 漂移；升级时通过构建参数 `CODEX_VERSION` 显式修改，并重新运行自检。

```bash
cp .env.docker.example .env
# 修改三个必填值：管理员密码、会话密钥、凭证根密钥
docker compose build
docker compose up -d
docker compose ps
```

默认仅绑定宿主机 `127.0.0.1:4317`。SQLite 数据保存在命名卷 `codex-pool-data`；容器使用非 root 用户、只读根文件系统、无 Linux capabilities，并以受限 `/tmp` 保存短生命周期的 Codex 登录目录。Device Code 和额度查询需要容器能够访问 OpenAI/ChatGPT 的 HTTPS 服务。

升级前备份数据卷：

```bash
docker run --rm -v codex-account-pool_codex-pool-data:/data -v "$PWD":/backup \
  busybox tar czf /backup/codex-pool-data.tgz -C /data .
```

## 存储

- `CODEX_POOL_DATABASE_URL`：号池领域库。可填写 SQLite 文件路径、`:memory:` 或 PostgreSQL URL。
- `CODEX_POOL_AUTH_DATABASE_URL`：独立认证库，当前使用 SQLite 文件或 `:memory:`。
- `CODEX_POOL_POSTGRES_SCHEMA`：PostgreSQL schema，默认 `codex_pool`。
- `CODEX_POOL_CREDENTIAL_KEY`：64 位十六进制或 Base64 编码的 32 字节 AES-256-GCM 密钥。

凭证以账号 ID 与代次作为 AAD 加密。普通下载始终输出 AT-only `auth.json`，清空 Refresh Token；原始凭证下载需要管理员权限并使用独立的一次性票据。

部署密钥是根密钥；版本 2 起的数据密钥通过 HMAC-SHA-256 按版本派生，不写入数据库。管理员可在“用户授权”页执行在线轮换：服务会在单一数据库事务中创建新版本、重加密每个账号的当前凭证并更新活动版本，失败时整体回滚。直接更换部署根密钥前仍必须完成离线重加密迁移，否则历史凭证无法解密。

## 从现有 AAC 数据迁移

迁移前停止旧服务写入，并先执行 dry-run：

```bash
npm run migrate -- --source /path/to/aac.sqlite --target /path/to/codex-pool.sqlite --dry-run
npm run migrate -- --source /path/to/aac.sqlite --target /path/to/codex-pool.sqlite
```

脚本会同时校验凭证代次引用的密钥版本。目标库必须为空；下载票据和进行中的 Device Code 流程不会迁移。源与目标也可以使用 PostgreSQL URL。

## Helper Plugin

Plugin 位于 `plugins/codex-pool-helper/`。它只提供登录、账号/额度查询、AT-only 切换、协调、回滚与 SessionStart 恢复，不包含 AAC 的资产能力。服务器地址、Bearer Token 与目标 `auth.json` 路径均由用户显式配置；网络失败不会覆盖本地凭证。

```bash
node plugins/codex-pool-helper/scripts/codex-pool-helper.mjs login
node plugins/codex-pool-helper/scripts/codex-pool-helper.mjs accounts
node plugins/codex-pool-helper/scripts/codex-pool-helper.mjs switch <account-id>
node plugins/codex-pool-helper/scripts/codex-pool-helper.mjs rollback
```

## 验证

```bash
npm run self-test
```

自检依次运行后端测试、前端测试、Helper 安全测试、生产构建与 Chromium 端到端测试。
