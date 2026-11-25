<p align="center">
  <img src="assets/hero-cover.jpg" alt="Super Agent — Autonomous Multi-Session Orchestrator for DeepSeek Harness" width="920">
</p>

<h1 align="center">Super Agent · 超级智能体</h1>

<p align="center">
  <strong>运行在 DeepSeek Harness (DSH) 上的全天候主动型多会话工程智能体</strong><br>
  <sub>多渠道异步接活 · 三层代码级权限门禁 · 自主多对话并行拆解与槽位模型混配 · 60% 无损上下文接力 · 独立审查闭环</sub>
</p>

<p align="center">
  <a href="README.md"><strong>简体中文</strong></a> &nbsp;·&nbsp;
  <a href="README.en.md">English</a> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="https://xyt071024.github.io/dsh-superagent-cn/">在线文档中心</a> &nbsp;·&nbsp;
  <a href="https://xyt071024.github.io/dsh-superagent-cn/install.html">安装指南</a>
</p>

<p align="center">
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases"><img src="https://img.shields.io/badge/Release-v0.3.17-10b981?style=flat-square" alt="Release v0.3.17"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-38bdf8?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-22.19%2B%20%7C%2024%2B-339933?style=flat-square" alt="Node.js">
  <img src="https://img.shields.io/badge/DSH-0.2.1%2B-6366f1?style=flat-square" alt="DeepSeek Harness">
  <img src="https://img.shields.io/badge/Tests-1361%20Passed%20%7C%200%20Failed-2ea44f?style=flat-square" alt="Tests">
</p>

---

## 为什么需要 Super Agent？

传统的对话式 AI 助手遵循**「你问一句、它答一句、关掉即停、窗口满了就失忆」**的被动模式。一旦遇到跨模块的大型工程改造、多渠道涌入的协作请求，或者耗时数十分钟的长链路任务，单窗口对话很快就会陷入上下文膨胀、改前忘后、无人复核的困境。

**Super Agent (`dsh-superagent`)** 将 DeepSeek Harness 升级为一套完整的**自治研发协调系统**：

- **主动接单，而非被动等待**：统一监听 **GitHub、飞书、个人 QQ、官方 QQBot、微信、企业微信、IMAP/SMTP 邮箱（含 Gmail）** 以及 DSH 本地聊天窗口。消息到达后先经代码级安全网关与语义评估，符合授权规则才立项为持久化 **工单（Ticket）**。
- **简单事秒办，复杂活拆团**：单点修改直接由单会话快速交付（**0 额外会话开销**）；跨模块复杂任务自动规划拆解为多个**可在宿主侧边栏独立点开、随时人工追问的分工对话（Division Sessions）**。默认每任务最多开 **5** 个独立分工对话，用户可自由调大或调小（无硬性 16 上限），每个位置均可单独指定 `供应商/模型` 或留空继承当前主模型。
- **60% 阈值无损上下文接力**：无论是主协调会话、工单执行会话、团队子代理还是独立分工对话，一旦上下文占用达到设定比例（默认 **60%**），系统自动提炼原始意图、约束、尾部最新进度与未认领任务，平滑切换到新一代会话（`r1 → r2 → r3`），旧窗口追问自动路由至最新代次。
- **独立复查与返工闭环**：全部分工完成后，系统自动拉起**只读权限的独立复查对话**，与当前成果集版本指纹强绑定；发现缺陷精准打回责任分工修复并进入下一轮复审（最多 **3 轮**），彻底杜绝「自己写代码自己喊通过」。

---

## 全景架构

<p align="center">
  <img src="assets/architecture-flow.svg" alt="Super Agent 全链路架构图" width="960">
</p>

### 核心设计铁律

1. **三层硬隔离权限（Code Gate → Semantic Eval → Credential Mandate）**
   准入白名单、工具写权限、环境变量注入与消息字数上限全部由宿主代码强制执行。任何外部消息、网页内容、评论或提示词重写都**绝对无法放大权限或绕过授权边界**。
2. **协调与执行彻底解耦**
   主协调会话（`dsh-superagent-router`）只做毫秒级路由、派单与状态汇总，前台命令与任务等待超过 **5 秒**立即转入后台异步唤醒，绝不阻塞后续新消息。重型编码、测试与 Git 操作全部在隔离工作目录（Worktree）的执行会话（`dsh-superagent-worker`）中无人值守完成。
3. **全状态 SQLite 原子持久化**
   工单、分工计划（`TaskPlan`）、待投递回执队列（`pendingDeliveries`）、会话接力路由表（`SessionRelay`）、复查历史（`reviewHistory`）与每日 Token 预算均保存在本地 SQLite WAL 数据库中，进程重启或网络抖动后可幂等恢复，已完成工作绝不重跑。
4. **环境与命令垫片隔离（`isolateEnvironment: true`）**
   为每个工单生成受控的 `gh` / `lark-cli` 账号包装器与命令黑名单垫片，严格限制在工单作用域内，绝不污染宿主机全局 `PATH` 或用户的日常配置。

---

## 四大核心引擎详解

### 1. 自主多对话拆分与按槽位混配模型（Division Coordinator）

<p align="center">
  <img src="assets/multi-session-collab.jpg" alt="自主多会话并行与独立审查" width="880">
</p>

当路由设置开启 **`multiSession: auto`** 时，`DivisionCoordinator` 会综合评估请求的跨模块信号、并行结构与交办复杂度：

- **按需弹性创建，绝不盲目开满**：简单问题开启 `0` 个额外会话；复杂工单或聊天请求自动识别显式角色分句（如“一人做 API、一人做前端 UI、一人做测试”）、编号清单与八大工程轨道（`api`、`ui`、`db`、`auth`、`security`、`test`、`docs`、`deploy`），按实际需要创建独立会话。
- **默认上限 5，用户无上限自由调节（`M07-m`）**：新装默认允许每个任务开启最多 **5** 个额外分工对话（发起任务的对话本身与独立复查对话均不占名额）。用户可在面板或 API 中将其调小（如 `1`、`3`）或调大（如 `8`、`17`、`32` 乃至更大正整数）。当待拆分子项超过设定限额 `N` 时，前 `N` 项按拓扑依赖开启独立会话，其余子项自动保存在 `deferredDivisions` 中对主会话与面板保持可见。
- **逐槽位异构模型编排**：第 `1..N` 个分工槽位可分别指定不同厂商与模型（例如槽位 1 用推理模型攻克核心架构，槽位 2 用前端强项模型写界面，其余槽位留空自动继承发起任务时的模型），大数值槽位在面板中支持按批浏览并直达第 `N` 末位。
- **动态修订计划无损演进**：任务中途修改计划时，未变更且已完成的分工完整保留成果；修改要求的分工自动归档旧版成果至 `resultHistory` 并递增 `revision`；被移除的运行中分工先主动取消宿主会话、确认停止后再释放槽位并阻断迟到写入。

### 2. 全角色 60% 阈值无损上下文接力（Endless Context Relay）

<p align="center">
  <img src="assets/context-relay-engine.jpg" alt="60% 阈值无损上下文接力引擎" width="880">
</p>

长任务的头号杀手是上下文窗口耗尽后的注意力退化与暴力截断。Super Agent 的 `SessionRelay` 覆盖**主协调会话、工单执行会话、子代理（Subagent）与独立分工会话**全部四种角色：

- **分段预算保尾摘要**：当会话上下文达到设定阈值（默认 **60%**，可在 `20%–95%` 调整）时，系统将摘要空间独立分配给「原始任务目标与约束」和「最近会话尾部进度 + 未认领共享任务」，确保最关键的最新进展永不丢失。
- **先切指针、后发唤醒**：交接摘要先以静默注入方式写入新代会话历史，待 SQLite 原子事务正式提交新会话指针与 `pendingActivation` 标记后才投递唤醒消息，彻底消除新旧两代会话同时跑同一份活的竞态。
- **多代路由穿透与断线补救**：支持 `r1 → r2 → r3` 无限代连续接力；用户在已被取代的旧会话窗口继续打字追问时，消息会被实时拦截并以幂等键转发至最新一代会话；若唤醒瞬间遇网络异常，重启或恢复流程会自动补投唤醒而不重发初代派工指令。

### 3. 内置 14 项工程与渠道技能包 + 结构化任务清单工具

插件开箱内置 **14 项渐进式加载技能（`DSH_BUNDLED_SKILL_DIR`）** 与分工专属工具集，按需注入而不浪费基础上下文预算：

| 类别 | 内置技能 / 工具名称 | 核心能力说明 |
|---|---|---|
| **代码与架构导航** | `dsh-superagent-code-navigation` | 单一事实源先读后改、并行搜索批处理、锁文件工具链识别与最多 3 次编译修复上限 |
| **自主规划循环** | `dsh-superagent-planning-loop` | 诊断/实现双模式门禁、`Analyze → Plan → Execute → Observe → Verify` 闭环与上下文卫生 |
| **Web 与黑盒测试** | `dsh-superagent-gui-browser` | DOM/ARIA 快照优先定位器、禁止 `evaluate` 篡改状态的纯黑盒测试、DOM+截图交叉核验与网页防注入 |
| **高精前端构建** | `dsh-superagent-frontend-design` | 既有设计令牌对齐、`oklch` 和谐色板、响应式布局、组件模块化与大列表分批渲染 |
| **插件与环境诊断** | `dsh-superagent-diagnostics` | 四步注册链路排查（构建产物 / `exports` / `cordis.patch.yml` / 运行时健康）与 Windows `.cmd` 垫片排障 |
| **研发执行基座** | `delegate` · `verify` · `research` · `shell` · `install` · `mirror` · `docs` | 子任务独立交办规范、类型+测试双门禁实证校验、权威源码溯源、5 秒异步后台作业、国内高速镜像源自动切换与文档代码一致性核查 |
| **渠道深度操作** | `dsh-superagent-github` · `dsh-superagent-feishu` | GitHub Issue/PR/Review 规范化操作与飞书群聊/话题/文档上下文分页读取 |
| **分工清单工具** | `orchestrator_division_todo` | 为每个独立分工对话提供持久化的结构化步骤清单（支持按 `id` 增量合并，跨重启与 60% 接班自动保留） |

### 4. 七大外部与本地接入通道

| 接入通道 | 实现模块 | 接入方式与进程说明 |
|---|---|---|
| **GitHub** | `dsh-superagent/github-watch` | 通过受控 `gh` CLI 轮询仓库 Issue、PR 评论与 Review 事件，支持自动绑定工单分支与 PR 状态 |
| **飞书 (Feishu)** | `dsh-superagent/feishu-watch` | 支持飞书应用机器人长连接 / 事件订阅与 `lark-cli` 富文本、图片及话题串上下文读取 |
| **个人 QQ** | `dsh-superagent/qq-watch` | 基于 OneBot v11 正向/反向 WebSocket 协议接入（需配合 NapCat / LLOneBot 等外部协议端扫码登录） |
| **官方 QQBot** | `dsh-superagent/qqbot-watch` | 原生集成官方 `@tencent-connect/qqbot-nodejs` WebSocket 网关，插件进程直连无需外部桥接 |
| **微信 / 企业微信** | `dsh-superagent/qq-watch` | 复用 OneBot 多实例工厂，可与个人 QQ 在同一插件内分别建立独立实例并各自启停（需对应兼容桥接端） |
| **邮箱 (含 Gmail)** | `dsh-superagent/mail-watch` | 原生内置加密 IMAP 轮询与 STARTTLS/TLS SMTP 发信（支持应用专用密码与邮件线程关联） |

---

## 快速安装与升级

提供**「一键在线脚本」**、**「全平台零依赖内置包（Bundled ZIP）」**与**「轻量独立插件包（`.tgz`）」**三种方式，按需任选：

### 方式一：命令行一键安装（推荐已装或准备接入 DSH 的环境）

安装脚本会自动通过 GitHub API 解析最新正式版 `Super-Agent-Plugin-v*.tgz`、校验 gzip 魔数与 SHA-256 哈希，并安全注入 DSH Profile（保留你已有的其他插件与模型配置）：

**Windows (PowerShell)：**
```powershell
irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex
```

**macOS / Linux (Bash)：**
```bash
curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash
```

### 方式二：零依赖全平台内置包（解压即用，内置 Node.js 与完整 DSH 宿主）

无需提前安装 Node.js 或配置 npm 环境，前往 [GitHub Releases](https://github.com/xyt071024/dsh-superagent-cn/releases/latest) 下载对应系统的压缩包：

| 适用环境 | 发行包文件名 | 启动方式 |
|---|---|---|
| **Windows x64**（免装环境开箱即用） | `Super-Agent-Bundled-Windows-x64-v0.3.17.zip` | 解压后双击或运行 `start.cmd` |
| **macOS Apple Silicon (M1–M4)** | `Super-Agent-Bundled-macOS-arm64-v0.3.17.zip` | 解压后运行 `./start.sh` |
| **macOS Intel (x64)** | `Super-Agent-Bundled-macOS-x64-v0.3.17.zip` | 解压后运行 `./start.sh` |
| **Linux x64** | `Super-Agent-Bundled-Linux-x64-v0.3.17.zip` | 解压后运行 `./start.sh` |
| **已有 DSH 环境（仅装插件包）** | `Super-Agent-Plugin-v0.3.17.tgz` | 运行 `dsh plugin add ./Super-Agent-Plugin-v0.3.17.tgz` |

> **无损升级保障**：内置包的 `start.cmd` / `start.sh` 启动前会自动运行 `profile-bootstrap` 自检：全新环境自动建库选端口；检测到旧版插件或缺依赖时自动对 `package.json` 做加法合并升级，**原样保留你已配置的 `cordis.patch.yml`、模型连接、第三方插件（含原有自定义插件）与历史数据库**，任一步骤异常自动原子回滚。升级前仍建议备份 `<stateDir>/orchestrator.sqlite`。

---

## 工程质量与真实测试矩阵

本项目坚持**「用实测输出说话，明确区分已验证范围与待真机/真账号补证项」**：

| 验收维度 | 当前状态 | 实测依据与边界说明 |
|---|---|---|
| **TypeScript 类型检查与构建** | ✅ **通过** | `tsc --noEmit` 0 错误；`tsdown` 产出 21 个模块文件并与独立插件包及四平台内置包逐字节对齐 |
| **全量自动化测试套件 (Windows)** | ✅ **1,361 通过 / 0 失败** | 76 个测试文件通过（含工作区自动分工、稀疏大槽位、动态补位合并与 SSE 吞吐验证；仅 15 项 POSIX 专属守护脚本用例在 Windows 按平台条件跳过） |
| **GitHub Actions 跨平台测试 (Linux CI)** | ✅ **全部通过** | Ubuntu 环境完整跑通构建、Linux 专属守护脚本测试及双平台安装脚本语法解析 |
| **历轮独立黑盒验收套件 (第 41–50 号)** | ✅ **37 / 37 全部通过** | 完整覆盖接力竞态、多代路由、复杂工单自动多分工、复查防串轮、修订计划保成果/换复查/停旧会话、默认 5 会话与大槽位上限 |
| **Windows 隔离实包安装 / 修复 / 升级** | ✅ **HTTP 200 验证通过** | 正式 ZIP 在干净临时目录实测空白安装、缺插件自动修复、旧版升级保留用户配置，随包宿主 `/orchestrator/api/state` 返回 `200` 且 `loaded = installed = 0.3.17` |
| **安全与隐私发布预检 (`release_preflight`)** | ✅ **0 告警通过** | 五件发行产物全字节扫描私钥、Token、URL 凭据、危险链接、Unix 可执行权限位与本机路径，命中数为 `0` |
| **macOS / Linux 物理机桌面完整启停** | ⚠️ **待真机补证** | 已通过 Linux CI 代码测试、ZIP64 结构与 `0755` 权限位校验，尚未在物理 macOS / Linux 桌面走完 GUI 全流程 |
| **七大外部渠道真实商业账号收发** | ⚠️ **待真号补证** | 已通过本地加密 IMAP/SMTP、OneBot WebSocket、飞书与 GitHub 模拟协议回归测试；为保护用户真实生产账号未在自动化测试中挂载私密凭据 |

---

## 从源码开发与构建

仓库内的完整插件源码位于 [`src-repo/`](src-repo/) 目录：

```bash
cd src-repo
pnpm install
pnpm typecheck        # TypeScript 严格类型检查
pnpm test             # 运行全量 Vitest 测试套件
pnpm build            # 编译服务端 ESM 与前端面板 CJS 产物至 lib/
```

文档中心全部章节源码位于 [`docs/`](docs/)，修改后运行 `node build.mjs` 即可重新生成中 / 英 / 日三语静态站点。版本详细演进记录请参阅 [CHANGELOG.md](CHANGELOG.md)。

---

## 致谢与开源声明

- **直接上游**：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT License）—— 本项目在其核心事件驱动与三层准入架构基础上构建并深度扩展。
- **宿主底座**：[DeepSeek Harness (DSH)](https://github.com/deepseek-ai) —— 提供会话控制器、沙箱执行、插件系统与 Web 控制台底座。
- **工程研究参考**：[elder-plinius/CL4R1T4S](https://github.com/elder-plinius/CL4R1T4S)（GPLv3 公开语料库）—— 作为多智能体提示词结构、检查清单工具与黑盒验证流程的外部研究参考；本仓库所有提示词、技能文档与 TypeScript 代码均为独立编写的原创 MIT 实现，不含任何第三方专有或 GPL 文本片段。

> **非官方声明**：本项目为社区独立维护的开源增强发行版，并非 DeepSeek 官方发行物，亦未获上游作者背书。

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源发布。
