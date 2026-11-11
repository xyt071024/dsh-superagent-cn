# Super Agent 相对上游的改动

本文说明 `dsh-superagent-cn` 这个项目相对上游 `dsh-superagent` 原版改了什么、为什么改。每条都能在源码里查到对应实现，不是事后描述。

- 上游基线：`dsh-superagent-prototype` 仓库的 commit `8c32a9d`（`feat: add the dsh-superagent research prototype`）
- 版本：`0.1.0` → `0.2.0`
- 核对命令：`git -C dsh-superagent-prototype diff --stat 8c32a9d`

改动共 43 个文件被修改，新增 10 个源文件与 6 个测试文件。下面按功能分组。

---

## 1. 新增 QQ / 微信 / 企业微信来源（`src/sources/qq.ts`）

### 上游原样

上游只有 GitHub 与飞书两个来源。任何新的聊天平台都要从头写一份完整的 Source：Schema、字段、轮询、回信通道、Thread 读取、策略表、环境变量，各自一遍。

### 我们改成什么

新增 `src/sources/qq.ts`（400 行），走 **OneBot v11 HTTP 端点**（SnowLuma / NapCat 这类实现）。核心是一个工厂函数：

```ts
export function oneBotKind(kind: string, title, description, threadVariable): SourceKind<QqConfig>
```

`ONE_BOT_KINDS` 用它生成三个独立的 kind：`qq`、`wechat`、`wecom`。三者共用同一份协议代码，只在两处不同 —— 记录的 kind 名、面板上给人看的文案。

```ts
export const ONE_BOT_KINDS = [
  { kind: 'qq',     title: { zh: 'QQ',     en: 'QQ' },     ... },
  { kind: 'wechat', title: { zh: '微信',   en: 'WeChat' }, ... },
  { kind: 'wecom',  title: { zh: '企业微信', en: 'WeCom' }, ... },
]
```

关键实现点：

- **`call()`** 调 OneBot 的 action：OneBot 拒绝动作时仍返回 HTTP 200，所以按 body 里的 `status`/`retcode` 判断成败，不能只看状态码。
- **`plainText()`** 把 OneBot 的消息段拍平成文本，`@` 段保留为 `@qq号`，这样地址可被检出。
- **`mentions()`** 判断是否 @ 了智能体自己；群消息只有被 @ 才算发给它，私聊则都算。
- **轮询而非长连接**：OneBot 没有推送游标，`pollSeconds`（默认 5 秒）到了读一次最近消息，靠 `message_id` 集合去重（每实例保留最近 2000 条）。
- **回信**也走同一个端点，所以 `SourceChannel.send` 需要拿到本实例的 endpoint/token。

`chat` 侧的两处配套改动：

- `src/sources/kind.ts`：`SourceChannel.send(host, message)` 的 `host` 从 `Pick<SourceContext, 'commands'>` 扩成 `Pick<SourceContext, 'commands'> & { config: C }`，让通道能拿到自己的配置。
- `src/sources/registry.ts`：`send()` 里补 `this.resolve(kind, ...)` 把实例配置传进通道。
- `src/kv.ts`：新增 `KV.qq.seen`。

### 为什么改

**为什么用工厂函数而不是三个独立 kind**：三个平台的协议完全一样，差异只是标签。写三遍意味着三份 bug。用工厂函数，一份代码三个平台，改一处三处都生效。

**为什么每个平台是独立的 kind，而不是一个 kind 加 `platform` 字段**：kind 是策略表、健康条目、权限名单的归属单位。合成一个 kind，三个平台就共用一张白名单 —— 微信里的人能派 QQ 的活，这不对。

**为什么是轮询**：OneBot v11 的 HTTP 接口本身没有推送，也没有游标。5 秒是可接受的延迟，且实现简单、失败可观测。

---

## 2. 新增邮箱来源（`src/sources/mail.ts` + `src/sources/imap.ts`）

### 上游原样

上游没有邮箱来源。

### 我们改成什么

`src/sources/mail.ts`（275 行）+ `src/sources/imap.ts`（159 行）。

**`imap.ts` 是自己写的最小 IMAP 客户端**，不是引第三方库。它只做四件事：`open()` 连接并登录、`select(mailbox)` 选文件夹、`newest(count, items, limit)` 取最近 N 封、`close()`。

设计上刻意收紧的几点（代码注释里写明）：

- 每条命令带 tag 并顺序等待，两条命令的回复不会交错。
- 收到不认识的 tag 的回复直接丢弃，不会被误当成当前命令的答案。
- `newest()` 在 `count <= 0` 时直接返回空 —— `FETCH 0:*` 会指到「最后一封」，空邮箱上这是错的。

**`mail.ts` 负责 Source 语义**：

- `decodeHeader()` 解 RFC 2047 编码字（`=?utf-8?B?...?=` / `?Q?...?=`），否则中文主题和发件人是乱码。
- `triggerOf()` 把一封信变成 Trigger：`actor` = 发件人地址，`threadKey` = Message-ID，`meta` 带 `messageId`/`mailbox`/`seq`/`subject`。
- **自己发出的信会被跳过**（`sender === own`），否则回信回到同一个收件箱会形成回环。
- 去重按 `Message-ID`，每个邮箱地址一份（`KV.mail.seen`）。

**回信走 curl 的 SMTP**，不是自己实现 SMTP 客户端：

```ts
await host.commands.run('curl', ['--silent', '--show-error', '--fail', '--url', url,
  '--user', `${config.address}:${config.secret}`,
  '--mail-from', config.address, '--mail-rcpt', to, '--upload-file', body])
```

正文先写进临时 `.eml` 文件再 `--upload-file`，理由写在注释里：长正文或非 ASCII 内容不该变成 shell 命令的一个参数。

一个 kind 同时服务 QQ 邮箱与 Gmail —— 两者只在 host 和凭据上不同，`imapHost`/`smtpHost` 都是可配字段。

### 为什么改

**为什么自写 IMAP 而不引库**：这个项目的依赖列表刻意保持在 DSH 自己的包内（`imap.ts` 开头的注释明说）。为了读一个收件箱引入一整套 IMAP 库，代价大于收益。

**为什么 SMTP 用 curl**：curl 在本项目支持的宿主上都有，且已经会说这个协议。自己实现 SMTP（含 STARTTLS、认证、MIME 编码）是几百行的坑，而 curl 一行就够。

**为什么去重按 Message-ID 而不是 UID**：UID 在不同服务器、不同文件夹上的语义不一致（UIDVALIDITY 会变），Message-ID 是邮件自己的稳定身份。

**注意（重要）**：这个版本的邮箱是**轮询**，不是 IMAP IDLE。`imap.ts` 没有实现 IDLE 命令，`watch()` 每 `pollSeconds`（默认 120 秒）拉一次。文档里凡写「IMAP IDLE 推送」的说法都与代码不符，已按实现改正。

---

## 3. 多实例架构（`src/sources/registry.ts` 的 `kindOf`）

### 上游原样

一个 kind 只能有一个实例。实例 id 就是 kind id，`instances()` 按 kind 列表逐个 `resolve`，配置从 `settings.sources[kind.kind]` 取。想接第二个 QQ 号，无处可放。

### 我们改成什么

实例 id 允许带后缀：`qq` 是裸实例，`qq-work` 是同一 kind 的第二个账号。

核心是 `kindOf()`：

```ts
kindOf(instance: string): SourceKind | undefined {
  if (this.kinds.has(instance)) return this.kinds.get(instance)
  let at = instance.lastIndexOf('-')
  while (at > 0) {
    const candidate = this.kinds.get(instance.slice(0, at))
    if (candidate) return candidate
    at = instance.lastIndexOf('-', at - 1)
  }
  return undefined
}
```

**从右往左逐个 `-` 试**，不是只切最后一个。原因写在注释里：kind 名本身可能带横线（`wechat-native`），只切最后一个会把 `wechat-native-work` 读成 kind `wechat-native-work` 而不是 `wechat-native`。

配套的四处改动：

| 位置 | 改动 |
|---|---|
| `instances()` | 有后缀的 kind 按后缀逐个列出；没有后缀的 kind 保持单个裸实例 —— 从没加过第二个账号的安装，行为与上游一致 |
| `instance(id)` / `validate(id)` | 都改用 `kindOf(id)`，不再用 `kinds.get(id)` |
| `resolve(kind, stored, id)` | 新增 `id` 参数，返回的实例 id 不再是 `kind.kind` |
| `instances()` 的孤儿判定 | 用 `kindOf(id)` 而不是 `kinds.has(id)`，`ghost-work` 这种没有对应 kind 的才是孤儿 |

**每个实例独立的状态**：

- `src/kv.ts`：`KV.qq.seen` 与 `KV.mail.seen` 都是 `family<..., [instance: string]>`，游标按实例分开。注释写明理由：两个桥接打到同一个端点也不能共用一个游标。
- `src/sources/host.ts`：`Health` 加 `instances?: Record<string, Health>`，`SourceContext` 加 `instances<C>(kind)`。
- `src/app/source-context.ts`：`report()` 接受 `<baseEntry>-<suffix>` 形式，按实例收集后聚合到 kind 自己的健康条目上，**取最差的那个状态**（一个账号坏了不能因为另一个好而显示为健康）。
- `src/sources/qq.ts` 的 `watch()`：每个实例一条独立轮询循环，一个端点挂了不拖慢另一个。

### 为什么改

上游的模型是「一个来源一个连接」。实际使用里，「两个 QQ 号」「一个 QQ 一个微信」「每个邮箱地址一个账号」都是正常需求，而且它们的白名单必须分开 —— 工作号和生活号能看到同一份工单列表是不行的。

后缀方案的好处是**不动配置格式**：`settings.sources` 本来就是 `record<string, ...>`，键名自由；不用加 `instances: []` 数组，也不用迁移已有数据。

---

## 4. 调度设置（`src/app/routing.ts` + `src/client/routing.tsx`）

### 上游原样

上游一个工单固定用一个执行模型（`settings.executor.model`）。没有「这个活难，换个强模型」的能力，也没有可用模型白名单。

### 我们改成什么

**后端 `src/app/routing.ts`**（76 行）+ **前端 `src/client/routing.tsx`**（118 行）+ 策略 Schema。

`RoutingConfigSchema`（在 `src/policy.ts`）新增四项：

```ts
multiSession:        'single' | 'auto'          // 一个会话做完，还是拆开并行
placement:           'background' | 'foreground' | 'ask'
thinking:            'auto' | 'low' | 'medium' | 'high'
allow:               string[]                   // 勾选的 provider/model，精确到版本
difficultyThreshold: number                     // 0-100，默认 60
```

**难度由同一次评估顺带给出，不额外发一次请求**：

- `src/app/assessment.ts`：`AssessmentSchema` 加 `difficulty: z.number().int().min(0).max(100).nullish()`，描述里给了标尺（0-20 一两个文件的一两行，40-60 一个模块几个文件，80-100 跨模块或带设计决策），并允许「范围确实说不清时不给」。
- `src/policy.ts`：`Assessment` 与 `AssessmentOutcome` 的 accept 分支都带上 `difficulty`。
- `src/core/model.ts`：`Execution` 加 `difficulty?`，这样同一工单的每个 worker 会话都用同一个值。
- `src/executor/dsh.ts`：`ticketExecution()` 把 difficulty 写进 execution；新增 `hard(ticket)` 拿它和 `difficultyThreshold` 比。

**按门槛选模型**（`modelFor`）：

```ts
export function modelFor(config, executorModel, hard: boolean): RoleModel | null {
  if (!config) return executorModel                    // 没开调度：与上游完全一样
  const approved = routes(config)
  if (!approved.length) return executorModel           // 没勾模型：与上游完全一样
  const route = hard ? approved[approved.length - 1]! : approved[0]!
  ...
}
```

- 难度 ≥ 门槛 → 用列表里**最后一个**已勾选模型
- 否则 → 用**第一个**
- 顺序就是操作员勾选的顺序，不是代码自己排的名

**没给难度估值时不当作难活**（`hard()` 的注释写明）：改用第一个已勾选路由，也就是操作员自己选的最省那个，而不是拿最强模型去赌一个猜测。

**前端**：`routing.tsx` 的 `ModelAllowance` 组件按 `provider/model` 精确勾选。特别处理了「勾了但当前接入里不存在」的模型 —— 这类 id 会永远匹配不上，悄悄把白名单缩窄，所以给出警告并允许一键去掉。

### 为什么改

**为什么不额外发一次评估请求**：难度和「接不接」读的是同一条消息、同一份上下文。拆成两次请求意味着两倍成本、两倍延迟，还可能得出互相矛盾的结论（评估说接，难度评估说这是另一个活）。顺带给，成本为零。

**为什么用「第一个/最后一个」而不是打分排名**：代码不该替操作员决定模型谁强谁弱 —— 它没有那个信息。勾选顺序是操作员明确表达的价格/能力偏好，代码只负责按这条线切。

**为什么空列表等于放行全部**：从没打开过调度页面的安装必须与上游行为一模一样。`allow` 为空时直接回退到 `executorModel`。

---

## 5. 自我进化（`src/app/self-inspect.ts` + 两个工具）

### 上游原样

上游所有工具都作用在「人的活」上：读 GitHub、回评论、派工单。没有任何工具让智能体查看**自己这套安装**的状态。一个看不见自己状态的智能体没法改善自己。

### 我们改成什么

`src/app/self-inspect.ts`（111 行）+ `src/app/tools/main.ts` 里注册的两个工具。

**`inspect()`** 比对「这套安装现在是什么」和「一套能干活的安装需要什么」，产出 `Gap[]`：

```ts
export interface Gap { code: string; detail: string; fix: string }
```

关键设计：**每个 gap 的 `fix` 必须是一条具体动作，不是一个问题类别**。注释写得很直白 —— 「邮件来源没配好」把「该做什么」留给读者去猜，而这正是这个函数要避免的失败。

覆盖的 gap：没有任何来源在收消息、来源处于 `paused`/`error`、根本没装来源、所有白名单都是空的、没有批准任何模型、只跑单会话、评估只在 observe 模式、没接邮箱、没配 prepare 命令。

同时返回 `Activity`（窗口内的工单数、未结、已结、待处理），让「最近干了什么」有数可依。

**`hygiene()`** 检查智能体能自己修的东西：未结工单里工作目录已经不存在的。注释区分得很清楚 —— 修一个不存在的目录是**维修**，不是改人的活。

**两个工具**：

| 工具 | 作用 |
|---|---|
| `orchestrator_self_inspect` | 报告缺什么、最近在干什么，每个 gap 带一条修复动作 |
| `orchestrator_self_hygiene` | 查可自修的陈旧状态（未结工单的目录已消失） |

`MainToolsHost` 为此新增两处注入：`sources: Pick<SourceRegistry, 'instances'>` 和 `health: Readonly<Record<string, HealthMap[string]>>`，都是活视图不是快照。

### 为什么改

**为什么 gap 要带 `fix`**：诊断本身不产生价值，能被执行诊断才有。而且它防了另一种失败 —— 智能体看到一堆「有问题」然后编一个理由解释，不如直接告诉它下一步做什么。

**为什么 hygiene 只查目录不存在**：这一项智能体能确定地修（重建目录、或者把工单标记为需要人看），不会误伤人的工作。范围放宽到「检查代码质量」就越界了 —— 那属于操作员的工具链，不属于智能体的自检。

---

## 6. 上下文归档（`src/app/archive.ts`）

### 上游原样

DSH 自带的 `compaction-basic` 按**固定比例**触发（默认窗口的 80%，用户改不了）。上游直接用它。

### 我们改成什么

`src/app/archive.ts`（124 行）的 `ContextArchiver`，只做**可配置比例的触发与归档后的交接**：

1. 每 15 秒（`TICK_MS`）量一次受管会话的上下文压力（`ctx.tokenMeter.contextPressure`）。
2. 超过 `budget.archivePercent`（默认 65%，限 20-95）就触发归档。
3. 归档走宿主的 `ctx.compaction.compactNow` —— 摘要、游标记账、失败回滚全用宿主那一套，不自己造。
4. 归档完把「上一个上下文已归档，接着干，别从头重做」作为一条 **steer** 交给同一个会话，这就是交接。

刻意不做的事（注释里列了）：不替宿主决定保留多少尾部、不新建会话。

**几处防呆**：

- 只归档 `status === 'idle'` 的会话 —— 忙的时候进去只会拿到 busy，白跑一次还占着锁。
- 同一会话两次归档之间至少隔 120 秒（`COOLDOWN_MS`），避免刚压下去又被量上来时反复触发。
- 缺 `tokenMeter` 或 `compaction` 时**整体不启用**，而不是半跑着悄悄不归档 —— 注释原话：静默失败比不做更糟。
- `stop()` 会等在跑的那次结束，避免关停时留下半个归档。
- 定时器 `unref()`，不因为一个定时器把宿主进程撑住不退出。

在 `src/app/runtime.ts` 里挂上：`archive.start()` 在启动末尾，`shutdown()` 里先于 Sessions 停 —— 它不能在一个正在拆掉的 agent 上开始归档。

### 为什么改

**为什么不用 DSH 自带的按比例压缩**：那个比例是固定的 80% 且用户改不了。而「多少算该归档了」是操作员自己的判断 —— 他觉得 65% 就该归档，那就是 65%。绝对 token 数做不到这一点，因为同一个数在不同模型上意味着完全不同的余量。

**为什么复用宿主的 compaction 而不是自己写**：摘要策略、游标记账、失败回滚这些宿主已经做对了，重写一遍只会引入新的不一致。

**为什么归档后要 steer 一句**：归档本身会让模型以为「这是个新会话」。不给交接语，它会从头重做已经完成的步骤 —— 这比不归档更糟。

---

## 7. 每日用量（`src/app/usage.ts`）

### 上游原样

上游没有用量概念。跑多少是多少。

### 我们改成什么

`src/app/usage.ts`（66 行）的 `UsageMeter`：

- 监听每个会话的 `assistant/message` 事件，把 `uncachedInputTokens + outputTokens + cacheReadTokens + cacheWriteTokens` 累加。
- 按**本地日历日**（`YYYY-MM-DD`）分桶，跨日自动归零，不需要定时清理。
- `exceeded(limit)` 判断今天是否到线；`limit <= 0` 表示不限。

挂载：`Sessions` 在 `session/event` 里先 `this.usage.observe(event)`，**再**做后续的 per-session 过滤 —— 注释写明理由：子智能体花的是同一份额度，不能因为后面的检查跳过它就不计。

`Runtime.paused()` 加了第三条判断：

```ts
if (!this.setup.configured() || this.store.settings().paused) return true
return this.usage.exceeded(this.store.settings().budget.dailyTokens)
```

### 为什么改（为什么这样设计）

**为什么不问服务商要统计**：那条路要额外 API 凭据、有延迟、各家口径不一样。数本机自己看到的东西得到的是一个**下限** —— 不会少算本机跑的量，可能比账单少算（别处用同一个 key 花掉的）。对「到线就别再派新活」这个用途，偏保守的方向是安全的。

**为什么不落盘**：重启会丢掉今天已数到的量。而上限的用途是「别在同一天里无限花」，重启后从零开始仍然安全，不会因为多算而误拦正常的工作。

**为什么用「已花掉的量」判断而不是「加上这次会不会超」**：后者会让最后一次永远跑不完。前者让已经在跑的那轮自然结束，只是不再派新的活 —— 超限停的是派发，不是把跑到一半的回合砍断。

---

## 8. 插件管理工具（`src/app/tools/plugin.ts`）

### 上游原样

智能体想给自己加能力，只能靠 `bash` 手敲 `pnpm add`，没有规则引导，也拿不到 plugin manager 的原子性和回滚。

### 我们改成什么

`src/app/tools/plugin.ts`（56 行）的 `orchestrator_plugin` 工具，四个操作：`list_bundles` / `list_plugins` / `install_bundle` / `remove_bundle`。

走宿主自己的 `ctx.pluginManager` —— 与面板里点按钮同一套实现，所以挑 registry、失败时还原 `package.json` 与 `pnpm-lock.yaml`、报告需不需要重启，行为完全一致。

两处细节：

- 参数名用 `operation` 而不是 `action`。注释解释：角色提示词里「a necessary human action」这个说法会与 `access` 参数撞语义，看起来像是这个工具拒绝的取值。
- 宿主没有 plugin manager 时（白板 profile 未启用）返回 `{ available: false, detail: ... }` 并说明怎么启用，而不是抛错。

**权限**：不额外收窄。`WORK_TOOLS` 里本来就有 `bash`（任意命令执行），额外的收窄只是幻觉。真正的边界是「谁能发起工单」，由 Policy 白名单决定，不是「这个工具能不能用」。

### 为什么改

**为什么要有这个工具**：这是「全能型选手」最关键的一环。一个能自己加能力的智能体，与一个只能报告「这超出我的职责」的智能体，是两种东西。提示词里也对应加了一句（`prompts/work.md`）：交付物是任务指定的那个，写代码只是其中一种形式，调查结论、装好的插件、一份文档、一个本地修复都算完成。

**为什么不收窄权限**：收了也是假的。同一个智能体手上的 `bash` 本来就能装任何东西，假装这个工具更安全只会误导操作员对自己系统的判断。

---

## 9. `isolateEnvironment` 配置项

### 上游原样

`applyEnvironment()` 把智能体的 PATH、`GIT_CONFIG_GLOBAL`、`GH_TOKEN` 等直接写进 `process.env`。在上游的单插件进程里这没问题。

### 我们改成什么

`src/deployment.ts` 的 `Config` 新增：

```ts
isolateEnvironment: s.boolean().default(false).description(
  'Keep the agent environment out of process.env, so other plugins in the same profile never see the agent PATH and git settings.')
```

默认 `false`，即与上游行为一致。

打开后（`src/app/setup.ts`）：

```ts
if (!this.host.isolated) this.restoreEnvironment = applyEnvironment(this.variables, machine.stateDir, this.path)
await verifyEnvironment(resolved, context.subprocess, lifetime, this.variables)
```

注意第二行：`verifyEnvironment` 现在**显式接收变量**。理由写在 `environment.ts` 的注释里 —— 隔离后这些值不在 `process.env` 里，靠环境变量读的检查会在一个正确的安装上报错。

变量仍然通过两条路到达 worker：`commandEnvironment` 和 spawn 的 `env` 覆盖。

### 为什么改

**为什么需要它**：融合 profile 里这个插件与别的插件共享一个进程。把智能体的 PATH 和 git 设置写进 `process.env`，会静默地把**别的插件**的 `gh`、`lark-cli`、`git` 重新绑到智能体账号上 —— 它们没要求过这个，也不知道自己被换了身份。

**为什么默认关**：默认关保证已有安装升级后行为不变。要隔离是需要理由的（共享 profile），不是默认假设。

---

## 10. Windows 兼容修复

这一组改动都源于同一件事：上游的实现在 Windows 上跑不起来。`tests/qq-source.spec.ts` 的开头写明它是「对照意图行为检查 Windows 修复，而不是替换只测 POSIX 的测试」。

### 10.1 Node 24 不能直接 spawn `.cmd`

**上游**：`execFile(program, args)`，program 是配置里的 CLI 路径。

**问题**：Node 在 Windows 上拒绝直接 spawn `.cmd`/`.bat` —— 解释器没被选中，`spawn` 直接 `EINVAL`。而配置的 CLI 常常是批处理包装（`gh.cmd`）。

**改成**（`src/infra/commands.ts`）：

```ts
const BATCH = new Set(['.cmd', '.bat'])
export function command(argv: string[]): string[] {
  const [program = '', ...args] = argv
  if (!WINDOWS || !BATCH.has(extname(program).toLowerCase())) return argv
  return [CMD_INTERPRETER, '/d', '/s', '/c', program, ...args]
}
```

`cmd /d /s /c` 让 cmd 原样执行后面的部分，`/s` 只剥掉它自己加的外层引号。真实可执行文件（`.exe` 等）原样通过。这个包装在 `Commands.run()` 和 `runAsWorker()` 两处都用上。

### 10.2 `GH_CONFIG_DIR` 隔离

**上游**：靠一个 POSIX shim 脚本给 worker 的 `gh` 绑定账号。

**问题**：Windows 的 shell 从不执行那些 sh shim。留着它们只会遮蔽真实二进制，还误导读 state 目录的人。

**改成**（`src/infra/environment.ts`）：

- `writeEnvironment()` 在 Windows 上跳过 `gh` shim，改为 `writeGhConfig()` 写一个独立的 `GH_CONFIG_DIR`（`stateDir/gh-agent`）。
- `agentVariables()` 在 Windows 上加 `GH_CONFIG_DIR: ghConfigDir(stateDir)`。
- token 从配置的 agent CLI 自己的配置里**复制**过去 —— 所以 shim 仍是凭据被加入的唯一位置，本项目不写任何它没被给过的东西。
- `hosts.yml` 不能带前导注释 —— `gh` 解析它时不跳过前言，会把带注释的文件判为无效。`config.yml` 也必须写，否则 `gh` 把这个目录当成迁移目标并拒绝第一条命令。

### 10.3 `gh auth token` 探测

**问题**：Windows 靠目录查账号，那就得真的证明 worker 的 `gh` 报告的是配置的账号，不能假设。

**改成**：

- `src/deployment.ts` 的 `resolveDeployment()` 在 Windows 上跑一次 `[cli, 'auth', 'token']` 把 token 读出来；只从环境里的 `GH_TOKEN` 答复的 CLI 没有 token 可复制，setup 会明说（新增 `agentCliTokenMissing`）。
- `verifyEnvironment()` 在 Windows 上多跑一次 `gh api user --jq .login`，与 `github.login` 比对，不符就报 `workerGhWrongAccount`。
- `workerProbe()` 在 Windows 上不再用 `env` 工具（Windows 没有 `env`），改为直接把覆盖传进子进程；并且**必须在这里也传 `GH_CONFIG_DIR`** —— probe 跑在 `applyEnvironment` 之前。

新增的四个 SetupProblem（`src/setup.ts`）：`agentCliTokenMissing`、`workerGhFailed`、`workerGhWrongAccount`、`isolationFailed`。前三个在 `setup.ts`/`environment.ts` 里真的会抛；`isolationFailed` 目前只有定义与界面文案（`src/client/locales.ts`），代码里还没有抛出点 —— 记录下来，免得读者以为它在守什么。

### 10.4 路径与可执行文件

- `src/deployment.ts` 的 `absolute()` 从 `/^\//` 放宽到 `/^(\/|[A-Za-z]:\/)/`，接受 `X:/` 形式的盘符路径。
- `executable()` 在 Windows 上补 PATHEXT 后缀候选（`''`, `.exe`, `.cmd`, `.bat`, `.com`），且不检查 `X_OK`（Windows 不强制这个位）。
- `credentialHelper()` 在 Windows 上用双引号而不是 POSIX 单引号 —— git 通过 shell 执行 `!` 前缀的 helper，Windows 上的路径最安全的写法是双引号。

### 为什么改

这不是「顺便修一下 Windows」。项目要能在一台 Windows 机器上实际跑起来，这四个问题每一个都会让安装直接失败在 setup 阶段。而且失败方式很难自查 —— `EINVAL`、`gh` 报一个不存在的账号、路径被判为相对路径，这些都不指向真正的原因。

---

## 附：其余改动一览

| 文件 | 改动 | 原因 |
|---|---|---|
| `src/app/runtime.ts` | 挂 `ContextArchiver`、`UsageMeter`、长任务提醒、前台运行播报、budget 健康条目；`paused()` 并入用量判断 | 承载归档/预算/调度三项新能力 |
| `src/app/sessions.ts` | `ensure()` 加 `hard` 参数走 `modelFor`；新增 `managed()` 给归档器用；用量从每个会话事件喂进 `UsageMeter`；工具白名单按平台实际有的名字过滤（`bash`/`pwsh`） | 调度、归档、用量的挂载点；修 Windows 上 `bash` 不存在导致 restrict 失败 |
| `src/app/settings.ts` / `src/app/http.ts` / `src/app/views/settings.ts` | 新增 `routing` 与 `budget` 两个设置块 | 新配置项要走完整的读写/校验/版本链 |
| `src/client/routing.tsx` / `src/client/budget.tsx` / `src/client/route.ts` / `src/client/settings.tsx` | 新增两个设置分组页面 | 操作员要在界面上调这些，不能只是配置文件里的字段 |
| `src/limits.ts` | 新增 `difficultyThreshold`、`archivePercent`（20-95）、`longTaskMinutes`（1-1440） | 边界的单一定义处 |
| `src/core/model.ts` / `src/core/ports.ts` | `ActorRef.name`（展示用，策略永远匹配 `id`）；`Execution.difficulty`；`AssessmentOutcome` 带 difficulty | 多平台来源要显示发件人名；难度要贯穿到 worker |
| `src/sources/host.ts` / `kind.ts` | `Health.instances`、`SourceContext.instances()`、`SourceChannel.send` 带 config、新增 `mailUnconfigured` 健康文案 | 多实例 + 通道自有凭据 |
| `src/app/source-context.ts` | 多实例健康聚合（取最差）、`instances()` 实现 | 一个账号坏了不能因为另一个好而显示健康 |
| `cordis.patch.yml` | 新增 `dsh-superagent-qq`、`dsh-superagent-mail` 两个可选插件（默认 `disabled: true`）；预设名改为「Super Agent 执行器 / 主 Session」 | 新来源不配账号不该自己跑起来；对外名称统一 |
| `package.json` | 版本 `0.1.0` → `0.2.0`；exports 加 `qq-watch`/`mail-watch`；peer 版本放宽为 `^`；补 `peerDependenciesMeta` 全部 optional；中文 description | 新入口要能被加载；单一 DSH 版本锁会在融合 profile 里挡住安装 |
| `tsdown.config.ts` | 构建入口加 `qq-watch`、`mail-watch` | 同上 |
| `prompts/work.md` | 加一句「交付物是任务指定的那个，写代码只是其中一种形式……用任务需要的工具，不要报告说超出职责」 | 配合 plugin 工具，把「全能型」写进角色 |
| `locale/*.json` / `src/client/locales.ts` | 标题 `Superagent` → `Super Agent`；新增 routing/budget 全部文案 | 对外名称统一；新设置页要中文 |
| 新增测试 | `qq-source`、`mail-source`、`imap`、`multi-instance`、`routing`、`self-inspect` | 新逻辑各自有覆盖，尤其多实例与 Windows 分支 |

---

## 一句话总结

上游是一个「单仓库 + 单来源 + 单模型 + 固定上限」的研究原型。这一版把它撑成一个**能接多个平台、每个平台多个账号、按难度分模型、能看自己状态、能自己加插件、有可调配额**的实用智能体，并且第一次真的能在 Windows 上跑起来。
