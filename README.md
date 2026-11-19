<p align="center">
  <img src="assets/banner.svg" alt="Super Agent" width="820">
</p>

<h1 align="center">Super Agent</h1>

<p align="center">
  <strong>跑在 DeepSeek Harness 上的主动型 Agent。</strong>
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a> | <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases"><img src="https://img.shields.io/badge/release-v0.3.10-2ea44f" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://xyt071024.github.io/dsh-superagent-cn/"><img src="https://img.shields.io/badge/docs-中文%20%7C%20EN%20%7C%20日本語-6f42c1" alt="docs"></a>
  <img src="https://img.shields.io/badge/Node-22.19%2B%20%7C%2024%2B-339933" alt="node">
  <img src="https://img.shields.io/badge/DSH-0.2.2-4b5563" alt="dsh">
</p>

---

**普通 AI 助手：你问一句，它答一句。**

**Super Agent：你不在的时候它也在工作。** 邮件来了、有人在 GitHub 上 @ 它、QQ 上有人找它，它自己判断这活该不该接、能做到什么程度，然后动手，做完回来告诉你。

> 一个多来源收活 → 判断该不该接 → 拆给多个子会话并行 → 做完回报的智能体。
> 基于 DeepSeek 开源的 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT）。

---

## 能力与验证状态

| 能力 | 状态 |
|---|---|
| Windows x64 首次启动 | ✅ 已验证 |
| 包内插件与源码一致 | ✅ 8/8 哈希相同 |
| 四平台原生模块归位 | ✅ 零错平台 |
| 压缩包完整性 | ✅ 11/11 通过 |
| macOS / Linux 真机启动 | ⚠️ 未验证（无对应机器） |
| 各通道真实收发 | ⚠️ 未验证（仅协议层） |
| 上下文达阈值后交接新会话 | ✅ 已实现（单元测试覆盖） / ⚠️ 真实宿主未验收 |
| 多会话 / 独立复查 | ⚠️ 默认关闭，需手动开启 |

---

## v0.3.10 更新内容

本版修的是 Linux 真机全功能实测发现的五个阻断性问题。上一版的包能解开、校验全过，但按文档操作装不成能用的东西：解压后启动器报「Node 运行时缺失」而 Node 就在包里、面板起来了但插件从未加载、智能体没有 shell、仓库源码与发布版相差九个版本。

### 修复

**1. Linux 与 macOS 包的目录权限为零，解压后无法启动**

打包时目录条目只写了「这是一个目录」的标记，没有写 Unix 权限位。解压工具据此创建出权限为零的目录，里面的文件全部读不到、执行不了。启动脚本随后报告「未找到内置 Node 运行时」，把用户引向重新下载 200 MB —— 而文件一直都在。

现在目录条目按 0755 写入，四个平台的包各校验一遍：零权限目录数量为零，启动器与内置 Node 均为 0755，原生模块带执行位。打包完成后立即读回归档自检，不合格的包当场删除并阻止发版。

**2. 插件从未被安装进 profile，面板启动的是没有 Super Agent 的 DSH**

profile 声明插件为依赖，但安装包里只有插件的依赖树，没有插件本身；启动脚本把插件包复制到 profile 目录就结束了，没有任何一步解开它。DSH 启动时找不到该依赖，跳过加载，界面上看不出区别。

现在打包阶段就把插件解到 profile 的依赖目录下，安装后即为可用状态。解包后校验包名与入口文件存在，不符即中止打包。

**3. Linux 包缺少一个跨平台依赖，智能体的执行能力整体不可用**

打包时按包名里的平台标记裁剪依赖，把 `@deepseek-ai/dsh-win32-process` 当成 Windows 专用包删掉了。该包虽以 win32 命名，代码是纯 JavaScript，在所有平台都会被引用；缺少它导致子进程、沙箱、终端、工作区变更一连串服务无法加载。

现在只裁剪真正的平台替代包（被父包声明为可选依赖的那些），其余按硬依赖保留；铺装完成后遍历每个包的依赖声明逐个校验能否解析，缺任何一个即中止并报出包名。

**4. 一键安装脚本默认安装上个旧版本**

`install.sh`、`install.ps1` 及两份文本副本中的默认下载地址仍指向 v0.3.0。该地址有效，因此不会报错，只会静默装上一个落后九个版本的插件，接力、识别、打包等全部修复都拿不到。

现在四个脚本统一使用固定文件名的永久地址，后续发版无需再改脚本。

**5. 仓库源码与发布版脱节，任何人无法从源码构建出发布版**

仓库中的源码目录仍停留在 0.2.0，而发布版是 0.3.9：插件的十项修复只存在于编译产物、接力测试文件不在仓库、打包脚本目录整个缺失、若干提示词与技能文件版本不一致。任何人都无法审计或复跑这些修复。

现在源码、测试、提示词、技能、语言包、文档、服务脚本与打包工具已全部同步为 0.3.10，仓库与发布包一一对应。

### 改进

**QQ 通道的消息类型识别**

语音、视频、文件、位置、名片、窗口抖动等消息段此前一律返回空文本，与「发了一条空消息」无法区分，接单判断因此拿不到任何内容。现在每类消息都给出明确标识，卡片消息额外提取标题。私聊消息尚未支持，配置项已标注。

**飞书通道的异常行处理**

事件流中无法解析的行此前被静默丢弃，健康状态仍显示正常，事件就这样消失。现在会记录包含解析错误与原始片段的状态，并继续处理后续行。

### 测试

新增 QQ 消息段识别用例 2 项（覆盖 9 种段类型与卡片标题提取）。源码测试全量 1349 项。

### 已知限制

- 目录权限与插件加载的修复已通过包内容校验与解压验证，**尚未在 Linux 与 macOS 真机重新跑通启动**
- 子代理可用的工具集与测试期望相差三项（插件管理等），**该差异是否有意尚未定论**
- 主会话与子会话的上下文阈值接力仍未覆盖
- 各通道真实账号收发、真实宿主故障注入未验收

---

## 下载

| 你的情况 | 选这个 |
|---|---|
| 已装 DSH | `Super-Agent-Plugin-v0.3.10.tgz` |
| 未装 Node / 未装 DSH（Windows） | `Super-Agent-Bundled-Windows-x64-v0.3.10.zip` |
| 未装 Node / 未装 DSH（macOS Apple 芯片） | `Super-Agent-Bundled-macOS-arm64-v0.3.10.zip` |
| 未装 Node / 未装 DSH（macOS Intel） | `Super-Agent-Bundled-macOS-x64-v0.3.10.zip` |
| 未装 Node / 未装 DSH（Linux） | `Super-Agent-Bundled-Linux-x64-v0.3.10.zip` |

内置包解压后双击 `start.cmd`（Windows）或 `./start.sh`，自动把 profile 装到 `~/.dsh/profiles/superagent` 并选空闲端口启动。

```bash
# 插件版安装
dsh plugin add ./Super-Agent-Plugin-v0.3.10.tgz
```

---

## 工作模式

一个请求进来，走同一条流水线，区别只在「一个人做还是几个人一起做」。

### 单个执行（默认）

主会话收到活 → 判断该不该接 → 交给执行会话 → 做完回报。

### 多人协作（`multiSession: auto`）

难度跨过门槛时（默认按交办说明长度判断，1200 字符），执行会话收到「这活可以拆」的说明，然后用 Agent Teams 开成员、切写作用域、派任务、收结果。

默认 `single`，需在设置中开启。

### 独立复查（`reviewEnabled`）

复杂工单完成后另开一个只读审查员。它拿到工单、改动范围、验收标准，看不到执行过程，因此不受执行者思路影响。

审不过则打回修复再复审，最多 3 轮。审查员身份绑定（`reviewerId`），换人会被拒；审查期间工作树有变化（`reviewSnapshot` Git 指纹不符）也会被拒。

默认关闭。

---

## 已知限制

**跨会话接力已实现，但未在真实宿主验收。**

接力的四个阶段均有单元测试覆盖：会话身份、摘要内容、拒绝条件、崩溃恢复。尚未验收的是真实 DSH 中的端到端行为——切换期间并发输入、活跃 Team 的实际绑定、进程强制重启后的恢复，这些需要真实会话与故障注入环境，当前测试只到 Runtime + SQLite 层。

**多会话与独立复查默认关闭。** 拆分会显著增加 token 消耗，故默认不开启。

**各通道未做真实收发验收。** 已通过本地模拟服务器验证 OneBot / IMAP / SMTP 的协议行为与错误映射；真实账号的登录、收发、断线恢复、重启去重未验证。

**Windows 上 36 项测试失败。** 测试脚本依赖 POSIX 命令、符号链接、POSIX 权限位，以及无扩展名脚本模拟 CLI。另 1 项（git config 引号转义）存疑待确认。这不是功能故障，但不等于「测试全过」。

---

## 架构

```
请求进来（CLI / 面板 / QQ / 邮箱 / GitHub / 飞书）
        │
        ▼
   主会话（路由、派单、跟进度）
        │
        ▼
   执行会话（worker）── 缺少能力？自己装插件
        │
        ├─ 难度够了 → Agent Teams 拆多人协作
        │
        └─ 复杂工单 → 独立复查员（只读、看不到执行过程）
```

**四条设计约束**：

1. **`isolateEnvironment: true` 必开** —— 插件会改 process-wide `PATH` 和 git 配置，不开则 worker 的 `gh` / `lark-cli` shim 会静默替换 20+ 个插件的同名命令
2. **上下文归档复用宿主 `ctx.compaction`** —— 缺 `tokenMeter` 或 `compaction` 时整体不启用，不做假归档
3. **单一插件包** —— 不为同一份代码打多个包
4. **判断 agent 能力强弱，看工具清单，不看自述**

---

## 测试情况

```
typecheck        0 错
build            0 错
测试             1349 项 通过 / 35 失败
```

失败项原因见上文「已知限制」。

---

## 从源码构建

```bash
pnpm install
pnpm typecheck
pnpm build            # 产物在 lib/
pnpm test
```

打包发行物：

```bash
node _tools/build-packages.mjs     # 插件 tgz
node _tools/make-dist.mjs          # 铺包目录 + 装配跨平台原生模块
node _tools/make-dist-zips.mjs     # 串行 zip64 压缩
```

压缩必须串行（三并发可耗尽十几 GB 内存）。zip64 为手写实现——`Compress-Archive` 不支持 zip64，而单个内置包 7.6 万条目超过经典 zip 的 65535 上限。

---

## 致谢

**上游**

- [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) — MIT — 本项目直接来源
- [DeepSeek Harness](https://github.com/deepseek-ai) — 宿主框架

**技术参考**

- RFC 6455（WebSocket） · RFC 5321/5322（SMTP/IMAP） · Playwright（浏览器自动化） · MCP（工具协议）

本项目不是官方发行版，也未获上游作者背书。

---

## 许可证

MIT。见 [LICENSE](LICENSE)。
