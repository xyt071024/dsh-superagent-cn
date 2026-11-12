# 下载

Super Agent for DeepSeek Harness v0.2.0 的全部安装包。

名字读一遍就够，不用打开看：`Super-Agent-Bundled-Windows-x64-Stable-v0.2.0.zip`
—— 形态 · 系统 · 架构 · 构建。

---

## 内置版 Bundled：自带你需要的一切

**不需要先装 Node.js，也不需要装 DSH。** 解压双击就跑。

每个包约 200 MB 下载、解压后约 655 MB —— 里面是完整的 Node 22.19 运行时加 DeepSeek Harness 本体及其依赖。

| 系统 | 稳定版 | 破甲版 |
|---|---|---|
| Windows x64 | [Stable](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-Windows-x64-Stable-v0.2.0.zip) | [Purge](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-Windows-x64-Purge-v0.2.0.zip) |
| macOS arm64（M 系列） | [Stable](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-macOS-arm64-Stable-v0.2.0.zip) | [Purge](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-macOS-arm64-Purge-v0.2.0.zip) |
| macOS x64（Intel） | [Stable](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-macOS-x64-Stable-v0.2.0.zip) | [Purge](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-macOS-x64-Purge-v0.2.0.zip) |
| Linux x64 | [Stable](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-Linux-x64-Stable-v0.2.0.zip) | [Purge](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Bundled-Linux-x64-Purge-v0.2.0.zip) |

解压后：Windows 双击 `start.cmd`；macOS / Linux 跑 `chmod +x start.sh && ./start.sh`。

第一次启动会自动铺 profile、用包里自带的 Node 挑一个空闲端口（3082–3182）并打印带 token 的地址。**端口是你机器上挑的，读你自己那行输出。**

不确定 Mac 是哪种芯片：左上角苹果菜单 → 关于本机 → 「芯片」一栏。Apple M 几 = arm64，Intel = x64。

---

## 纯净版 Clean：只有插件

给已经装好 Node.js 和 DSH 的人。0.3 MB，解压后是一个 tgz。

| 构建 | 下载 |
|---|---|
| 稳定版 | [Clean-Any-Platform-Stable](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Clean-Any-Platform-Stable-v0.2.0.zip) |
| 破甲版 | [Clean-Any-Platform-Purge](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Clean-Any-Platform-Purge-v0.2.0.zip) |

解压后：

```bash
dsh plugin add ./Super-Agent-Plugin-Stable-v0.2.0.tgz
```

包内已带全部运行时依赖，不需要联网装依赖。

也可以直接装 tarball，不下载 zip：

| 构建 | tarball |
|---|---|
| 稳定版 | [Super-Agent-Plugin-Stable-v0.2.0.tgz](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Plugin-Stable-v0.2.0.tgz) |
| 破甲版 | [Super-Agent-Plugin-Purge-v0.2.0.tgz](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Plugin-Purge-v0.2.0.tgz) |

---

## ⚠️ 破甲版说明

破甲版（Purge）会修改 DSH 本体（86 处补丁），让模型对指令的服从更彻底。
它**不改变**网关白名单：谁能派活仍然由配置决定。

装完还要额外两步：

```bash
dsh plugin add dsh-purge-community
dsh purge apply          # 撤销：dsh purge revert
```

用之前请先读 [破甲说明](../purge.html)。

---

## 为什么内置版这么大

| 内容 | 大小 |
|---|---|
| Node.js 22.19 运行时（已裁剪，去掉 npm 与头文件） | 约 110 MB |
| DeepSeek Harness 本体及其依赖 | 约 490 MB |
| Super Agent 插件 + profile 骨架 | 约 2 MB |
| **压缩后** | **约 200 MB** |

白板版用不到的 LibreOffice 文档组件（182 MB）已经裁掉。
换来的是「解压双击就能跑，不用先装任何东西」——不内置的话，你就得自己装 Node、再装 DSH，那正是这个包想省掉的事。

**每个包只含自己平台的 Node**，所以有四个系统分支：Windows 的包在 macOS 上跑不了，反过来也一样。

---

## 装不上时

| 现象 | 怎么办 |
|---|---|
| `EADDRINUSE` | 重新跑安装器让它挑端口，或改 `cordis.patch.yml` 里的 `port` |
| `The bundled Node runtime is missing` | 包没解压完整，重新解压 |
| `Lock file is already being held` | 上一个实例没退干净，杀掉占用端口的 node 进程 |
| macOS 提示「无法验证开发者」 | 右键 `start.sh` → 打开，或 `xattr -d com.apple.quarantine start.sh` |
| 面板没有 Superagent 入口 | 看启动输出里 `dsh-superagent` 的报错，贴到 issue |

完整排查见 [安装说明](../install.html)。
