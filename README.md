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
> 基于 DeepSeek 开源的 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT），
> 加了三个消息源、多实例、调度、自我进化、上下文自动归档与全能型工具面。

---

## ⚠️ 先说清楚这个版本做什么、不做什么

我吃过「说得比做得多」的亏，所以把边界写在最前面。**每一条「能用」后面都跟着「怎么知道的」；接不上就是没验。**

### ✅ 已经验证过的

| 能力 | 怎么验证的 |
|---|---|
| Windows x64 内置包首次启动 | 解压 → 双击 `start.cmd` → profile 装到 `~/.dsh/profiles/superagent` → 端口监听 → 面板打开 |
| 包内插件与源码一致 | 8 个内置包内嵌的 `lib/index.js` 哈希全部等于源码（`2650DDBF...`） |
| 插件包完整性 | 21 个 `lib/` 文件逐文件哈希比对，全部一致 |
| 四个平台的原生模块归位 | 逐包扫描 `.node` / `.so` / `.dylib`，8 个包零错平台 |
| 12 个压缩包没有截断 | 逐个读文件尾 65557 字节找 `PK\x05\x06` 中央目录签名，11/11 通过 |
| 发行包不含开发者的真实数据 | 扫描 52 个文本成员 + 8 个包的启动脚本：本机路径 / 令牌 / 私钥 / 群号，0 处命中 |
| 源码质量 | `typecheck` 0 错、`build` 0 错、1336 项测试 1300 通过（36 项 Windows 环境限制，见下） |

### ❌ 没有验证过的（别当成能用）

| 没验的 | 原因 |
|---|---|
| **macOS / Linux 的内置包能不能真的启动** | 构建机只有 Windows。包结构对、原生模块对，但没在那两个系统上跑过 |
| **各通道真实收发** | 只验证了协议行为和错误映射（模拟服务器），没有真实账号的登录、收发、断线恢复、重启去重 |
| **上下文到阈值后真的开新会话** | **这个功能还没实现**，目前是压缩当前会话（见下） |
| **多会话 / 独立复查默认就是开着的** | **默认关闭**，要去设置里手动打开 |

---

## 这个版本修了什么

### 一、上一版的包，装的是旧代码

上一版 v0.3.5 的 12 个包，里面装的**不是最后改完的代码**。

时间线：先打包，然后在等压缩的几个小时里又继续写「部署检查」。压缩完成时，包里放的是打那之前的旧插件——**有 Agent Teams 挂载，但没有部署检查**。

这是外部独立验收对比 `lib/index.js` 哈希时发现的。现在改成：源码先冻结 → 记录 254 个源文件 + 21 个构建产物的哈希 → 打包 → 逐文件比对。

### 二、四平台都能装了

上一版只敢发 Windows，理由是「本机造不出 macOS/Linux 的原生模块」。**这个判断是错的。**

这些原生模块本来就是预编译分发的——每个平台单独发一个 npm 包，主包在 `optionalDependencies` 里列出全部平台，运行时按 `platform + arch` 挑一个加载。所以跨平台打包不需要编译，只需下载对应平台的包放进去。

现在 8 个内置包各装了本平台的 4–5 个原生包，零错平台。

### 三、Agent Teams 挂上了，但取不到（修了）

上一版把它挂进 preset 了，changelog 也写了「现在挂上了」。**实际功能照样不工作。**

原因在 Cordis 的 `isolate` 语义：`isolate: { agentTeams: true }` 会建一个新的作用域标签，从插件根上下文往上查找时标签不匹配就停。代码是从根上取的，永远拿到 `undefined`。

现在优先从执行会话自己的上下文取，根上下文只作兜底。

### 四、配错源的时候，报错告诉你要做什么

之前无论配哪个源，都跑去校验 GitHub。QQ 网关没开，你看到的是「等待部署检查」——完全不知道下一步该干嘛。

现在：配 QQ 会真的去连网关，连不上就说清楚（地址没填 / 连不上 / token 不对）；配邮箱把 IMAP 和 SMTP **分开报**——SMTP 被运营商封了的邮箱照样能收信，笼统说「邮箱不可用」是错的。

### 五、包名整理

上一版的 `Plugin-Stable` 和 `Plugin-Purge` 两个 tgz **字节完全相同**，名字却让人以为是两个东西。现在合并：

- `Super-Agent-Plugin-v0.3.6.tgz` —— 唯一插件包
- `Super-Agent-Purge-Assets-v0.3.6.zip` —— 破甲的 profile 骨架，单独一份

---

## 🌀 它怎么干活（三种模式，一个工单走一遍）

一个请求进来，走的是同一条流水线，区别只在「一个人做还是几个人一起做」。

### 模式一：一个人做（默认）

主会话收到活 → 判断该不该接 → 接了就交给执行会话 → 做完回报。

### 模式二：拆给几个人（`multiSession: auto`）

难度跨过门槛时（默认按交办说明的长度判断，1200 字符），执行会话会收到「这活可以拆」的说明，然后**它自己用 Agent Teams 开成员**、切写作用域、派任务、收结果。

⚠️ **默认是 `single`，要用得手动去设置里打开。**

### 模式三：加一个独立复查（`reviewEnabled`）

复杂工单做完，另开一个**只读**的审查员。它拿到的是工单、改动范围、验收标准，**看不到执行过程**，所以不会被执行者的思路带偏。

审不过 → 把问题打回执行者修 → 再复审，最多 3 轮。审查员是绑定的（`reviewerId`），换人会被拒；审查期间工作树有变化（`reviewSnapshot` 的 Git 指纹对不上）也会被拒——防止「审的和改的不是同一份」。

⚠️ **默认关闭。**

---

## 🔴 最重要的限制：60% 之后是压缩，不是新建会话

设置里那个百分比叫「归档阈值」，实际行为是：**把当前会话压缩，然后在同一个会话里继续。**

真正的「开一个新会话、把任务移交过去」还没实现。宿主的会话控制器没有跨会话搬运消息的接口，能做到的只有「切换时拦住输入、切完重新投递」——做不到无缝。

**这一条在界面上会如实标注，不会假装支持。**

---

## 📦 下载哪一个

| 你的情况 | 选这个 |
|---|---|
| 电脑没装 Node / 没装 DSH | `Super-Agent-Bundled-<平台>-Stable-v0.3.6.zip` |
| 已经装了 DSH | `Super-Agent-Plugin-v0.3.6.tgz` |
| 想要破甲 | 上面的包 + `Super-Agent-Purge-Assets-v0.3.6.zip` |
| 想先看看里面有什么 | `Super-Agent-Clean-Any-Platform-*-v0.3.6.zip`（0.4 MB，只有插件） |

内置包解压后双击 `start.cmd`（Windows）或 `./start.sh`，它会自己把 profile 装到 `~/.dsh/profiles/superagent` 并选一个空闲端口启动。

**唯一验证过的路径**：Windows x64 内置包，双击 `start.cmd`。其余平台欢迎报问题。

### 破甲版不是开箱即用

Purge 与 Stable 的插件包是**同一个文件**。差别只在 profile 里多声明一个 `dsh-purge-community` 依赖，首次启动从 npm 下载（需要联网）。装完还要两步：

```bash
dsh plugin add dsh-purge-community
dsh purge apply          # 撤销：dsh purge revert
```

破甲是第三方开源项目（作者 kingcharleslzy-ai / YuJunZhiXue），本项目**不打包其代码**，也不保证上游更新后仍与 DSH 当前版本兼容。

---

## 🧩 架构

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

**四条设计约束**（谁接手都别丢）：

1. **`isolateEnvironment: true` 必开** —— 插件会改 process-wide `PATH` 和 git 配置，不开的话 worker 的 `gh` / `lark-cli` shim 会静默替换 20+ 个插件的同名命令
2. **上下文归档复用宿主的 `ctx.compaction`，不自己写摘要** —— 缺 `tokenMeter` 或 `compaction` 时整体不启用，不假装归档
3. **破甲模式保留在原仓库** —— 依赖 `dsh-purge-community` + profile 加 bundle，不复制别人代码
4. **判断一个 agent 强不强，先 diff 它的工具清单** —— 不要读它自己说得多能干

---

## 🧪 测试情况

```
typecheck        0 错
build            0 错
测试             1336 项 / 1300 通过 / 36 失败
```

**36 项失败的原因**：测试脚本依赖 POSIX 命令（`sh` / `sleep` / `env`）、符号链接（需管理员或开发者模式）、POSIX 权限位，以及用无扩展名脚本模拟 CLI。

其中 **35 项确认是 Windows 环境限制，1 项（git config 引号转义）存疑待真机确认**。

这不是产品功能故障，但也**不能说「测试全过」**。

---

## 🛠 从源码构建

```bash
pnpm install
pnpm typecheck
pnpm build            # 产物在 lib/
pnpm test
```

打包发行物（三小时起步，主要是压缩 7 万文件）：

```bash
node _tools/build-packages.mjs     # 插件 tgz + profile
node _tools/make-dist.mjs          # 铺 10 个包目录 + 装配跨平台原生模块
node _tools/make-dist-zips.mjs     # 串行 zip64 压缩
```

> 压缩必须串行，三个并发就能吃光十几 GB 内存。zip64 是手写的——`Compress-Archive` 写不出 zip64，而 7.6 万个条目超过经典 zip 的 65535 上限。

---

## 🙏 致谢

**上游**

- [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) — MIT — 本项目的直接来源
- [DeepSeek Harness](https://github.com/deepseek-ai) — 宿主框架

**破甲**

- [dsh-purge-community](https://github.com/kingcharleslzy-ai/dsh-purge-community) — 作者 kingcharleslzy-ai / YuJunZhiXue — 本项目的 profile 声明该依赖，**不打包其代码**

**技术参考**

- RFC 6455（WebSocket） · RFC 5321/5322（SMTP/IMAP） · Playwright（浏览器自动化） · MCP（工具协议）

本项目**不是官方发行版，也未获上游作者背书**。

如果用了你的东西却没写你的名字，提 issue，立刻补。

---

## 📄 许可证

MIT。见 [LICENSE](LICENSE)。
