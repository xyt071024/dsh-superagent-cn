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
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases"><img src="https://img.shields.io/badge/release-v0.3.8-2ea44f" alt="release"></a>
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

## v0.3.8 更新内容

本版修的是 v0.3.7 跨会话接力的四个缺陷。上一版新增了接力代码，但接管动作在几个关键点上与承诺不符：新会话编号无法被识别、转交内容不含真实摘要、切换期间的输入可能丢失、崩溃后无法恢复。以下逐项说明改了什么。

### 修复

**1. 新会话编号无法被识别，工单找不到自己的会话**

接力生成的新会话编号取自跨行模板字符串，值首尾各带一个换行；而工单识别会话用的是前缀判断，带前导换行的编号匹配不上。即使去掉换行，编号里的代次后缀也会被整段当成工单 ID。

现在会话身份改为持久化映射：创建会话时写入「会话 → 工单」记录，此后所有查询走同一入口，不再解析会话名。编号本身加了合法性校验，带空白或控制字符的名称会被拒绝创建。旧版遗留的无主记录会在启动时被安全忽略。

**2. 转交内容不是摘要，却声称摘要已附上**

旧实现转交给新会话的是一句固定文案，并声称历史已附上；工单状态被记为「已摘要」，但没有任何代码生成、读取或附带过摘要。

现在摘要由旧会话自己的持久化事件与工单记录生成，包含：工单交办原文、已完成与剩余工作、工作目录、等待中的人员提问、最近若干轮对话原文。摘要在新会话创建之前先落盘；读不到旧会话记录时拒绝交接并说明原因，而不是用一个不含历史的文案冒充。

**3. 切换期间输入可竞争，团队安全阀未实现**

旧实现只在切换前检查一次未投递输入，且「活跃 Team」只是注释，没有读取团队成员或任务板；检查与后续创建之间也没有同一工单的串行锁。

现在同一工单的切换按序执行；切换前依次核对：工单是否仍有未投递消息、旧会话是否仍在运行、是否有 Team 成员绑定在旧会话、是否有人直接向旧会话输入了尚未被接手的内容。任一成立即保持原会话并报告具体原因，不静默丢弃。

**4. 指针在新会话可用前就切换，崩溃无法恢复**

旧实现在创建新会话之前就把「当前会话」指向新编号，而读取方不看阶段直接采信；进程崩溃不会进入回滚分支，启动时也没有恢复处理。

现在迁移记录区分「已提交的当前会话」与「正在准备的迁移目标」，读取方只采信前者，后者从不作为路由目标。迁移分四个可重放阶段（摘要就绪 → 会话创建 → 摘要投递 → 指针提交），每阶段落盘；指针在单个事务内切换。启动时扫描未完成迁移并从中断处继续，投递使用固定请求标识，重复恢复不会重复投递。

### 测试

新增 `tests/relay.spec.ts`（10 项），通过真实 Runtime、SQLite 与宿主的会话控制器验证上述行为，而不是只 mock 接送力函数：会话身份映射、接力摘要来自旧会话真实记录、未投递输入与不可读会话各自保持原会话、崩溃后从中间阶段恢复且不重复投递、迁移目标在提交前不作为路由目标。

### 文档

架构文档的模块表与测试表补齐新模块，`docs.spec.ts` 的模块/测试枚举校验恢复通过。

---

## 下载

| 你的情况 | 选这个 |
|---|---|
| 已装 DSH | `Super-Agent-Plugin-v0.3.8.tgz` |
| 未装 Node / 未装 DSH（Windows） | `Super-Agent-Bundled-Windows-x64-v0.3.8.zip` |
| 未装 Node / 未装 DSH（macOS Apple 芯片） | `Super-Agent-Bundled-macOS-arm64-v0.3.8.zip` |
| 未装 Node / 未装 DSH（macOS Intel） | `Super-Agent-Bundled-macOS-x64-v0.3.8.zip` |
| 未装 Node / 未装 DSH（Linux） | `Super-Agent-Bundled-Linux-x64-v0.3.8.zip` |

内置包解压后双击 `start.cmd`（Windows）或 `./start.sh`，自动把 profile 装到 `~/.dsh/profiles/superagent` 并选空闲端口启动。

```bash
# 插件版安装
dsh plugin add ./Super-Agent-Plugin-v0.3.8.tgz
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
测试             1349 项 / 1313 通过 / 36 失败
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
