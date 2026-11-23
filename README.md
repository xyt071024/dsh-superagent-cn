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
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases"><img src="https://img.shields.io/badge/release-v0.3.13-2ea44f" alt="release"></a>
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
| Windows x64 启动器 / 无损升级 / 端口自选 | ✅ 已验证（隔离环境实跑 127.0.0.1 HTTP 状态检查） |
| 包内插件与源码一致 | ✅ 构建并哈希一致 |
| 四平台原生模块归位 | ✅ 零错平台 |
| 压缩包完整性与权限预检 | ✅ ZIP64 + Unix 权限位 + preflight 清零 |
| macOS / Linux 真机启动 | ⚠️ 未物理开机（已做 Git Bash / CLI 引导与 Unix 权限校验） |
| 各通道真实外部账号收发 | ⚠️ 未验证（受限于真实账号凭据，已过协议与模拟集成测试） |
| 上下文达阈值后交接新会话（主/子/分工） | ✅ 已实现并验证（Runtime + SQLite + 模拟控制器） |
| 多会话分工 / 模型槽位 / 独立复查 | ✅ 已实现并验证（需在 设置 → 路由 / 执行 开启） |
| 运行时加载版本 / Profile 识别与热重载提示 | ✅ 已实现并验证 |

---

## v0.3.13 更新内容

详见 [CHANGELOG.md](CHANGELOG.md)。核心改进包括：
- **M07 分工韧性与单子项委托深度闭环**：高难度工单在 `DshExecutor` 自动落入持久化 `TaskPlan` 并创建真实可打开分工会话（`M07-a`）；支持高难度单子项独立委派开 1 个分工会话（`M07-e`）；重放同一 `planKey` 或重启 `resume()` 自动按原会话与请求 ID 补建恢复瞬时失败的分工而不影响已运行/已完成成员（`M07-b`）；汇报进度落盘与协调窗口通知回执分离为持久化待投递队列，瞬时失败后重复汇报或恢复自动补发（`M07-c`）；消除 `sendToDivision` 等跨 `await` 写回旧快照的竞态，并发追问与汇报共存不丢完成态（`M07-d`）；独立复查支持最多 3 轮打回重做并自动推进第 2/3 轮复查（`M07-f`）。
- **M06-a 分工会话多代接班与激活恢复**：`moveDivision` 持久化 `pendingActivation`，崩溃或唤醒瞬时失败后由 `relay.resume()` 幂等补建并唤醒新代分工会话，连续多代接班（`r1→r2→r3`）与旧窗口输入转发直达最新代次。
- **Windows 深层中文路径引导复制加固**：`windows-profile-bootstrap.mjs` 改用纯 JS 递归 `copyDir` 替代 Node v22.19.0 在深层中文路径下存在栈溢出（`0xC0000409`）的原生 `fs.cpSync`。

## 历史记录：v0.3.12 更新内容

详见 [CHANGELOG.md](CHANGELOG.md)。核心改进包括：
- **M07 多会话独立分工与复查**：`orchestrator_dispatch` 按任务复杂度分流（简单 0 额外会话；复杂拆分独立可打开的持久化 DSH 会话）、`maxSessions` 与混用/继承模型槽位、DAG 依赖唤醒、`event_id` 去重及独立复查入口。
- **M03–M06 接力与崩溃恢复闭环**：继任主会话 `masterId` 实时动态绑定并获完整管理工具；子会话与分工会话达 60% 阈值自动接力并保留父子/槽位/共享任务；多代 `A→B→C` 路由压缩与激活阶段崩溃恢复。
- **M01 / M02 / M08 部署、版本识别与安全预检**：仓库一键安装脚本全面同步动态 Release 查询并支持 `DSH_HOME`；Bundled 启动脚本接入无损 `profile-bootstrap`；`VersionTracker` 与 Web 面板 `PUT /settings/routing|budget` 修复；多线程 ZIP 打包与精确白名单 Pre-flight 清零。

## 历史记录：v0.3.11 更新内容

本版修的是 v0.3.8 通过独立验收发现的八个缺陷。上一版的接力在单次、理想条件下可用，但在真实 Team 服务、连续第二次接力、切换期并发输入和崩溃恢复这些条件上不成立；三个 Unix 包还带着错误的文件权限，按文档无法启动。

### 修复

**1. Team 名单把主会话自身算成阻塞成员**

接力前的安全检查调用 Team 服务的成员列表，列表非空即拒绝迁移。该服务的成员列表总是先包含 lead 自身，因此即使一个队友都没有，接力也会被永远拒绝，退回原地压缩。

现在按角色与 ID 排除 lead 本身，只看真实队友，且只把正在运行或正在创建的成员视为阻塞；状态枚举取自服务自身。已退出的队友，其工作已记录在会话历史中，不构成留下的理由。

**2. 第二次接力复用上一次的目标会话**

第一次迁移在提交时保留了目标字段，第二次接力又读到同一个值，形成目标等于当前。后果是该轮取消掉的正是正在工作的那个会话。

现在每次迁移带一个递增的代次：只有进行中的迁移复用目标，已提交的迁移必定生成新的代次、目标与请求标识。会话名由代次推导，不依赖时钟，同一毫秒内的两次迁移不会重名，崩溃恢复也能算出同一个名字。提交时清除目标、摘要与请求标识，避免下一轮误读。

**3. 提交被拒绝后，新会话仍在执行同一任务**

摘要投递会唤醒目标会话，而工单与指针的复核在其后进行。一旦复核失败，旧实现只记录失败，目标仍在跑同一件活，两个会话做一件工作。

现在拒绝路径会取消目标会话并记录原因；提交前的复核也扩展到工单是否已结束、是否有新到达的未投递消息、旧会话是否收到过尚未被接手的人工输入。

**4. 切换期间直接输入旧会话的消息不会转交**

上一版注释声称此后的输入会转交，实际实现只取消一次会话、保留收件箱并打印提示，没有发送任何消息。

现在会把旧会话收件箱中的人工消息逐条重新投递给新会话，以消息自身的标识作为幂等键，投递后从旧收件箱移除；提交前也会重新检查旧会话是否有人输入，有则拒绝迁移。

**5. 长历史摘要从头截断，最新进度丢失**

上一版先拼接完整摘要再整体截断。摘要的尾部正是最新一条消息，也就是工作停在哪里，因此被截掉的恰好是最需要的部分。

现在按段落分配预算：任务原文保留开头，会话历史保留尾部，超预算时插入明确说明而非静默剪切。

**6. 摘要已投递阶段的恢复不校验目标**

恢复逻辑只在前两个阶段重新确认目标会话存在且持有摘要，第三个阶段直接提交指针，可能把工单交给一个不存在的会话。

现在三个阶段统一重建并确认所依赖的持久事实，目标与当前相同时直接判为失败。

**7. Linux 与 macOS 包没有执行权限**

打包时直接取构建机的文件模式写入 Unix 权限位。Windows 上该值恒为 666，因此三平台包内的启动脚本与内置 Node 都没有执行位，即使改用 sh start.sh，脚本自身的可执行检查仍会拒绝继续。

现在按文件职责生成权限：启动器、内置 Node、bin 入口与原生模块为 0755，其余为 0644；Windows 包不写 Unix 权限位。

**8. 启动器遇到已安装的 profile 就退出**

两个启动器在检测到已存在的 profile 时要求用户移走并退出。正常首次安装后该文件必然存在，因此关闭程序后再次双击无法启动，中断留下的半成品也会堵住重试。

现在区分三种情况：完整的 profile 直接启动（这也是日常启动入口）；不完整则提示并补装，保留既有设置；完全没有才执行首次安装。

### 测试

独立复现用例 6 项在修复前全部失败、修复后全部通过。`tests/relay.spec.ts` 从 10 项扩到 15 项，新增代次隔离、Team 名单含 lead、真实队友阻塞、摘要尾部保留、拒绝后目标不残留五项回归。

### 已知限制

- 接力只在 Runtime + SQLite + 模拟宿主层面验证，未在真实宿主做故障注入（切换期并发输入、真实 Team 成员、强制杀进程重启）
- 主会话与子会话的阈值接力仍未覆盖：归档只处理受管会话，子代理被明确排除；主会话无工单标识，走原地压缩
- 权限位已修但未在 Linux 与 macOS 真机启动验证
- 各通道真实收发未验收

---

## 下载

| 你的情况 | 选这个 |
|---|---|
| 已装 DSH | `Super-Agent-Plugin-v0.3.13.tgz` |
| 未装 Node / 未装 DSH（Windows） | `Super-Agent-Bundled-Windows-x64-v0.3.13.zip` |
| 未装 Node / 未装 DSH（macOS Apple 芯片） | `Super-Agent-Bundled-macOS-arm64-v0.3.13.zip` |
| 未装 Node / 未装 DSH（macOS Intel） | `Super-Agent-Bundled-macOS-x64-v0.3.13.zip` |
| 未装 Node / 未装 DSH（Linux） | `Super-Agent-Bundled-Linux-x64-v0.3.13.zip` |

内置包解压后双击 `start.cmd`（Windows）或 `./start.sh`，自动把 profile 装到 `~/.dsh/profiles/superagent`（若已存在则无损升级并保留配置）并选空闲端口启动。

```bash
# 插件版安装
dsh plugin add ./Super-Agent-Plugin-v0.3.13.tgz
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

**Windows 与 Linux 测试全绿。** Windows 原生环境下 75 个测试文件（1350 项用例）全部通过，仅 `service-script.spec.ts`（15 项 POSIX 守护脚本测试）在 Windows 下按平台条件跳过并在 Linux CI 中完整执行通过。

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
        ├─ 难度够了 → DivisionCoordinator / Agent Teams 拆独立可打开分工会话
        │
        └─ 复杂工单 → 独立复查员（只读、看不到执行过程，支持最多 3 轮打回重做）
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
测试（Windows）  75 文件通过 / 1 文件按平台跳过（1350 通过 / 15 跳过 / 0 失败）
测试（Linux CI） 76 文件全部通过
```

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
