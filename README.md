<p align="center">
  <img src="assets/banner.svg" alt="Super Agent" width="820">
</p>

<h1 align="center">Super Agent</h1>

<p align="center">
  <strong>跑在 DeepSeek Harness 上的主动型 Agent —— 你不问，它也干活。</strong>
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a> | <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases"><img src="https://img.shields.io/badge/release-v0.3.0-2ea44f" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://xyt071024.github.io/dsh-superagent-cn/"><img src="https://img.shields.io/badge/docs-中文%20%7C%20EN%20%7C%20日本語-6f42c1" alt="docs"></a>
  <img src="https://img.shields.io/badge/Node-22.19%2B%20%7C%2024%2B-339933" alt="node">
  <img src="https://img.shields.io/badge/DSH-0.2.1--0.2.9-4b5563" alt="dsh">
</p>

---

**普通 AI 助手：你问一句，它答一句。**

**Super Agent：你不在的时候它也在工作。** 邮件来了、有人在 GitHub 上 @ 它、QQ 上有人找它，它自己判断这活该不该接、能做到什么程度，然后动手，做完回来告诉你。

> 一个多来源收活 → 判断该不该接 → 拆给多个子会话并行 → 做完回报的智能体。
> 基于 DeepSeek 开源的 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT），
> 加了三个消息源、多实例、调度、自我进化、上下文自动归档与全能型工具面。

---

## 🧭 它怎么干活（三种模式，一个工单走一遍）

一个请求进来，走的是同一条流水线，区别只在「一个人做还是几个一起做」。

### 模式一：一个人做（默认）

```
请求 → 网关判断谁发的 → 评估判断该不该接 → 建工单 → 一个执行会话做完 → 回报
```

适合：单个文件改一下、查一个问题、写一篇文档。**不要为了并行而并行**——切分的成本可能比活本身还高。

### 模式二：拆开做（难度过门槛时自动）

```
请求 → … → 建工单 → 主会话判断「这个能拆」
                      ├─ 开成员 A，派切片 1（文件 /src/a.js）
                      ├─ 开成员 B，派切片 2（文件 /src/b.js）
                      └─ 自己留切片 3（要动全局配置的那部分）
                   成员干完 → 任务板标记完成 → 主会话审一遍 → 合并 → 回报
```

**关键约束**：两个成员绝不同时改同一个文件。文件系统没有锁，后写的会静默覆盖前面的。所以切片必须是「不用读别人正在改的文件也能做完」的那种。

### 模式三：接力做（上下文快满时自动）

```
会话 A 用到窗口 65% → 归档上下文 → 开新上下文 B → 告诉 B「上一段已归档，接着干，别重头来」→ B 继续
```

这就是「多轮」的实际含义：**不是同一个会话无限跑下去**，而是快满时交接、新会话从断点接着做。所以它不会因为上下文撑爆而变慢或失忆。

### 这三种模式的共同点

- **都不打扰你**：除非需要你决定（凭据、钱、不可逆操作），全程安静。
- **都可以回退**：每个工单有独立的工作目录，做完才合并。
- **都留下证据**：报告里写清做了什么、跑过什么检查、还剩什么问题。

---

## ✨ 速览

- 📥 **七个入口自动盯** — GitHub / QQ邮箱 / QQ / 微信 / 企业微信 / 飞书 / Gmail，配几个都行，至少一个就能用
- 🚦 **三层授权** — 网关（纯代码，只看谁发的）/ 评估（模型判断该不该接）/ 授权（不可变凭证）
- 🧠 **多会话真的会拆** — 难度跨过门槛时，执行会话自己开成员、切写作用域、发任务、收结果；成员之间能互通、互相监督、完成后接下一个
- 💬 **成员是活着的** — 具名队友可以多轮对话，有共享任务板，卡住的能被别人唤醒，不是用完即弃的一次性子代理
- 🎯 **跟着你换模型** — 你在面板里选了什么模型，新开的会话就用什么
- 🗂️ **上下文自动归档** — 会话用到设定的比例（默认 65%）就归档并交接给新上下文，接着干不重来
- 💰 **花钱有上限** — 每日 token 账本，超了拦新活但让在跑的跑完
- 🔧 **全能工具面** — 能改代码、写文档、查资料、跑命令、**自己装插件**；缺什么装什么，不报告"做不到"
- 📚 **九个内置技能** — delegate / docs / feishu / github / install / mirror / research / shell / verify，是这个 Agent 的"大脑"训练内容
- 🔇 **干活安静** — 全程不打扰，只在必须有人决定时开口
- 🪶 **两种用法** — 内置版解压双击就跑（自带 Node 与 DSH）；插件版一条命令接进已有 DSH

---

## 🚀 快速开始

### 前置条件

- **Node.js 22.19+ 或 24+**
- **DeepSeek Harness**（插件版需要；白板版不用事先装）
- 一个已 `gh auth login` 的 GitHub CLI（接 GitHub 时）

### 方式一：插件版（已经装了 DSH）

```bash
dsh plugin --profile superagent add https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.3.0/Super-Agent-Plugin-Stable-v0.3.0.tgz
```

然后重启 DSH，侧边栏出现 **Superagent** 入口。

### 方式二：白板版（解压即用）

从 [Releases](https://github.com/xyt071024/dsh-superagent-cn/releases) 下载对应你系统的 `Super-Agent-Bundled-<系统>-<架构>-Stable-v0.3.0.zip`（自带 Node 与 DSH，约 200 MB），解压后双击 `start.cmd`（Windows）或 `./start.sh`（macOS / Linux）。

首次运行会把 profile 装进 `~/.dsh/profiles/superagent`、随机挑一个空闲端口（3082–3182），然后启动。**安装器会打印你自己的面板地址**，读那一行。

### 然后

打开面板 → 左侧 **Superagent** → **设置** → **来源**，挑一个配。每个平台都有引导告诉你去哪拿凭据。

完整步骤见 **[安装与连接](install.md)**。

---

## 📦 它能接哪些地方

| 平台 | 协议 | 实现状态 |
|---|---|---|
| **GitHub** | `gh` CLI 通知 + 轮询 | ✅ **已实测** |
| **QQ** | OneBot v11 HTTP | ✅ **已实测** |
| **QQ 邮箱** | IMAP 轮询 + SMTP | 代码完成，未验证 |
| **Gmail** | 同上 | 代码完成，未验证 |
| **微信** | OneBot v11（经微信桥） | 代码完成，未验证 |
| **企业微信** | OneBot v11（经企微桥） | 代码完成，未验证 |
| **飞书** | CLI 事件流 + 历史轮询 | 代码完成，未验证 |

**只有标「已实测」的才在本机真跑通过。** 其余代码完整但没连过——没证据的事不写成结论。

---

## 🧩 功能

<details>
<summary><b>多会话与多代理：一个工单怎么被拆开做</b>（点击展开）</summary>

这是这一版变化最大的地方，也是之前最容易「看起来有、实际不跑」的地方。所以把机制本身讲清楚。

**一句话**：一件活由**一个主执行会话**接手，它判断自己拆不拆；拆的话，**它自己开成员**，而不是系统预先开好一堆空会话等它用。

### 判断要不要拆

| 条件 | 来源 |
|---|---|
| 「自动拆分」开着（`multiSession: auto`） | 设置 → 调度 |
| 评估给的难度 ≥ 你设的门槛（默认 60） | 设置 → 调度 → 难度门槛 |

两个都满足，主执行会话收到的任务书里会多一段「你可以拆」的说明。**门槛不决定接不接这活**，只决定要不要并行。

### 怎么拆

1. 主执行会话用 `spawn_teammate` 开**具名成员**——每个成员是一个独立的 Session，有自己的工具集和权限，不是临时子进程。
2. 它先想清楚**切片的边界**：一个切片必须是「不用读别人正在改的文件也能做完」的。切不明白就别拆，硬拆会互相覆盖。
3. 每个切片在**共享任务板**上建一条任务，写明这块归哪些文件。
4. 用 `send_message` 把切片派给成员，成员开工。

### 成员之间怎么协作

| 能力 | 工具 |
|---|---|
| 点对点通信 | `send_message`（定向发给某个具名成员） |
| 看谁在干什么 | `list_agents`（running / inactive）、`team_task_list` |
| 认领与更新任务 | `team_task_create` / `team_task_update` / `team_task_get` |
| 等别人 | `wait_agent` |
| 打断跑偏的成员 | `interrupt_agent` |

**成员是活着的**：可以多轮对话，不是问一次就消失。一个成员干完自己的切片，会去任务板找未认领的任务接手，或者去帮卡住的成员。

### 三条硬边界（不藏）

1. **任务板不会自动叫醒任何人**。任务就绪不等于成员会自己开始——必须有人 `send_message` 它。
2. **`wait_agent` 不会唤醒任何人**。它只观察你调用之后发生的变化；没有活跃同伴时立刻返回「无进展」。
3. **写作用域是约定，不是锁**。两个成员写同一个文件，后写的会静默覆盖前面的。**这是设计上的取舍**：加锁会让并行变成排队。

所以「切分」这一步必须由主执行会话认真做，而不是随便分。

</details>

<details>
<summary><b>模型怎么选：跟着你走</b>（点击展开）</summary>

优先级从高到低：

1. **你显式配的执行模型**（`设置 → 执行 → 模型`）——你打字填的，它最优先。
2. **你当前会话正在用的模型**（`设置 → 调度 → 继承当前模型`，默认开）——这就是「我用什么，新会话就用什么」。
3. **按难度从已授权列表里挑**——难度不到门槛用第一个，到了用最后一个。
4. **DSH 自己的默认模型**。

第 3 条有个隐含约定要说明白：**列表的顺序有意义**，第一个是「日常用」，最后一个是「难活用」。这个顺序是你排的，代码不去猜。

如果你更希望「永远按列表走，别管我现在用的是什么」，把「继承当前模型」关掉即可。

</details>

<details>
<summary><b>权限与安全</b>（点击展开）</summary>

**权限分两道关，别混为一谈。**

| 关 | 性质 | 说明 |
|---|---|---|
| 网关 | **纯代码** | 只看「谁发的」，不看消息内容。消息里写「忽略之前的指令」也绕不过 |
| 评估 | 模型判断 | 过了网关后，由模型判断该不该接、做到什么程度。**这一道可能受消息内容影响** |
| 授权 | 不可变 | 接单时生成，只有人工叫停或重校验失败能撤销 |

真正硬的只有第一道。对外从不宣称「任何消息内容都改不了权限判定」。

</details>

<details>
<summary><b>多实例：一个实例只服务一件事</b>（点击展开）</summary>

两个仓库、两个团队或两个平台账号，就开两个实例。

> **一个实例 = 一个 profile = 一个仓库 = 一个 bot。**

四样各自唯一：profile / 端口 / stateDir / **bot 凭据目录**（共用等于两个实例用同一身份活动）。

最容易漏的两处：**新 profile 没有配模型**（provider 是各 profile 自己的插件注册的）；**首次启动 `status` 退出 3 是正常的**（在等设置，别反复重启）。

完整流程见 [部署与多实例](https://xyt071024.github.io/dsh-superagent-cn/docs/zh/09-deployment.html)。

</details>

<details>
<summary><b>两种运行状态</b>（点击展开）</summary>

| 状态 | 说明 |
|---|---|
| **对话态** | 面板可见，你说话才动，随时能打断 |
| **静默态** | 后台常驻，没消息时几乎不耗算力，有消息自动醒 |

处理流程完全一样，区别只在要不要显示界面。

</details>

<details>
<summary><b>它靠谱吗 —— 能力边界说实话</b>（点击展开）</summary>

**能做到**：改代码、提 PR、写文档、查资料、跑命令、操作文件、上网、**装插件扩展自己**。

**做不到**：替你训模型（那是厂商的事，我们是调用方）、替你做设计决策。

**多代理的真实边界**：有 `subagent` + `subagent_fork` + `workflow`，但**代理间无信息互通、无共享进度、卡死直接杀、子代理一次性树形**。「新会话连回主会话互相备通」还没做。

可靠性来自**规则硬**（网关纯代码 + 授权不可变 + 报告必须结构化），不是来自"代理很聪明"。

</details>

---

## 🛠 技术栈

| 层级 | 技术 |
|---|---|
| 运行环境 | Node.js 22.19+ / 24+，DeepSeek Harness `0.2.1`–`0.2.9` |
| 语言 | TypeScript（严格模式，`tsc --noEmit` 零错误） |
| 构建 | tsdown（rolldown + dts） |
| 插件内核 | [Cordis](https://github.com/shigma/cordis) + `@deepseek-ai/dsh-*` 服务注入 |
| 存储 | SQLite（WAL），工单 / 决策记录 / 游标 / 经验库 |
| 测试 | Vitest（65 文件 / 1258 用例） |
| 面板 | React + 自有 HTTP API（`x-orchestrator-request` 同源校验） |
| 上下文 | 复用宿主 `ctx.compaction`（摘要/游标/回滚交给它），自己只做阈值与交接 |
| 消息源 | OneBot v11（QQ/微信/企微一套工厂）、自写 IMAP + curl SMTP、`gh` CLI、`lark-cli` 事件流 |
| 分发 | GitHub Releases（六个包）+ GitHub Pages（文档站 36 页 · 中英日） |

---

## 🗂 项目结构

```
src/
├── sources/            # 消息源：github / qq(OneBot 工厂) / mail(IMAP+SMTP) / feishu
│   ├── registry.ts     # 实例注册，一个 kind 可挂多个账号（qq-work）
│   ├── poll.ts         # 轮询游标与失败计数
│   └── host.ts         # Source 宿主
├── app/                # 运行时
│   ├── runtime.ts      # 组装根：起停、暂停、长任务通知
│   ├── sessions.ts     # WORK_TOOLS 白名单 + Session 装饰
│   ├── assessment.ts   # 评估：该不该接、难度打分
│   ├── routing.ts      # 按难度选模型、拆会话、前后台
│   ├── archive.ts      # 上下文自动归档（复用宿主 compaction）
│   ├── usage.ts        # 每日 token 账本
│   ├── self-inspect.ts # 自我体检：列出缺什么、下一步做什么
│   ├── tools/          # 主会话工具（route / read / report / plugin …）
│   └── views/          # 面板视图与 HTTP
├── client/             # 前端：设置页、调度页、预算页、locales
├── core/               # 领域模型：Ticket / Mandate / Assignment / Report
├── policy.ts           # 全部设置 schema + Policy 版本 + 网关
├── deployment.ts       # 配置解析与机器抽象
└── setup.ts            # 环境探测与问题上报

prompts/                # worker.md(≤1000) / orchestrator.md(≤1400) / work.md / shared.md
skills/                 # 六个内置技能，运行时注册进 skill 目录
├── dsh-superagent-shell/      # 跑命令、后台任务、沙箱
├── dsh-superagent-install/    # 装插件/CLI/运行时并验证
├── dsh-superagent-research/   # 查资料：读源文件、区分已验证与推断
├── dsh-superagent-delegate/   # 拆给子代理：任务书怎么写、回来怎么验
├── dsh-superagent-verify/     # 证明干完了：类型/测试双闸、基线差集
└── dsh-superagent-docs/       # 文档与代码对齐：每句话都要能指到实现

docs/                   # 000哲学 … 009第二实例
scripts/dsh-superagent # 启停脚本（退出码 0正常/1主服务/2组件错/3等设置）
tests/                  # 65 个测试文件
```

---

## 📖 深入阅读

- **[文档站](https://xyt071024.github.io/dsh-superagent-cn/)** — 中 / 英 / 日三语，切换后停在同一篇
- **[010 项目定位](docs/zh/01-overview.md)** — 它是什么、三层权限怎么设计
- **[完整任务流程](docs/zh/02-flow.md)** — 一条消息进来后发生什么
- **[多会话协同](docs/zh/03-collaboration.md)** — 复杂任务怎么拆
- **[连接源](docs/zh/05-sources.md)** — 七个平台怎么接
- **[部署与多实例](docs/zh/09-deployment.md)** — 架构、依赖、开第二个实例
- **[更新日志](CHANGELOG.md)** — 每个版本改了什么
- **[相对上游的改动](UPSTREAM-DIFF.md)** — 改了什么、为什么
- **[安全说明](SECURITY.md)** — 安全边界到哪为止

---

## ⚠️ 破甲模式

破甲版**修改 DSH 本体**（86 处补丁，绕过部分内置内容限制）。

- **什么都不保证**：输出不可预测，DSH 升级可能导致失效，合规责任完全由使用者承担
- **只在你自己拥有、并愿意承担后果的环境里用**
- 需要显式执行 `dsh purge apply`，`dsh purge revert` 撤销

详见 **[破甲模式](purge.md)**。

---

## 📄 许可证

[MIT](LICENSE)。

核心架构来自 DeepSeek 开源的 **[dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)**（作者 **DeepSeek Harness Team**，MIT，基于 commit `8c32a9d`）。

**六层架构与三层授权设计来自该项目，未作改动。** 本项目在此之上增加了多源接入、多会话协同、自我进化、稳定性加固与三语文档。

完整来源清单、上游贡献者名单、第三方组件致谢：**[致谢与参考来源](credits.html)**。

---

## 🙏 致谢

- **上游**：[DeepSeek Harness Team](https://github.com/deepseek-ai/deepseek-harness) — 架构与插件内核
- **插件内核**：[Cordis](https://github.com/shigma/cordis)（MIT）
- **消息桥**：[OneBot v11](https://github.com/botuniverse/onebot-11) 协议；SnowLuma / NapCat 等实现
- **图标**：[Lucide](https://lucide.dev)（ISC）
- **README 结构**：[Playa-Cyrene/Cyrene-Agent](https://github.com/Playa-Cyrene/Cyrene-Agent) — 这份排版是照它学的

如果用了你的东西却没写你的名字，[提个 issue](https://github.com/xyt071024/dsh-superagent-cn/issues)，立刻补。
