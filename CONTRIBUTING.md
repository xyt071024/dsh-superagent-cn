# 参与开发

这个项目是 DSH（DeepSeek Harness）的一个 bundle：主插件监听来源、按策略收活、把活派进各自的会话；每个来源是一个独立入口。

改动前先读源码树里编号的几篇设计文档——`002-authorization.md`（权限从哪来）和 `003-execution.md`（worker 能干什么是被什么限定的）几乎每次改代码都要用到。

> **这些文档可能不在公开镜像里。** 公开仓库的 `src-repo/` 目前只同步源码（`src/`、`tests/`、`prompts/`、`skills/`、`locale/`、配置文件），`docs/`、`examples/`、`SETUP.md` 留在源码仓库。找不到就去看源码仓库，别以为是自己 clone 坏了。

---

## 1. 搭开发环境

```sh
# 1. 装依赖（Node 22.19+ 或 24+，pnpm 11）
cd src-repo
pnpm install

# 2. 编译到 lib/
npx tsdown

# 3. 跑测试
npx vitest run
```

`package.json` 里的 `packageManager` 钉住 pnpm 11，`engines` 钉住 Node 22.19+ / 24+。两者用错版本会先报一堆与本项目无关的错，先核对这个。

> **公开镜像里可能缺两个文件**：`pnpm-lock.yaml` 和 `vitest.config.ts` 目前没有同步进公开仓库。
> - **缺锁文件**是真正要紧的那个：`pnpm install` 会按 `package.json` 的范围现解析，装出来的版本可能和维护者当时的不同（实测会拉到 `tsdown`、`typescript`、`vitest` 的更新版本）。日常开发无所谓，但要复现某个具体问题时，先拿到维护者那份锁文件，否则你修的可能是另一个版本的毛病。
> - 缺 `vitest.config.ts` 影响很小：它只做一件事——让 DSH 客户端包和测试共用同一个 React 实例。缺了它，本机实测 `tests/*.spec.tsx` 仍然全过；真出现 hook 或 React 实例相关的怪错时，把它从源码仓库拷回来再试。

单跑一个文件、或按名字筛：

```sh
npx vitest run tests/policy.spec.ts
npx vitest run -t "gate"
```

`pnpm check` 是三条一起跑：`tsc --noEmit` + `vitest run` + `tsdown`。**这是提交前最省事的自检。**

### 打包

成品包由 `_tools/build-packages.mjs` 产出。**这个脚本不在本仓库里**——它在维护者的工作树根，和源码目录同级；公开仓库里只有 `src-repo/` 这一份源码。所以它的调用方式是：

```sh
node _tools/build-packages.mjs
```

它一次做四种包：插件版 / 白板版 × 标准版 / 破甲版，输出到 `_packages/`。白板版 = 插件 tarball + 一个已经把插件接好线的 profile，解压双击就能跑。

脚本里源码目录写死为 `dsh-superagent-prototype/`（工作树里的名字），对应本仓库的 `src-repo/`；两者是同一份代码的两个位置，改路径时两边都要对得上。

打包脚本会先 `npx tsdown` 再 `npm pack`，所以**它跑通就等于构建没问题**；反过来说，只改了 `lib/` 里手写的东西一定会被下次打包冲掉。

---

## 2. 加一个新来源要动哪四处

少改一处，症状各不相同，四处都要动：

| # | 文件 | 改什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `tsdown.config.ts` | 在第一个配置的 `entry` 里加一行 `'<名>-watch': 'src/sources/<名>.ts'` | `lib/<名>-watch.js` 不生成，`import` 的时候才报找不到 |
| 2 | `package.json` | `exports` 加 `"./<名>-watch": "./lib/<名>-watch.js"` | 宿主按包名解析入口时失败，插件静默不加载 |
| 3 | `cordis.patch.yml` | 在 `insert:` 列表里加一个条目（`id` + `name: dsh-superagent/<名>-watch`），默认 `disabled: true` | 面板里看不到这个来源，配也没处配 |
| 4 | profile 的 `cordis.patch.yml` | 把第 3 步那个条目改成 `disabled: false`（安装器生成的 profile 里也是同一件事） | 代码在、入口在、面板有卡片，但它永远不启动，状态一直「待处理」 |

第 1、2 步对应构建与解析，第 3、4 步对应「装进来」和「真的开起来」——这两件事在这个项目里是分开的，所以是两处。

### 来源本身要实现的契约

看 `src/sources/kind.ts` 的 `SourceKind`，以及 `src/sources/mail.ts`、`src/sources/qq.ts` 两个现成实现。最少要有：

- **配置 schema**（zod）与 `fields`（面板表单，中文 + 英文两份文案）；
- **触发翻译**：把平台事件变成 `Trigger`，写清 `actor`（谁发的）、`threads`（归到哪条线程）、`addressed`（是不是冲着它说的）、`meta`；
- **回信通道**：`channel.send()`，按 id 幂等地发，目标会话没了返回 `'gone'`；
- **`policy`**：白名单字段、准入表的行、以及这个来源把什么算作「发给它」的说明。

有线程上下文的来源还要实现 `threadContext`（评估时读上下文用）；有多个账号的，用 `sourceContext(ctx.orchestrator, kind).instances(kind)` 拿全部实例，别只读第一个。

上游的 `docs/008-cookbook.md` 是加来源的完整教程，照着走一遍最快（这份文档在源码仓库，不一定在公开镜像里）。

---

## 3. 提交前必须过的两条

**这两条不过就别提 PR。** 它们便宜、快，而且能挡住绝大多数会让别人装不上的问题。两条都在 `src-repo/` 里跑。

### ① 类型检查输出 0 个 `error TS`

```sh
cd src-repo
npx tsc --noEmit 2>&1 | grep -c "error TS"   # 必须是 0
```

`tsconfig.json` 是 `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`，类型上不留口子。**不要为了让错误消失去加 `any` 或 `@ts-expect-error`**——这项目里类型是设计的一部分，绕过去等于把问题推给运行时。

### ② 测试相对基线零新增失败

```sh
npx vitest run
```

`0.2.0` 的源码树在干净安装后，`tsc --noEmit` 是 **0 个 `error TS`**，可以直接拿来做对照；如果这条就已经不过，先别改代码，把你本地的分支、依赖版本和 Node 版本核对一遍。

**基线不是「全绿」，是「和改动前一模一样的失败集合」。** 仓库里有一批依赖 POSIX 工具或真实宿主的测试（`service-script` 要 `sh`、`environment` 要符号链接、`commands` 要 `env`/`sleep`、`docs` 要上游文档表保持同步），**在 Windows 上本来就会挂**。以 `0.2.0` 的 Windows 工作树为准，基线大约是 65 个测试文件里 8 个失败、1200+ 个用例里 42 个失败——这个数字本身不重要，重要的是它在你动手前后**不变**。

判断标准：

1. 改之前先跑一次，把失败的文件名和用例名记下来（`npx vitest run --reporter=json --outputFile=before.json`，或直接看终端输出）；
2. 改之后对比，**只允许变少，不允许出现新的**；
3. 新增的失败必须在你自己的改动里找到原因，找不到就是你不能提交。

换个平台基线的构成会变：同一个提交在 Linux 上很可能全绿。所以**先在同一台机器上取基线，再比**——拿 Linux 的绿去比 Windows 的红，只会得出错误结论。

**`docs.spec.ts` 那两个「表格完整性」测试尤其要注意**：它们在 Windows 上失败**不代表文档真的漏登记**。原因是 `tests/docs.spec.ts` 的 `files()` 用 `path.relative()` 产出**反斜杠**路径（`src\admission.ts`），而 `docs/007-architecture.md` 的表格里写的是正斜杠（`src/admission.ts`），两边永远对不上。同一个提交在 Linux 上，`relative()` 产出正斜杠，这两个测试就通过。

所以：**别为了「修红」去往 `007-architecture.md` 里补反斜杠路径**——那会把 Linux 上能过的测试弄挂。真要改这两个测试，改的是测试本身（把分隔符归一化），不是文档。

换句话说：**你的 PR 不能让别人原本能过的测试挂掉。** 顺手修好一个原本就挂的测试是加分项，前提是理由在 PR 里说清楚。

---

## 4. 代码风格

### 注释解释「为什么」，不解释「是什么」

代码已经写清了做什么，注释要写的是**为什么是这样而不是别的样子**——尤其是那些看起来可以更简单的地方。

```ts
// 好：说明约束与代价
// Windows never executes the POSIX shim, so the account is bound through its own GH_CONFIG_DIR instead.
if (WINDOWS) await writeGhConfig(stateDir, github)

// 不好：把代码念了一遍
// 如果是 Windows 就写 gh 配置
if (WINDOWS) await writeGhConfig(stateDir, github)
```

值得写注释的地方：

- 一个看起来多余的分支，其实是某个平台的限制；
- 一个「本来可以更短」的写法，短了会坏在什么地方；
- 一个常量为什么取这个值（上下限、超时、冷却）；
- 顺序敏感的地方（先停归档器再销毁会话，否则会在拆到一半的会话上归档）。

不写：函数签名能看出来的事、`i++` 是在自增、以及任何会随代码改动立刻过时的话。

### 注释用英文，与上游一致

新增的代码注释写**英文**。理由不是崇洋，是这三条：

1. 这个项目的上游（`src-repo/` 里的研究原型）通篇英文注释，混着写之后同一个文件里两种语言交替，读起来更慢；
2. 英文注释在 grep、diff、code review 里与上游的历史一致，不会因为换行规则不同产生噪声 diff；
3. 报错信息、类型名、日志都是英文，注释跟着同一种语言，读的人不用来回切。

**例外**：面向用户的文案（面板标签、`locale/*.json`、`zh` 那一半的 `Localized`）当然是中文，而且必须写；面向操作者的文档（`_publish/` 下的 `.md`）也用中文。语言分界线是**「给用户看的」还是「给改代码的人看的」**，不是「新写的还是旧的」。

**说清现状**：`0.2.0` 加进来的几个文件（`src/app/archive.ts`、`src/app/usage.ts`、`src/app/tools/plugin.ts`、`src/client/budget.tsx`）里的注释是中文的，与上游的英文注释混在同一个仓库里。这是历史遗留，不是范例。新写的注释按英文来；顺手把碰到的那几行改成英文是欢迎的，但别为了统一语言单独提一个大 PR——那会把真正的改动埋掉。

### 其它约定

- **不要为了通过检查而改检查**：改 `tsconfig`、改 `vitest.config.ts` 的 `include`、给测试加 `skip`，这些都会在 review 里被打回。
- **提交信息说清动机**，不要写「fix bug」「update」。
- **一次 PR 一件事**。加了来源又顺手重构了权限判断，review 的人没法判断哪部分影响了授权。
- **不要提交** `lib/`、`node_modules/`、`.artifacts/`、以及任何真的含有令牌的文件（`.env`、`cordis.patch.local.yml`、`orchestrator.sqlite` 之类）。`.gitignore` 已经挡了大部分，但别依赖它。

---

## 5. 改了会影响别人的东西时

下面这些改动会改变**已经在跑的人的机器上的行为**，PR 里必须单独说明，并在 `CHANGELOG.md` 的 `Unreleased` 里记一条：

- 设置 schema 的任何字段（改名、改默认值、加必填）——已经保存的设置可能反序列化失败；
- 数据库迁移（`src/app/migration.ts`）——迁移过的新库旧版本打不开，回滚只能靠备份；
- `cordis.patch.yml` 里的预设（worker / orchestrator 的插件集与 shell 超时）；
- `prompts/` 下的任何文件——这些是 worker 和主会话的实际行为，改一句就改了所有人手里的助手；
- 来源的默认配置（端点、轮询间隔、默认开关）。

加来源不算破坏性改动（默认 `disabled: true`，不配就不跑），但仍然要在 CHANGELOG 里写一句「能收哪个平台的消息了」——那是用户唯一会读的部分。
