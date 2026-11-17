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
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases"><img src="https://img.shields.io/badge/release-v0.3.6-2ea44f" alt="release"></a>
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
| 上下文达阈值后开新会话 | ❌ 未实现，当前为压缩 |
| 多会话 / 独立复查 | ⚠️ 默认关闭，需手动开启 |

---

## v0.3.6 更新内容

### 修复

**1. 发行包与源码不一致**
此前构建产物与最后一轮源码改动存在时间差，包内可能是改动前的版本。本版改为：源码冻结 → 记录哈希 → 构建 → 逐文件比对，8 个内置包内嵌插件全部与源码一致。

**2. Agent Teams 服务取不到**
`isolate` 作用域导致服务在插件根上下文不可见，`ctx.get('agentTeams')` 恒为 `undefined`，硬工单拆分与独立复查静默失效。改为优先从执行会话自身上下文取值，根上下文作兜底。

**3. 来源配置的检查不准确**
配置 QQ / 邮箱时误走 GitHub 校验路径。本版按来源类型分别检查；IMAP 与 SMTP 独立报告——SMTP 受限的邮箱仍可正常收信。

### 新增

**4. macOS / Linux 内置包**
装配各平台预编译原生模块（sharp / libvips / koffi / sherpa-onnx / node-addon），四个平台零错平台。

### 变更

**5. 发行形态简化**
本版仅提供插件形态与四系统内置包。

---

## 下载

| 你的情况 | 选这个 |
|---|---|
| 已装 DSH | `Super-Agent-Plugin-v0.3.6.tgz` |
| 未装 Node / 未装 DSH（Windows） | `Super-Agent-Bundled-Windows-x64-v0.3.6.zip` |
| 未装 Node / 未装 DSH（macOS Apple 芯片） | `Super-Agent-Bundled-macOS-arm64-v0.3.6.zip` |
| 未装 Node / 未装 DSH（macOS Intel） | `Super-Agent-Bundled-macOS-x64-v0.3.6.zip` |
| 未装 Node / 未装 DSH（Linux） | `Super-Agent-Bundled-Linux-x64-v0.3.6.zip` |

内置包解压后双击 `start.cmd`（Windows）或 `./start.sh`，自动把 profile 装到 `~/.dsh/profiles/superagent` 并选空闲端口启动。

```bash
# 插件版安装
dsh plugin add ./Super-Agent-Plugin-v0.3.6.tgz
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

**上下文达阈值时是压缩，不是开新会话。**

设置中的百分比为「归档阈值」，实际行为是压缩当前会话并在同一会话内继续。跨会话移交尚未实现——宿主会话控制器没有搬运消息的接口。

**多会话与独立复查默认关闭。** 拆分会显著增加 token 消耗，故默认不开启。

**各通道未做真实收发验收。** 已通过本地模拟服务器验证 OneBot / IMAP / SMTP 的协议行为与错误映射；真实账号的登录、收发、断线恢复、重启去重未验证。

**Windows 上约 35 项测试失败。** 测试脚本依赖 POSIX 命令、符号链接、POSIX 权限位，以及无扩展名脚本模拟 CLI。另 1 项（git config 引号转义）存疑待确认。这不是功能故障，但不等于「测试全过」。

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
测试             1336 项 / 1300 通过 / 36 失败
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
