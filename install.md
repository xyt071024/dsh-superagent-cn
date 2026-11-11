# 安装与接入

[← 返回首页](../index.html) | [完整文档](../docs/zh/01-overview.html)

---

本页告诉你**到底怎么装起来用**，以及**每个连接源要准备什么**。

---

## 先回答一个核心问题：能做成插件吗？

**能。** 两种形态：

| 形态 | 是什么 | 适合谁 |
|---|---|---|
| **插件版** | 装进你**现有**的 DSH，侧栏多一个入口 | 已装 DSH 的人（大多数） |
| **白板版** | 自带 DSH 的完整压缩包，**解压即用** | 没装过 DSH、或要独立环境 |

**推荐插件版**：不用重装 DSH，不动你现有的插件。

---

## 装之前检查

| 项 | 要求 | 命令 |
|---|---|---|
| DSH | 0.2.1-rc.1 ~ 0.2.2 系列 | `dsh --version` |
| Node.js | 22.19+ 或 24+ | `node -v` |
| pnpm | 任意较新版本 | `pnpm -v` |
| Git | 2.32+ | `git --version` |

**版本适配**：针对 DSH **0.2.1-rc.1 / rc.2 / rc.3 / rc.5 / 0.2.2-rc.1** 验证过。其它版本不一定能跑。

---

# 方式一：插件版（推荐）

## Windows

```powershell
# 1. 创建独立 profile（不会影响你现有的）
dsh superagent --from-default-profile web --dump-config > $null

# 2. 装插件
dsh plugin --profile superagent add dsh-superagent

# 3. 配端口与数据目录（编辑下面的文件）
notepad "$env:USERPROFILE\.dsh\profiles\superagent\cordis.patch.yml"

# 4. 启动
dsh --profile superagent
```

## macOS

```bash
# 1. 创建独立 profile
dsh superagent --from-default-profile web --dump-config > /dev/null

# 2. 装插件
dsh plugin --profile superagent add dsh-superagent

# 3. 配端口与数据目录
$EDITOR ~/.dsh/profiles/superagent/cordis.patch.yml

# 4. 启动
dsh --profile superagent
```

## Linux

```bash
# 1. 创建独立 profile
dsh superagent --from-default-profile web --dump-config > /dev/null

# 2. 装插件
dsh plugin --profile superagent add dsh-superagent

# 3. 配端口与数据目录
$EDITOR ~/.dsh/profiles/superagent/cordis.patch.yml

# 4. 启动
dsh --profile superagent
```

## 配置文件内容

三个平台一样，只有 `stateDir` 路径不同：

```yaml
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082

- id: superagent
  config:
    stateDir: <绝对路径>/state/superagent
```

**各平台的 `stateDir` 写法**：

| 平台 | 写法 |
|---|---|
| Windows | `C:/Users/<你>/.dsh/state/superagent`（**正斜杠**） |
| macOS | `/Users/<你>/.dsh/state/superagent` |
| Linux | `/home/<你>/.dsh/state/superagent` |

**注意**：必须是绝对路径。Windows 上用正斜杠，不要用反斜杠。

## 启动后

终端会打印一行：

```
dsh web: http://127.0.0.1:3082/?token=xxxxxxxx
```

**复制整个地址**（含 `?token=`）在浏览器打开。

---

# 方式二：白板版（解压即用）

## 下载对应平台

| 平台 | 文件 |
|---|---|
| Windows x64 | `dsh-superagent-standalone-v<版本>-win-x64.zip` |
| macOS (Apple Silicon) | `dsh-superagent-standalone-v<版本>-mac-arm64.zip` |
| macOS (Intel) | `dsh-superagent-standalone-v<版本>-mac-x64.zip` |
| Linux x64 | `dsh-superagent-standalone-v<版本>-linux-x64.zip` |

## 解压后里面是什么

```
dsh-superagent-standalone/
├── dsh        或  dsh.exe     ← 启动器
├── node/                      ← 内置 Node 运行时，不用你装
├── profiles/superagent/       ← 预配置好的
├── plugins/                   ← 插件本体
├── 启动.cmd / 启动.sh          ← 双击/执行就能跑
└── README.txt
```

## 怎么启动

**Windows**：双击 `启动.cmd`

**macOS / Linux**：

```bash
# macOS（首次需要解除隔离）
xattr -dr com.apple.quarantine ./dsh-superagent-standalone
chmod +x ./dsh
./dsh --profile superagent

# Linux
chmod +x ./dsh
./dsh --profile superagent
```

**不需要安装程序。** 解压 → 启动 → 完事。想卸载直接删文件夹。

## 两种形态对比

| | 插件版 | 白板版 |
|---|---|---|
| 需要先装 DSH | 是 | **否**（内置） |
| 影响现有环境 | 不影响（独立 profile） | **完全隔离** |
| 升级 | `dsh plugin update` | 下载新压缩包覆盖 |
| 体积 | 几 MB | 约 200MB |
| 适合 | 已有 DSH | 全新用户 / 演示 / 隔离测试 |

---

# 连接源：每个要准备什么

**这是最容易卡住的地方。** 逐个说明。

## 1. GitHub（最简单）

**准备**：不需要额外准备，只要你有 GitHub 账号。

```bash
# 检查是否已登录
gh auth status

# 没登录就登录（会开浏览器授权）
gh auth login

# 确认身份
gh api user --jq .login
```

安装后进设置 → 连接源 → GitHub → 填你的仓库 `owner/name`。

## 2. QQ邮箱（推荐第一个配）

**准备**：一个**授权码**（不是你的 QQ 密码）。

**怎么拿**：

```
1. 打开 https://mail.qq.com 登录
2. 设置 → 账户
3. 找到「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务」
4. 开启「IMAP/SMTP服务」
5. 按提示发短信验证
6. 拿到一串 16 位授权码 —— 记下来
```

**填进设置**：

```
邮箱地址：你的QQ邮箱@qq.com
授权码：上面拿到的那串
IMAP 服务器：imap.qq.com:993 (SSL)
SMTP 服务器：smtp.qq.com:465 (SSL)
```

**注意**：授权码只显示一次，丢了要重新生成。

## 3. 企业微信

**准备**：企业管理员权限。

```
1. 登录 https://work.weixin.qq.com
2. 应用管理 → 创建应用
3. 记下：企业ID（corpid）、应用Secret、AgentId
4. 在应用里配置「接收消息服务器」或开启 API 接收
```

**要填三项**：`corpid` / `secret` / `agentId`

**没有企业**：这条路走不通，跳过，用其它源。

## 4. 飞书

**准备**：能创建应用。

```
1. 打开 https://open.feishu.cn
2. 创建企业自建应用
3. 开通权限：im:message、im:message:send_as_bot、im:chat
4. 记下 App ID 和 App Secret
5. 发布应用版本
```

**要填两项**：`App ID` / `App Secret`

## 5. Gmail

**准备**：Google 账号 + 两步验证。

```
1. 开启两步验证：https://myaccount.google.com/security
2. 生成应用专用密码：https://myaccount.google.com/apppasswords
3. 选「邮件」+「Windows 计算机」，拿到 16 位密码
```

**网络**：部分地区直连会超时，需要代理（见下方「代理」一节）。

## 6. QQ（需要额外装一个网关）

### 重要说明

QQ 这一端**不能只装我们一个插件就完事**。它需要一个本地的 QQ 协议网关 **SnowLuma**，这是第三方软件，有独立的许可协议。

**为什么不打包进安装包**：SnowLuma 是**源码可见非商业许可**，不允许我们分发它的二进制。你必须自己去拿。

### 你需要做的三步

**第 1 步：下载 SnowLuma**

去它的官方发布页拿（搜索引擎搜 "SnowLuma QQ" 或看社区指路）。

放到一个固定目录，比如 `D:\SnowLuma`。

**第 2 步：启动并扫码登录**

```bash
# Windows
D:\SnowLuma\launcher.bat

# 或直接跑
node D:\SnowLuma\index.mjs
```

启动后会显示二维码，用手机 QQ 扫码登录。

**默认端口**：
- WebSocket：`3001`
- HTTP：`3000`

**第 3 步：在 Super Agent 里配置**

进设置 → 连接源 → QQ，填：

```
WebSocket 地址：ws://127.0.0.1:3001
HTTP 地址：http://127.0.0.1:3000
Access Token：（如果你在 SnowLuma 里配了，就填；没配留空）
```

### 自动检测

安装包会带一个**检测脚本**，帮你确认 QQ 这段是否通：

```bash
dsh-superagent doctor --source qq
```

它会检查：
- SnowLuma 进程在不在
- 端口 3001 / 3000 通不通
- 是否已登录（能拿到账号信息）
- 配置是否填对

**哪一步没过，脚本会直接告诉你缺什么。**

### 如果还是连不上

| 症状 | 检查 |
|---|---|
| 端口不通 | SnowLuma 启动了吗？防火墙挡了吗？ |
| 通了但收不到消息 | 扫码登录了吗？看 SnowLuma 控制台 |
| 收到了但发不出去 | Access Token 填错了吗？ |
| 一直重连 | SnowLuma 版本太旧，去更新 |

## 7. 微信

**准备**：Windows 上装微信客户端。

**说明**：微信没有官方 API，只能通过本地客户端。这条路**不稳定**——腾讯改版就得跟。我们用五层加固（进程守护、端口仲裁、双通道、去重、熔断）把可用性拉到 4 星，但**这不是 100% 可靠**。

**首次配置**：设置 → 连接源 → 微信 → 点「授权」，会打开微信窗口让你扫码。

---

# 代理（部分连接源需要）

GitHub、Gmail 在部分地区直连不稳定。

## 方式一：用你已有的代理（推荐）

如果你电脑上已经装了代理软件并开着，**一般不用配**——系统代理会被自动检测。

## 方式二：手动填

设置 → 代理 → 用户代理：

```
HTTP：  http://127.0.0.1:<端口>
SOCKS5：socks5://127.0.0.1:<端口>
```

端口看你代理软件的设置页。

## 方式三：拖拽识别

设置 → 代理 → 把代理软件的**可执行文件或安装目录**拖进拖拽区，自动识别端口。

## 分域策略

**国内服务建议直连**（走代理反而慢）：

| 域名 | 建议 |
|---|---|
| api.github.com | 走代理 |
| imap.gmail.com | 走代理 |
| imap.qq.com | 直连 |
| 企业微信 API | 直连 |
| 飞书 API | 直连 |

---

# 常见问题

## Q：装完打不开 / 报错？

| 症状 | 原因 | 解决 |
|---|---|---|
| `EADDRINUSE` | 端口被占 | 换端口，或杀掉旧进程 |
| `ValidationError: stateDir` | 路径格式不对 | 用绝对路径 + 正斜杠 |
| `cannot resolve profile bundle` | 包名不对 | 检查包名是否为 `dsh-superagent` |
| 白屏 / 401 | 没带 token | 用终端打印的完整地址 |
| 插件不出现 | profile 没加载 | 检查 `package.json` 的 `dsh.profile.bundles` 里有它 |

## Q：会影响我现有的插件吗？

**不会**，装在独立 profile 里。

但**必须开一个开关**：设置 → 高级 → **「隔离进程环境变量」**。

这个插件会改进程的 `PATH`，不开隔离的话，同进程其它插件调 `gh` 会用到它的账号。

## Q：怎么升级？

```bash
# 插件版
dsh plugin --profile superagent update

# 白板版
# 下载新压缩包，覆盖解压
```

**升级前备份** `<stateDir>` 整个目录。

## Q：怎么卸载干净？

```bash
# 移除插件
dsh plugin --profile superagent remove dsh-superagent

# 删 profile
rm -rf ~/.dsh/profiles/superagent

# 删数据（会丢历史，谨慎）
rm -rf <你的 stateDir>
```

白板版：直接删文件夹。

---

# 平台支持情况

| 平台 | 插件版 | 白板版 | 备注 |
|---|---|---|---|
| **Windows 10/11** | ✅ 已实测 | ✅ | 官方实现有 4 处 POSIX 假设，本项目已修 |
| **macOS (Apple Silicon)** | ✅ 预期可用 | ✅ | 未完整实测 |
| **macOS (Intel)** | ✅ 预期可用 | ✅ | 未完整实测 |
| **Linux x64** | ✅ 预期可用 | ✅ | 未完整实测 |

**诚实说明**：Windows 是我们主要开发和验证的平台。macOS / Linux 沿用了官方实现，理论上能跑，但**没有逐项实测**。遇到问题请提 issue。

**Windows 特别处理**（已包含在安装包里）：

| 问题 | 官方表现 | 本项目处理 |
|---|---|---|
| 没有 `env` 命令 | `spawn env ENOENT` | 改用进程参数传环境 |
| 路径校验 | 只接受 `/` 开头 | 放宽为同时接受 `X:/` |
| 只有 `pwsh` 没 `bash` | 工具注册失败 | 按平台自动选 shell |
| 重启端口抢占 | `EADDRINUSE` | 先停旧进程再起 |

---

# 最小可用配置

第一次用，配这些就够：

```
连接源：只开 QQ邮箱 或 GitHub（选一个）
权限：白名单只填你自己
模式：observe（只记录不执行）
预算：日 ¥10
自主权限：全关
```

**跑一周**，看它记录了哪些「想做的事」。觉得准了再逐项放开。

---

[← 返回首页](../index.html) | [完整文档](../docs/zh/01-overview.html)
