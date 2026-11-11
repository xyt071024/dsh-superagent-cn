# 参与开发

这个项目是 DSH（DeepSeek Harness）的一个 bundle：主插件监听来源、按策略收活、把活派进各自的会话；每个来源是一个独立入口。

改动前先读 `src-repo/docs/` 里编号的几篇——`002-authorization.md`（权限从哪来）和 `003-execution.md`（worker 能干什么是被什么限定的）几乎每次改代码都要用到。

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

单跑一个文件、或按名字筛：

```sh
npx vitest run tests/policy.spec.ts
npx vitest run -t "gate"
```

`pnpm check` 是三条一起跑：`tsc --noEmit` + `vitest run` + `tsdown`。**这是提交前最省事的自检。**

### 打包

成品包由 `_tools/build-packages.mjs` 产出（在工作树根，也就是 `src-repo/` 的上一级）：

```sh
node _tools/build-packages.mjs
```

它一次做四种包：插件版 / 白板版 × 标准版 / 破甲版，输出到 `_packages/`。白板版 = 插件 tarball + 一个已经把插件接好线的 profile，解压双击就能跑。

打包脚本会先 `npx tsdown` 再 `npm pack`，所以**它跑通就等于构建没问题**；反过来说，只改了 `lib/` 里手写的东西一定会被下次打包冲掉。

---

## 2. 加一个新来源要动哪四处

少改一处，症状各不相同，四处都要动：

| # | 文件 | 改什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `tsdown.config.ts` | 在第一个配置的 `entry` 里加一行 `'<名>-watch': 'src/sources/<名>.ts'` | `lib/<名>-watch.js` 不生成，`import` 的时候才报找不到 |
| 2 | `package.json` | `exports` 加 `"./<名>-watch": "./lib/<名>-watch.js"` | 宿主按包名解析入口时失败，插件静默不加载 |
| 3 | `cordis.patch.yml` | 在 `insert:` 列表里加一个条目（`id` + `name: dsh-superagent/<名>-watch`），默认 `disabled: true` | 面板里看不到这个来源，配也没处配 |
| 4 | profile 的 `cordis.patch.yml` | 把第 3 步那个条目改成 `disabled: false`（或用 `examples/profile.cordis.patch.yml` 的写法） | 代码在、入口在、面板有卡片，但它永远不启动，状态一直「待处理」 |

第 1、2 步对应构建与解析，第 3、4 步对应「装进来」和「真的开起来」——这两件事在这个项目里是分开的，所以是两处。

### 来源本身要实现的契约

看 `src/sources/kind.ts` 的 `SourceKind`，以及 `src/sources/mail.ts`、`src/sources/qq.ts` 两个现成实现。最少要有：

- **配置 schema**（zod）与 `fields`（面板表单，中文 + 英文两份文案）；
- **触发翻译**：把平台事件变成 `Trigger`，写清 `actor`（谁发的）、`threads`（归到哪条线程）、`addressed`（是不是冲着它说的）、`meta`；
- **回信通道**：`channel.send()`，按 id 幂等地发，目标会话没了返回 `'gone'`；
- **`policy`**：白名单字段、准入表的行、以及这个来源把什么算作「发给它」的说明。

有线程上下文的来源还要实现 `threadContext`（评估时读上下文用）；有多个账号的，用 `sourceContext(ctx.orchestrator, kind).instances(kind)` 拿全部实例，别只读第一个。

`docs/008-cookbook.md` 是上游写的加来源教程，照着走一遍最快。

---

## 3. 提交前必须过的两条

**这两条不过就别提 PR。** 它们便宜、快，而且能挡住绝大多数会让别人装不上的问题。

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

**基线不是「全绿」，是「和改动前一模一样的失败集合」。** 仓库里有一批依赖 POSIX 环境或宿主二进制的测试（`service-script`、`environment`、`commands` 等），在 Windows 上本来就会失败。判断标准是：

1. 改之前先跑一次，把失败的文件名和用例名记下来；
2. 改之后对比，**只允许变少，不允许出现新的**；
3. 新增的失败必须在你自己的改动里找到原因，找不到就是你不能提交。

换句话说：**你的 PR 不能让别人原本能过的测试挂掉。** 顺手修好一个原本就挂的测试是加分项，前提是理由在 PR 里说清楚。

---

## 4. 代码风格

### 注释解释「为什么」，不解释「是什么」

代码已经写清了做什么，注释要写的是**为什么是这样而不是别的样子**——尤其是那些看起来可以更简单的地方。

```ts
// 好：说明约束与代价
// Windows 不执行 POSIX 包装脚本，所以账号改由隔离的 GH_CONFIG_DIR 绑定。
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
