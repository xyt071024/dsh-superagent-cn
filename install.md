# 安装

两种形态，任选一种。**都需要先装 Node.js 22.19 或更新版本**（https://nodejs.org）。

---

## 方式一：白板版（解压即用，推荐）

不用先装 DSH。这份包自带 profile 配置，第一次启动会把它装到正确位置并拉取唯一一个依赖。

### 1. 下载

| 版本 | 下载 |
|---|---|
| 稳定版 | [superagent-native-stable.zip](https://xyt071024.github.io/dsh-superagent-cn/releases/dl/superagent-native-stable.zip)（1.7 MB） |
| 破甲版 | [superagent-native-purge.zip](https://xyt071024.github.io/dsh-superagent-cn/releases/dl/superagent-native-purge.zip)（1.7 MB） |

两版的区别只在破甲版额外依赖 `dsh-purge-community` 并需要多跑一次 `dsh purge apply`。其余完全相同。

### 2. 解压并启动

解压到任意目录（**解压目录放哪都行**，启动后不再依赖它）。

| 系统 | 启动 |
|---|---|
| Windows | 双击 `start.cmd` |
| macOS / Linux | `chmod +x start.sh && ./start.sh` |

第一次启动会做三件事，都是自动的：

```
1. 把 profile 装到 ~/.dsh/profiles/superagent
2. 把 stateDir 占位符替换成你的真实主目录
3. npm install 装那一个依赖
```

约 15 秒。之后终端会打印一个带 token 的地址，形如（**端口每次安装随机**，落在 3082–3182，读你自己那行输出）：

```
dsh web: http://127.0.0.1:3118/?token=xxxxxxxx
```

> 端口不设公共默认值：所有人都用同一个端口，等于给扫描器一个写好的号码，两台机器也没法并存。
> 想固定就用 `--port=<端口>`（Windows：`-SaPort <端口>`）。

点开它。

> 如果之前已经装过 superagent，启动器会**拒绝覆盖**并提示你先移走旧的 `~/.dsh/profiles/superagent`。这是故意的：那个目录里有你的工单和设置。

### 3. 配一个来源

打开面板 → 左侧 **Superagent** → **设置** → **来源**，挑一个配：

| 来源 | 要准备什么 | 状态会变成 |
|---|---|---|
| **QQ** | 一个 OneBot v11 端点地址 + 访问令牌（如 SnowLuma、NapCat） | 运行中 |
| **邮箱** | QQ 邮箱/Gmail 地址 + **授权码**（不是登录密码） | 运行中 |
| **GitHub** | 一个能推送到目标仓库的 `gh` 登录 | 运行中 |

配好一个就能用。没配的会显示「待处理」并写清缺什么。

---

## 方式二：插件版（已有 DSH）

### 一条命令

```bash
dsh plugin add https://xyt071024.github.io/dsh-superagent-cn/releases/dl/dsh-superagent-stable.tgz
```

破甲版把 `-stable` 换成 `-purge`。

包内已带全部运行时依赖（proper-lockfile、zod、graceful-fs、retry、signal-exit），**不需要联网装依赖**。

### 然后建 profile

```bash
dsh superagent --from-default-profile web --dump-config > /dev/null
```

在 `~/.dsh/profiles/superagent/cordis.patch.yml` 里加：

```yaml
- id: dsh-superagent
  config:
    stateDir: C:/Users/你的用户名/.dsh/state/superagent
    isolateEnvironment: true      # 必须为 true，见下方说明
- id: dsh-superagent-qq
  disabled: false
- id: dsh-superagent-mail
  disabled: false
```

启动：

```bash
dsh --profile superagent
```

---

## `isolateEnvironment: true` 为什么是必须的

superagent 会往**进程级** `PATH` 里插入一个目录，里面放着 `gh` 和 `lark-cli` 的包装脚本，让执行器的命令走智能体自己的账号。

如果你的 profile 里还有别的插件（多数人的都有），它们调 `gh` 时会**静默拿到智能体的账号**，而不是你自己的。

打开 `isolateEnvironment` 后，这些变量只传给 superagent 自己起的子进程，不污染同进程的其他插件。

**独立 profile 里可以不开；融合进你的日常 profile 时必须开。**

---

## 版本要求

| 项 | 要求 |
|---|---|
| Node.js | 22.19+ 或 24+ |
| DSH | 0.2.1 或 0.2.2 系列（peer 依赖为可选项，版本不完全匹配也能启动） |
| 磁盘 | 约 10 MB（插件）+ 工单目录 |

---

## 装不上时

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `EADDRINUSE: 3082` | 端口被占 | 重新跑安装器让它挑一个空闲端口，或改 `cordis.patch.yml` 里的 `port` |
| `invalid config: stateDir` | 白板版漏了替换占位符 | 手动把 `cordis.patch.yml` 里的 `__STATE_DIR__` 换成真实绝对路径 |
| `Lock file is already being held` | 上一个实例没退干净 | 杀掉占用端口的 node 进程再启动 |
| `Cannot find module 'graceful-fs'` | 用的是早期发布的、没带依赖的包 | 重新下载本期包 |
| `onExit is not a function` | 同上，`signal-exit` 版本不对 | 重新下载本期包 |
| 来源一直「待处理」 | 缺凭据 | 看状态下写的那句话，它说的是缺哪一项 |

---

## 卸载

| 形态 | 怎么卸 |
|---|---|
| 白板版 | 删掉 `~/.dsh/profiles/superagent` 和 `~/.dsh/state/superagent` |
| 插件版 | `dsh plugin remove dsh-superagent`，再删上面两个目录 |
| 破甲版 | 先 `dsh purge revert`，再按上面两步删 |

不会留别的东西——除了你自己配的来源凭据，那些在 `~/.dsh/state/superagent/orchestrator.sqlite` 里。
