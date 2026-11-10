# 安装与接入

[← 返回首页](../index.html) | [完整文档](../docs/zh/01-overview.html)

---

本页告诉你**到底怎么把这个东西装起来用**。分清楚自己是哪种情况，对号入座。

---

## 先回答一个问题：能做成插件吗？

**能。** 有两种形态，都能用：

| 形态 | 是什么 | 适合谁 |
|---|---|---|
| **插件版** | 装进你**现有**的 DSH，侧栏多一个入口 | 已经装了 DSH 的人（大多数） |
| **白板版** | 一个**自带 DSH 的完整压缩包**，解压就能跑 | 没装过 DSH、或想独立一套的人 |

**推荐插件版**：不用重装 DSH，不动你现有的任何插件。

---

## 安装前检查

| 项 | 要求 | 怎么查 |
|---|---|---|
| DSH 版本 | 0.2.1-rc.1 ~ 0.2.2 系列 | `dsh --version` |
| Node.js | 22.19+ 或 24+ | `node -v` |
| pnpm | 任意较新版本 | `pnpm -v` |
| Git | 2.32+ | `git --version` |

**版本适配说明**：本项目针对 DSH **0.2.1-rc.1 / rc.2 / rc.3 / rc.5 / 0.2.2-rc.1** 做过验证。其它版本不一定能跑，装之前先核对。

---

# 方式一：插件版（推荐）

## 步骤 1：下载插件包

从 [Releases](https://github.com/xyt071024/dsh-superagent-cn/releases) 下载：

```
dsh-superagent-plugin-v<版本>.tar.gz
```

**不需要解压**，DSH 直接装这个包。

## 步骤 2：创建独立 profile

⚠️ **不要装进你正在用的 profile**，会互相干扰。

```bash
dsh superagent --from-default-profile web --dump-config > /dev/null
```

这行会创建 `~/.dsh/profiles/superagent`，从你的 web profile 复制一份模板。

**如果提示 profile 已存在**：说明你之前装过。不要重跑这条命令（会覆盖配置），直接跳到步骤 3。

## 步骤 3：安装插件

```bash
dsh plugin --profile superagent add <插件包路径或 npm 包名>
```

**两种写法都行**：

```bash
# 从本地压缩包
dsh plugin --profile superagent add /path/to/dsh-superagent-plugin-v1.0.0.tar.gz

# 从 npm（如果已发布）
dsh plugin --profile superagent add dsh-superagent
```

## 步骤 4：配置

编辑 `~/.dsh/profiles/superagent/cordis.patch.yml`：

```yaml
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082

- id: superagent
  config:
    stateDir: /absolute/path/to/state/superagent
```

**两个关键点**：

1. `stateDir` 必须是**绝对路径**
2. Windows 下用 `C:/path/with/forward/slash` 格式（正斜杠 + 盘符）

**端口冲突**：3082 被占用就换一个（3083、3084…）。

## 步骤 5：启动

```bash
dsh --profile superagent
```

启动后终端会打印一个带 token 的地址，形如：

```
dsh web: http://127.0.0.1:3082/?token=xxxxxxxx
```

**复制整个地址**（含 token）在浏览器打开。

## 步骤 6：首次配置

面板打开后，进 **设置**，按顺序配：

1. **基本** — 确认数据目录、端口
2. **连接源** — 至少配一个（GitHub 最容易）
3. **权限与安全** — 填你的账号到白名单
4. **模型与算力** — 选模型、设预算

**第一次用建议**：接受模式保持 `observe`（只记录不执行），跑一周看看它的判断准不准。

---

# 方式二：白板版（独立完整包）

**适合**：没装过 DSH、或者想要一套完全独立的，不污染现有环境。

## 下载

从 [Releases](https://github.com/xyt071024/dsh-superagent-cn/releases) 下载：

```
dsh-superagent-standalone-v<版本>-<平台>.zip
```

平台后缀有三种：`win-x64` / `mac-arm64` / `linux-x64`。

## 解压后是什么

```
dsh-superagent-standalone/
├── dsh.exe              ← 启动器（Windows）
├── node/                ← 内置 Node 运行时，不用你装
├── profiles/
│   └── superagent/      ← 预配置好的 profile
├── plugins/             ← 插件本体
├── 启动.cmd             ← 双击就能跑
└── README.txt
```

## 怎么用

**Windows**：双击 `启动.cmd`

**macOS / Linux**：
```bash
chmod +x ./dsh
./dsh --profile superagent
```

**不需要安装程序**，解压即用。想卸载直接删文件夹。

## 和插件版的区别

| | 插件版 | 白板版 |
|---|---|---|
| 需要先装 DSH | 是 | **否**（内置） |
| 影响现有环境 | 不影响（独立 profile） | **完全隔离** |
| 升级方式 | `dsh plugin update` | 下载新压缩包覆盖 |
| 体积 | 小（几 MB） | 大（含 Node + DSH，约 200MB） |
| 适合 | 已有 DSH 的用户 | 全新用户、演示、隔离测试 |

---

# 常见问题

## Q：装完打不开 / 报错怎么办？

按这个顺序查：

| 症状 | 原因 | 解决 |
|---|---|---|
| `EADDRINUSE` | 端口被占 | 换端口，或杀掉旧进程 |
| `ValidationError: stateDir` | 路径格式不对 | 用绝对路径 + 正斜杠 |
| `cannot resolve profile bundle` | 包名不对 | 检查包的 `package.json` 里 `name` 字段 |
| `spawn env ENOENT` | 平台不兼容 | 见下方「平台差异」 |
| 白屏 / 401 | 没带 token | 用终端打印的完整地址（含 `?token=`） |

## Q：会不会影响我现有的插件？

**不会**，因为装在独立 profile 里。

但有一个**必须开的开关**：设置 → 高级 → **「隔离进程环境变量」**。

这个插件会修改进程的 `PATH`，把 `gh` 和 `lark-cli` 的包装脚本插到最前面。不开隔离的话，同进程的其它插件调用 `gh` 时会用到它的账号。

## Q：能不能装进我正在用的 profile？

技术上可以，但**不建议**。

如果你坚持要，必须：
1. 先备份 `~/.dsh/profiles/<你的profile>/cordis.patch.yml`
2. 开启「隔离进程环境变量」
3. 装完逐项验证原有插件是否正常

## Q：升级怎么做？

**插件版**：
```bash
dsh plugin --profile superagent update
```

**白板版**：下载新压缩包，覆盖解压。

**升级前务必备份** `<stateDir>` 整个目录。

## Q：卸载干净？

```bash
# 插件版
dsh plugin --profile superagent remove dsh-superagent

# 删掉 profile
rm -rf ~/.dsh/profiles/superagent

# 删掉数据（谨慎，会丢历史）
rm -rf <你的 stateDir>
```

**白板版**：直接删文件夹。

---

# 平台差异

本项目在 Windows 上做过完整适配，其它平台基本沿用官方实现。

| 平台 | 状态 | 注意 |
|---|---|---|
| **Windows 10/11** | ✅ 已适配 | 见下 |
| macOS | ✅ 预期可用 | 未完整实测 |
| Linux | ✅ 预期可用 | 未完整实测 |

## Windows 特别注意

官方实现按 POSIX 假设写的，Windows 上需要几处调整。**本项目已包含这些修复**，但你需要知道它们存在：

| 问题 | 表现 | 本项目处理 |
|---|---|---|
| 没有 `env` 命令 | `spawn env ENOENT` | 改用进程参数传环境 |
| 路径格式校验 | `stateDir` 必须是 `/` 开头 | 放宽为同时接受 `X:/` |
| 只有 `pwsh` 没有 `bash` | 工具注册失败 | 按平台自动选 shell |
| 重启时端口自我抢占 | `EADDRINUSE` | 先停旧进程再起 |

**启动方式**：Windows 上官方那个 `scripts/dsh-superagent start` 用不了（依赖 tmux），直接用：

```cmd
dsh --profile superagent
```

或者用项目提供的 `启动.cmd`。

---

# 需要你准备的东西

按需准备，不是全部都要：

| 连接源 | 需要什么 | 哪里拿 |
|---|---|---|
| GitHub | 已登录的账号 | 无需额外操作 |
| 企业微信 | 企业 ID + 应用 Secret + AgentId | 企业管理员后台 |
| QQ邮箱 | **授权码**（不是密码） | 邮箱设置 → 账户 → 开启 IMAP → 生成 |
| 飞书 | App ID + App Secret | 开放平台建自建应用 |
| Gmail | 应用专用密码 | 开两步验证后生成 |
| QQ | 已有的桥接配置 | 无需额外操作 |
| 微信 | 本地客户端扫码授权 | 首次启动时扫 |

---

# 最小可用配置（第一次用）

想先跑起来看看，就配这些：

```
连接源：只开 GitHub，填一个你有的仓库
权限：白名单只填你自己
模式：observe（只记录不执行）
预算：日 ¥10
自主权限：全关
```

**跑一周**，看它记录了哪些「想做的事」。觉得判断准，再逐项放开。

---

[← 返回首页](../index.html) | [完整文档](../docs/zh/01-overview.html)
