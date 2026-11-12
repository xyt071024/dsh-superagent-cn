# 安装

12 个包，按两件事选：**你的系统**和**要不要装 Node**。

名字读一遍就够，不用打开看：

```
Super-Agent-Bundled-Windows-x64-Stable-v0.2.0.zip
          ↑形态     ↑系统  ↑架构  ↑构建
```

---

## 先决定一件事：内置版还是纯净版

| | 内置版 Bundled | 纯净版 Clean |
|---|---|---|
| 大小 | 约 200 MB（下载）/ 解压后约 655 MB | 0.3 MB |
| 要先装 Node 吗 | **不用** | 要（22.19+ 或 24+） |
| 要先装 DSH 吗 | **不用** | 要 |
| 怎么跑 | 解压，双击 `start.cmd` | `dsh plugin add` |

**想省事就选内置版。** 它把 Node 运行时和 DeepSeek Harness 本体都装进包里了，解压双击就能跑，不需要事先装任何东西。
代价就是那个 655 MB —— 换来的是「不用折腾环境」。

**已经有 DSH 在跑、只想加这个插件**，就选纯净版，0.3 MB。

---

## 内置版：按系统选一个

| 系统 | 稳定版 | 破甲版 |
|---|---|---|
| **Windows x64** | [Bundled-Windows-x64-Stable](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-Windows-x64-Stable-v0.2.0.zip) | [Bundled-Windows-x64-Purge](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-Windows-x64-Purge-v0.2.0.zip) |
| **macOS Apple Silicon**（M1/M2/M3/M4） | [Bundled-macOS-arm64-Stable](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-macOS-arm64-Stable-v0.2.0.zip) | [Bundled-macOS-arm64-Purge](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-macOS-arm64-Purge-v0.2.0.zip) |
| **macOS Intel** | [Bundled-macOS-x64-Stable](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-macOS-x64-Stable-v0.2.0.zip) | [Bundled-macOS-x64-Purge](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-macOS-x64-Purge-v0.2.0.zip) |
| **Linux x64** | [Bundled-Linux-x64-Stable](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-Linux-x64-Stable-v0.2.0.zip) | [Bundled-Linux-x64-Purge](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-Linux-x64-Purge-v0.2.0.zip) |

不确定 Mac 是哪种芯片：左上角苹果菜单 → 关于本机 → 看「芯片」一栏。写 Apple M 几就是 arm64，写 Intel 就是 x64。

### 解压并启动

解压到任意目录（解压目录放哪都行，启动后不再依赖它）。

| 系统 | 启动 |
|---|---|
| Windows | 双击 `start.cmd` |
| macOS / Linux | `chmod +x start.sh && ./start.sh` |

第一次启动会自动做完这些，不需要你干预：

```
1. 把 profile 装到 ~/.dsh/profiles/superagent
2. 用包里自带的 Node 挑一个空闲端口（3082–3182）
3. 启动，打印一个带 token 的地址
```

然后终端会打印：

```
dsh web: http://127.0.0.1:3118/?token=xxxxxxxx
```

**端口是你自己机器上挑的，读你那行输出**，不要照着上面的例子点。

> 端口不设公共默认值：所有人都用同一个端口，等于给扫描器一个写好的号码，两台机器也没法并存。

> 如果之前装过 superagent，启动器会**拒绝覆盖**并提示你先移走旧的 `~/.dsh/profiles/superagent`。这是故意的：那个目录里有你的工单和设置。

---

## 纯净版：已经有 DSH 的话

只有插件本体，不含 Node 和 DSH。

| 构建 | 下载 |
|---|---|
| 稳定版 | [Super-Agent-Clean-Any-Platform-Stable-v0.2.0.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Clean-Any-Platform-Stable-v0.2.0.zip) |
| 破甲版 | [Super-Agent-Clean-Any-Platform-Purge-v0.2.0.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Clean-Any-Platform-Purge-v0.2.0.zip) |

解压后里面是一个 tgz，直接装：

```bash
dsh plugin add ./Super-Agent-Plugin-Stable-v0.2.0.tgz
```

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

## 稳定版和破甲版的区别

| | Stable | Purge |
|---|---|---|
| 改 DSH 本体吗 | 不改 | 改（86 处补丁） |
| 装完还要做什么 | 没了 | 额外两步：`dsh plugin add dsh-purge-community` 然后 `dsh purge apply` |
| 出问题怎么退 | — | `dsh purge revert` |

破甲版让模型对指令的服从更彻底。它**不改变**网关白名单：谁能派活仍然由配置决定。
用它之前请先读 [破甲说明](purge.html)。

---

## 配一个来源

打开面板 → 左侧 **Superagent** → **设置** → **来源**，挑一个配：

| 来源 | 要准备什么 | 状态会变成 |
|---|---|---|
| **QQ** | 一个 OneBot v11 端点地址 + 访问令牌（如 SnowLuma、NapCat） | 运行中 |
| **邮箱** | QQ 邮箱/Gmail 地址 + **授权码**（不是登录密码） | 运行中 |
| **GitHub** | 一个能推送到目标仓库的 `gh` 登录 | 运行中 |
| **飞书** | 一个机器人 app id / secret | 运行中 |

配好一个就能用。没配的会显示「待处理」并写清缺什么。

---

## `isolateEnvironment: true` 为什么是必须的

superagent 会往**进程级** `PATH` 里插入一个目录，里面放着 `gh` 和 `lark-cli` 的包装脚本，让执行器的命令走智能体自己的账号。

如果你的 profile 里还有别的插件（多数人的都有），它们调 `gh` 时会**静默拿到智能体的账号**，而不是你自己的。

打开 `isolateEnvironment` 后，这些变量只传给 superagent 自己起的子进程，不污染同进程的其他插件。

**独立 profile 里可以不开；融合进你的日常 profile 时必须开。**

---

## 版本要求

| | 内置版 | 纯净版 |
|---|---|---|
| Node.js | 自带，无需安装 | 22.19+ 或 24+ |
| DSH | 自带 0.2.2 | 0.2.1 或 0.2.2 系列 |
| 磁盘 | 约 655 MB | 约 10 MB + 工单目录 |

---

## 装不上时

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `EADDRINUSE` | 端口被占 | 重新跑安装器让它挑一个空闲端口，或改 `cordis.patch.yml` 里的 `port` |
| `The bundled Node runtime is missing` | 内置版没解压完整 | 重新解压；压缩包有 200 MB，确认下全了 |
| `Lock file is already being held` | 上一个实例没退干净 | 杀掉占用端口的 node 进程再启动 |
| `Cannot find module 'graceful-fs'` | 用的是早期发布的、没带依赖的包 | 重新下载本期包 |
| macOS 提示「无法验证开发者」 | 系统签名检查 | 右键点 `start.sh` → 打开，或 `xattr -d com.apple.quarantine start.sh` |
| 来源一直「待处理」 | 缺凭据 | 看状态下写的那句话，它说的是缺哪一项 |
| 面板侧边栏没有 Superagent | 插件没加载 | 看启动输出里有没有 `dsh-superagent` 的报错，把它贴到 issue |

---

## 卸载

| 形态 | 怎么卸 |
|---|---|
| 内置版 | 删掉 `~/.dsh/profiles/superagent` 和 `~/.dsh/state/superagent`，再删解压目录 |
| 纯净版 | `dsh plugin remove dsh-superagent`，再删上面两个目录 |
| 破甲版 | 先 `dsh purge revert`，再按上面两步删 |

不会留别的东西——除了你自己配的来源凭据，那些在 `~/.dsh/state/superagent/orchestrator.sqlite` 里。
