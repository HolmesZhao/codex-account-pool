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

Helper 运行在使用 Codex 的电脑上，群晖 Docker 只运行号池服务。需要 Node.js 22.5 或更新版本；不需要另外安装 npm 依赖。Plugin 源码位于 `plugins/codex-pool-helper/`，提供号池登录、账号/额度查询、AT-only 切换、协调及回滚。

### 本地安装与登录（macOS / zsh）

在项目源码根目录执行，将整个 Helper 目录复制到本机固定位置：

```bash
mkdir -p "$HOME/.local/share"
cp -R plugins/codex-pool-helper "$HOME/.local/share/"
```

将下面函数加入 `~/.zshrc`，再打开新终端（或先在当前终端执行一次）：

```bash
function pool-helper() {
  node "$HOME/.local/share/codex-pool-helper/scripts/codex-pool-helper.mjs" "$@"
}
```

使用号池用户登录，地址替换为实际群晖地址。密码通过终端隐藏输入，不要填写到命令历史或聊天中：

```zsh
export CODEX_POOL_SERVER_URL="http://你的群晖IP:4317"
read "CODEX_POOL_USERNAME?号池用户名: "
read -s "CODEX_POOL_PASSWORD?号池密码: "
echo
export CODEX_POOL_USERNAME CODEX_POOL_PASSWORD
pool-helper login
unset CODEX_POOL_PASSWORD
```

登录后服务器地址、目标凭证路径和登录令牌保存在 `~/.codex/codex-pool-helper.json`（文件权限 0600）。默认操作 `~/.codex/auth.json`；使用自定义 `CODEX_HOME` 时配置和凭证均位于该目录。登录令牌失效时重新执行登录。

### 切换、协调与恢复

```bash
pool-helper accounts                 # 查询有权限使用的账号及 ID
pool-helper switch <account-id>       # 将选定账号的 AT-only 凭证写入本机
pool-helper status                   # 查看当前托管状态，不输出凭证
pool-helper coordinate               # 协调当前已托管账号
pool-helper reconcile <account-id>    # 显式尝试同一账号的客户端协调
pool-helper rollback                 # 恢复上次切换的 AT-only 备份
./codex-pool-select.command  # 分别查询额度、选择账号并重启 Codex
```

独立 command 会对配置中的每个 OpenAPI Key 单独请求 `/api/openapi/account`，展示五小时和每周剩余额度，选择后把返回的 AT-only 凭证原子写入 `CODEX_HOME/auth.json`。`apiKeys` 支持任意数量，也可以使用 `CODEX_POOL_API_KEYS`（用换行或逗号分隔）提供多个 Key，避免把 Key 直接放进命令参数或历史记录；完整 Key 不会出现在输出中。

command 默认会先关闭 macOS 上的 Codex，再重新打开 Codex。它只依赖 Python 3.8+ 标准库，不需要 Node/npm。第一次运行会输入地址和 API Key 数量，再逐个输入 Key，并保存到 `~/.config/codex-pool-select/config.json`（权限 `0600`）；之后双击不再重复输入。也可以提前写入该 JSON，格式为 `{ "serverUrl": "https://你的地址", "apiKeys": ["cpk_...", "cpk_...", "cpk_..."] }`。若只想写入凭证而暂不重启，可执行 `python3 codex-pool-select.py --no-restart`。`codex-pool-select.command` 和 `codex-pool-select.py` 不依赖 `codex-pool-helper`，可将两个文件一起复制到任意目录，双击 `.command` 即可。可通过 `CODEX_POOL_CODEX_APP` 覆盖应用名称，默认是 `Codex`。

也可以先单独创建或覆盖配置，不执行额度请求和账号切换：

```bash
python3 codex-pool-select.py --configure
```

切换或回滚成功后，重启正在运行的 Codex 客户端，使其重新读取凭证。

AT 是访问服务的凭证，RT 用于刷新 AT。服务端默认维护 RT；普通下载和 Helper 切换只下发 AT，不下发 RT。备份也只保留 AT，不保留原 RT，回滚不会恢复原刷新链。

若本机仍有同一账号的更新 RT，协调会先尝试服务端自己的刷新链；只有服务端链永久失效时才验证本地链并尝试接管。临时网络失败、身份不符或恢复失败均保留本机现有凭证。双方 RT 都失效时仍需重新登录。仅有 AT 的普通 Helper 客户端不能凭空恢复 RT。

上述复制和命令行配置**不会自动注册 SessionStart 钩子**。目录包含插件清单与 `hooks/hooks.json`；只有在支持该插件的 Codex 客户端中安装、启用并加载钩子后，才会在会话开始时调用协调。手动执行 `coordinate` 不依赖钩子。服务端自动维护不依赖 Helper，也不要求电脑一直开机。

升级 Helper 时重新复制完整目录；这不会修改 `~/.codex/` 中的配置或凭证。1.0.2 服务端配套 Helper 0.1.1，旧 Helper 不包含新增的刷新链协调功能。

## 验证

```bash
npm run self-test
```

自检依次运行后端测试、前端测试、Helper 安全测试、生产构建与 Chromium 端到端测试。

## 管理员创建用户与 HTTP / SOCKS5 代理

管理员登录后，在「用户授权」页点击「创建用户」，填写用户名、显示名称、至少 10 个字符的初始密码和角色。新用户可直接登录；普通角色的号池访问范围需在「号池」页配置。用户名不区分大小写，重复名称返回明确提示；本应用不开放公开注册。

同一页面的「网络代理」区支持 `http://主机:端口`、`socks5://主机:端口` 和 `socks5h://主机:端口`，均可使用 `协议://用户名:密码@主机:端口` 进行认证。SOCKS5 统一由代理解析目标域名；为兼容镜像内 Codex 的 HTTP 客户端，运行时通过仅监听容器回环地址的临时 HTTP CONNECT 转接连接 SOCKS5，操作结束关闭转接。代理失败不会回退直连。认证信息中的特殊字符需 URL 编码。保存后对后续设备登录、额度刷新和自动维护生效，正在进行的登录需取消后重新发起。停用后清除 Codex 子进程继承的代理和绕过配置并直接连接。该配置不改变浏览器流量或 Helper 的连接方式。

代理配置使用凭证根密钥加密，保存在认证数据库中，重启后保留；页面只显示代理主机地址，不回传认证信息。地址留空保存可保留原配置；填写新地址会整体替换旧配置（包括用户名和密码）。需继续保留原 `CODEX_POOL_CREDENTIAL_KEY` 和数据卷。群晖部署时填写可从容器访问的局域网代理地址，例如 `http://192.168.1.10:7890`；`127.0.0.1` 指向容器自身。保存成功只代表配置已保存，实际连通性通过发起设备登录或刷新额度确认。

## 自动续期（AAC 机制）

服务端保存并使用 RT，普通下载及 Helper 仍只安装 AT。含 RT 的新导入账号会立即尝试首次托管；已有数据库无需重建，启动时添加维护状态和租约表，已有 RT 在后续扫描时进入托管。只有 AT 的账号无法自动续期，需要重新登录或导入包含 RT 的凭证。

- 默认开启维护；启动后约 30 秒扫描，每轮结束后间隔 1 小时，默认并发 2。
- 成功轮换后，下次轮换安排在 71 小时加按账号分散的 0–59 分钟后；实际执行等待下一轮扫描。AT 剩余不足 30 分钟时提前刷新。
- 通过 Codex `account/read` 的 `refreshToken: true` 刷新，回读新的 `auth.json`，加密保存新的凭证代次。额度查询中出现的新凭证也会保存；刷新成功但后续额度查询失败时仍保存新凭证。
- 网络失败保留当前凭证及历史额度，按 5/15/60 分钟设置重试门槛，实际执行仍受扫描频率影响。RT 永久失效且 AT 还剩超过 48 小时时进入等待协调状态；否则提示重新登录。隔离状态不自动轮换。
- 单账号进程内去重、5 分钟数据库租约及提交时租约/代次校验，防止多个实例及导入、密钥轮换争用同一刷新链。代理设置同样适用于续期。
- 管理员可在账号详情查看续期状态、AT 有效期、最近续期、下次轮换及重试时间，并手动检查或轮换。
- Helper 的 `coordinate`/SessionStart 在发现本地 RT 时先协调服务端；服务端当前链刷新成功则保留服务端链，暂时失败则保留本地文件，仅永久失败后才验证同一身份、更新的本地链并尝试刷新接管。协调失败不会覆盖本地凭证。新增显式命令：`node plugins/codex-pool-helper/scripts/codex-pool-helper.mjs reconcile <account-id>`。需要更新 Helper 才能获得此协调行为。

维护环境变量：`CODEX_POOL_MAINTENANCE_DISABLED=0`、`CODEX_POOL_INITIAL_DELAY_MS=30000`、`CODEX_POOL_REFRESH_INTERVAL_MS=3600000`、`CODEX_POOL_MAINTENANCE_CONCURRENCY=2`。**旧部署若仍设置 `CODEX_POOL_MAINTENANCE_DISABLED=1`，升级不会覆盖该设置，需改为 `0` 并重建/重启容器。** 保留原数据库卷和凭证根密钥。

## 1.0.3 镜像与升级

支持 `linux/amd64` 和 `linux/arm64`：

- 阿里云：`registry.cn-hangzhou.aliyuncs.com/zwyhub/codex-account-pool:1.0.3`
- Docker Hub：`holmeszhao/codex-account-pool:1.0.3`

此版本加入默认开启的自动维护、AAC 风格凭证轮换及客户端协调恢复。`latest` 同步指向此版本。

群晖在镜像管理中下载 `1.0.3`，停止旧容器并使用新镜像重建容器，沿用原数据卷 `/data`、端口 `4317` 和原凭证根密钥。升级前备份数据卷及环境配置；数据库会自动补建维护表，无需创建新的数据库。若旧环境中 `CODEX_POOL_MAINTENANCE_DISABLED=1`，改为 `0`；未设置时默认开启。启动后可在账号详情查看自动续期状态。Helper 需在使用 Codex 的电脑上单独更新，拉取服务端镜像不会更新电脑上的 Helper。


1.0.5 在账号额度详情中展示重置卡可用总数，以及服务端返回的逐卡类型、状态和独立到期时间。若 `account/rateLimits/read` 只提供总数而未提供明细，页面会明确提示逐卡到期信息暂不可用；接口说明可见 [Codex app-server 协议](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json)。普通 credits 余额与重置卡分开处理。

## OpenAPI AT 与额度接口

管理员在「用户授权 → OpenAPI · API Key」填写 Key 名称，选择一个已启用账号，再点击「生成 API Key」。支持多条 Key，每个 Key 固定绑定一个账号，同一账号也可以创建多个 Key 供不同电脑使用。完整 Key 只在创建时显示一次；后续只能看到掩码。需要替换 Key 时创建新 Key 并撤销旧 Key。可以单独停用、启用或永久撤销，无需重启容器。

Key 配置保存到认证数据库，使用凭证根密钥加密；原始 API Key 不落库，只保存摘要。保留原数据卷与 `CODEX_POOL_CREDENTIAL_KEY`。此功能不使用环境变量配置 API Key。

```bash
curl -H "X-API-Key: $POOL_API_KEY" http://号池地址:4317/api/openapi/account
```

也支持 `Authorization: Bearer <API Key>`。Key 不能访问管理员接口，也不能通过请求参数选择其他账号。服务端执行一次维护/额度检查，再返回 `data.accountId`、`data.email`、`data.accessToken`、`data.tokenExpiresAt`、`data.generation` 和 `data.quota`（包含五小时/每周剩余百分比与重置时间）。只返回 AT，不返回 RT 或 ID Token。返回内容禁止缓存。

额度查询失败时，`quota.stale=true`，仍可返回有效的 AT，客户端应查看 `quota.error` 和 `collectedAt` 判断额度是否为历史结果。Key 不存在、停用或撤销返回 401；账号停用、隔离、需要重新登录或 AT 有效期未知/过期时不下发 AT。客户端拿到 AT 后自行更新本机 Codex 凭证并重启 Codex；服务端不会操作本地电脑。


1.0.5 增加网页管理的多 API Key，支持按账号绑定、启用、停用和撤销。
