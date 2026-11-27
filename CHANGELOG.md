# 更新日志

本文件记录本项目所有值得记录的变化。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

因为插件通过 bundle 打进 DSH profile，升级前请先备份 `<stateDir>/orchestrator.sqlite`：被新版本迁移过的数据库，旧版本打不开。

## [Unreleased]

## [0.3.20] - 2026-11-27

本版修复 2026-11-27 `v0.3.19` 桌面独立复验指出的两项关键边界问题：

### 修复

1. **代码工作项严禁走人工验收（创建/发布服务端拒收 + 历史记录合并兜底）**
   - `src/app/divisions.ts` 新增 `allowsManualAcceptance()`（仅允许 `docs` 与 `research`）与 `assertCompatibleWorkItemVerificationMode()`，在 `dispatch()`、`publishWorkItems()` 与分工工具入口直接拒绝为 `code`（含缺省未声明类型）、`config` 等非文档/调研工作项显式指定 `verificationMode: 'manual_acceptance'`；`resolveWorkItemVerificationMode()` 对非文档/调研类一律返回 `'test_required'`。
   - `mergeWorkItem()` 增加历史持久化记录二次兜底校验：若旧 SQLite 记录存在 `kind !== 'docs' && kind !== 'research'` 且 `verificationMode === 'manual_acceptance'`，强制纠正为 `'test_required'`，在缺少当前版本受控实测凭据时以 `failureReason: 'incompatible_verification_mode'` 明确拒绝并保持下游依赖锁定；文档项人工验收与代码项实测通过两条正向路径照常工作。

2. **投机草稿状态与 Outbox 权威回执严格对齐（暂停 / 离线 / 恢复仅发一次 / 丢弃 / 重启一致）**
   - `src/app/outbox.ts` 在 `OutboxHost` 增加 `onSettled(id, status, outcome)` 回调，由 `src/app/runtime.ts` 接入 `divisions.syncDraftWithOutboxReceipt()`；`src/kv.ts`、`src/app/api.ts`、`src/client/overview.tsx` 新增 `SpeculativeDraft.receiptStatus` 展示待发状态。
   - `deliverDraftViaHost()` 与 `confirmSpeculativeDraft()` 以同一 `deliveryKey` 的 Outbox 回执为准：仅 `receipt.status === 'sent'` 才进入 `delivered`；暂停处理或渠道离线使回执保持 `'pending'` 时，返回 `{ delivered: false, pending: true, receiptStatus: 'pending' }` 且草稿保持 `delivering` 待发态（0 次渠道外发、409 禁撤销）；解除暂停或渠道恢复在线后依据同一 `deliveryKey` 仅发送 **1 次**并自动同步为 `delivered`；被渠道永久丢弃（`channelGone` / `channelIgnored`）同步为 `delivery_failed`（`receiptStatus: 'dropped'`）；回执仍 `pending` 期间重启进程时，`recoverSpeculativeDrafts()` 保持 `delivering` + `receiptStatus: 'pending'` 与发件箱一致，恢复后仍恰好外发 1 次。

## [0.3.19] - 2026-11-27

本版针对 2026-11-27 `v0.3.18` 桌面独立复验指出的四项关键架构问题完成全面加固与真实入口接通：

### 新增与修复

1. **合并验证门禁前置原子化与受控执行入口（高优 1）**
   - `src/app/divisions.ts` `mergeWorkItem` 将归属权限、工作项状态、重复 `event_id` 幂等判断与 `activeVerification` 并发在途锁全部前置至单一 `store.atomic` 事务内，在拉起任何外部进程之前完成拦截；无权、非法状态与重放请求均保证 **0 次额外执行**，同 `event_id` 并发重试自动合流，异 `event_id` 并发竞争直接拒绝。
   - `src/infra/commands.ts` 新增统一受控执行入口 `Commands.runChecked()`（沿用 Windows `.cmd` 解析、环境隔离、生命周期 `AbortSignal` 与超时/输出上限），并支持注入计数型测试替身。
   - `submitWorkItem` 每次提交递进 `deliverableVersion`，验证结果按版本原子提交，验证期间产物变更自动按 `stale_verification` 拒绝，绝不提前解锁下游。

2. **强制可信验证凭据五态与文档人工验收（高优 2）**
   - `DivisionWorkItem` 新增 `kind`（默认 `code`）与 `verificationMode`（代码类默认 `test_required`，文档/调研类可采用 `manual_acceptance` 并强制记录 `acceptanceMethod` 与 `acceptanceNote`）。
   - 仅受控运行器为当前 `deliverableVersion` 签发的 `verificationCredential`（`source: 'controlled_runner'`）可解锁下游依赖，覆盖并实测**缺结果**、**伪报通过**、**测试失败**、**结果过期**与**通过**五态。

3. **投机草稿并发认领、发送/撤销边界与崩溃重启零重发（高优 3）**
   - `SpeculativeDraft` 创建即绑定不可变稳定投递键 `deliveryKey = spec-draft:<draftId>`，确认时在 `store.atomic` 原子认领进入 `delivering` 并写入持久台账 `KV.sessions.speculativeDelivery(deliveryKey)`；并发双确认合流至同一在途 Promise，仅发送 1 次。
   - 发送与撤销建立严格互斥边界：进入 `delivering` 或 `delivered` 后撤销/丢弃均抛 `DraftBoundaryError`（HTTP 409），杜绝矛盾状态。
   - `recoverSpeculativeDrafts()` 与重试前探测自动核对持久台账、真实 `Outbox` 回执、`sessions.holds` 或外部探针，崩溃重启后零重发收口。

4. **§4.2 投机草稿接通真实事件、主会话工具、HTTP API、Outbox 与管理面板（问题 4）**
   - 注册主会话统一工具 `orchestrator_draft`（`op: create | confirm | revoke | discard | list`），按真实入站 `Trigger` 绑定渠道 `Outbox` 目标；新增管理 HTTP 端点 `GET /orchestrator/api/drafts` 与 `POST /orchestrator/api/drafts/:id/{confirm,revoke,discard}`，并在概览面板 `OverviewPage` 提供待确认草稿列表与确认/撤销/静默丢弃交互按钮。

## [0.3.18] - 2026-11-27

本版根据 2026-11-27 Linux 复测报告补充（问题 I / G1 / G2 / H / M / N / K）及设计对照三大优先项与 §4.2 投机执行闭环要求完成全面升级与跨平台 CI 加固。

### 新增与修复

**1. 三渠道消息解析补齐（问题 I / G1 / G2 / H）**

- **GitHub 标题提及（问题 I）**：`src/sources/github-trigger.ts` `issueTrigger`（及 `pullTrigger`）改为同时检测 `issue.title` 与 `issue.body` 中的 `@` 提及，修复“只在标题提及”漏判问题。
- **个人 QQ 引用权限回查与图片附件（问题 G1 / G2）**：`src/sources/qq.ts` 新增 `replyIdOf`、`imageRefsOf`、`qqImageKeys` 与 `readQqImage`：保留引用消息 ID（`meta.replyToId` 与 `repliesTo`），在 `threadContext.read('parent')` 中通过 `get_msg` 按同群/同私聊作用域严格鉴权回查原文（越权跨群/跨人明确返回 `forbidden` 零泄露）；为图片生成可读附件引用 `[图片: qqimg_*]` 并实现受控下载、魔数校验与附件入库（404/非图片明确报错）。
- **飞书 `post` 混合富文本解析（问题 H）**：`src/sources/feishu-trigger.ts` 与 `src/sources/feishu-read.ts` 新增 `parseFeishuContent`，统一在实时事件、历史 API、话题轮询与上下文视图中解析 `post` 标题、多段落、纯文本、`<a href>` 链接、`<at>` 提及与内嵌 `<img>` 图片键（`img_*` 同步可供 `admissionImageKeys` 识别）。

**2. 主动补位、真实双文件合并门禁、真实审查入口与 §4.2 投机草稿闭环（设计优先项 1–3）**

- **主动补位与无人应答防卡死（优先项 1）**：`src/app/divisions.ts` 与 `src/kv.ts` 新增 `offerClaimableWorkItems`、`reclaimExpiredOffers` 与 `handoffAudit` 审计轨迹；发布工作项或成员完成/等待依赖时自动向空闲成员推送 `[work_item_available]` 补位通知，无人应答超期后自动回退原负责人并通知主协调者，防止无限等待。
- **真实合并验证门禁（优先项 2）**：升级 `mergeWorkItem` 与 `orchestrator_division_merge_item`，支持在工作目录实际执行测试命令（`run_check` + `verification_command`）及显式冲突标记（`conflict_files`）；测试失败或合并冲突时标记为 `merge_failed` / `conflict` 清晰可见并阻断下游依赖解锁，修复并通过实测后才解锁依赖。
- **真实审查提交入口强制独立性（优先项 3）**：将 `canReviewWorkItem` 正式接入 `submitReview`（`orchestrator_division_review_submit`）与新增工作项复核入口 `reviewWorkItem`（`orchestrator_division_review_item`），在真实工具入口直接拒绝作者自审、放行非作者或独立复查会话通过。
- **§4.2 投机执行闭环**：新增持久化 `SpeculativeDraft`（`createSpeculativeDraft` / `confirmSpeculativeDraft` / `revokeSpeculativeDraft` / `discardSpeculativeDraft`），覆盖“未发布草稿 → 确认交付一次 / 撤销零外发 / 无价值静默丢弃”三类终态。

**3. 安装脚本兜底提示、Git 包装器前置校验与跨平台 CI 矩阵（问题 M / N / K）**

- `_remote/install.ps1` 与 `_remote/install.sh`（含 `.txt` 副本）同步更新兜底版本至 `0.3.18`，在 GitHub API 不可达回退固定版本时明确输出无法确认最新版的警告。
- `src/infra/environment.ts` 与 `tests/fixtures/git.ts` 新增 `GIT_CONFIG` / `GIT_CONFIG_SYSTEM` 清理与 `probeGitConfigIsolation()` 前置配置可读性校验，避免宿主异常 Git 包装器静默干扰测试。
- `.github/workflows/ci.yml` 补齐跨平台验证矩阵：新增 Linux 侧 Unix 打包/引导自测与 Python 发布预检单测、独立 `Packaging & Bootstrap (Windows)` 作业，以及 `lint-scripts` 中 `SA_PINNED_VERSION` / `$SaPinnedVersion` 与 `package.json` 版本及兜底提示自动一致性校验。

### 分平台测试结果

- **Windows（本机）**：Vitest 78 个文件 `77 passed | 0 failed | 1 skipped`（**1,370 passed | 0 failed | 15 skipped**，跳过项为 POSIX 专属守护脚本）；历轮 41–50 号 8 套验收 **37 passed | 0 failed**；`unix-bundle.test.mjs` `2 passed`；`profile-bootstrap-selftest.mjs` `8 passed`；`test_release_preflight.py` `1 passed`。
- **Linux（GitHub Actions CI）**：全量 Vitest（含 15 项 POSIX 守护脚本用例）、Unix 打包与引导自测、Python 预检单测、构建与安装脚本解析全部通过（详见本次 Release 校验摘要）。

## [0.3.17] - 2026-11-25

本版围绕独立复验第 51 号目录留存的 `M07-m1` / `M07-m2` 及工作区独立会话、设置导航、模型目录与严格继承、成员双向协作与吞吐测速工具等 7 项需求完成全面升级。

### 新增与修复

**1. 大数量槽位完整分页可达与稀疏存储（`M07-m1` / `M07-m2`）**

- `src/client/routing.tsx` 保留 32 项每页渲染并补齐“上一页 / 下一页”、窗口化页码切换与“按槽位编号直达跳转”（`#dt-slot-jump`），实测 `N = 32 / 384 / 385 / 416 / 5000` 全部 `1..N` 槽位 100% 可达（含 `N = 385` 下同时独立配置第 352、353、384、385 位并保存重载）。
- `src/policy.ts` 与 `src/app/routing.ts` 新增稀疏映射 `sessionModelOverrides: Record<string, RoleModel>`（同时向后兼容旧 `sessionModels` 数组），高编号槽位（如第 `5000`、`100000` 位）不再填充空数组，序列化体积仅随实际配置项增长（约 82 字节），重启可读且其余槽位正常继承。

**2. 设置入口注册、插件管理直达与聊天顶栏分工状态（需求 1 & 2）**

- 在 `src/client/route.ts`、`src/client/settings.tsx`、`src/client/locales.ts` 正式注册「会话分工与模型（`routing`）」与「上下文与预算（`budget`）」设置页，补齐未保存 / 保存中 / 已保存 / 失败状态标签。
- 在插件管理页（`deployment.tsx`、`index.tsx`）新增直达路由与预算设置按钮，并在聊天会话顶栏（`conversation.session.header.utilities`）注入实时分工模式标识、直达设置与“新建自动分工对话”入口。
- 修复 `cordis.patch.yml` 中 `dsh-superagent-router`（`Super Agent · 自动分工协调`）与 `dsh-superagent-worker`（`Super Agent · 内部执行器（自动使用）`）的中文乱码，清晰区分普通聊天、自动分工协调与内部执行预设，并支持普通聊天启用/取消/重启恢复后的实际工具权限同步。

**3. 同工作区独立顶层对话与自然复杂任务主动拆分（需求 3 & 4）**

- `src/app/sessions.ts` 新增 `resolveSessionWorkspace(originSessionId)`，从宿主 `workspaceRegistry` 优先继承发起聊天所属工作区 `workspaceId` 与路径，并在重试、复查与 60% 接力中全程透传；新建分工会话不带 `parentSession`，自动在原工作区侧栏以“任务名 · 分工名”展示独立可打开对话。
- `src/app/routing.ts` 与 `src/app/divisions.ts` 增强自然中文多交付物识别（如“请分别核对安装说明、设置项说明和更新日志，各自给出文件依据，最后汇总”），在不提示“开会话”的情况下自动按需拆分为独立分工会话，简单单步任务仍留在原聊天（`0` 额外会话）。

**4. 成员双向互通、动态补位领取、原负责人合并与独立复查回避（需求 5）**

- 在 `TaskPlan`（`src/kv.ts`）与 `DivisionCoordinator`（`src/app/divisions.ts`）新增持久化工作项（`workItems`）与成员消息（`peerMessages`），提供 `orchestrator_division_publish_items`、`orchestrator_division_claim_item`、`orchestrator_division_submit_item`、`orchestrator_division_merge_item` 与 `orchestrator_division_peer_message` 五项协作工具。
- 支持空闲或等待依赖的成员原子认领可拆分工作项（带 `event_id` 并发防重）、向原负责人自动发接手通知、提交并由原负责人验收合并、失败释放、60% 接力保留认领/归属状态、消息防循环护栏及独立复核回避校验（参与编写者不可自审）。

**5. 宿主完整模型目录、同名模型区分与严格继承原窗口模型（需求 6）**

- `ModelField`（`src/client/settings-kit.tsx`）新增按供应商分组的下拉选择器（以 `provider + model` 区分同名模型）、“跟随发起聊天”首选项、刷新目录按钮与下架模型警告。
- `src/app/sessions.ts` 新增 `resolveOriginModel()` 与 `validateModelInCatalog()`，严格按 `model/selection → request/header → 宿主默认模型` 捕获发起聊天实际生效模型并彻底移除向 `masterId` 静默回退路径；已配置模型从目录移除时明确报错并允许重选。

**6. 输出吞吐与并行测速工具（需求 7）**

- 新增 `scripts/benchmark-throughput.mjs`（含 `--mock-server` 本地验证与真实 OpenAI-SSE 端点模式），严格按单条生成速度 `outputTokens / (lastToken - firstToken)` 与多路合计速度 `sum(outputTokens) / (max(lastToken) - min(firstToken))` 统计，记录 TTFT、并发重叠区间、429 限流次数与总墙钟耗时。

## [0.3.16] - 2026-11-24

本版完成独立复验第 50 号目录提出的用户可调分工对话上限与模型槽位改进（`M07-m`），并深度融合多智能体工程技能库与分工结构化任务清单工具。

### 新增与改进

**1. 默认允许 5 个分工对话，支持任意正整数上限与按需槽位模型配置（M07-m）**

- `src/policy.ts` 将新建配置或缺字段时的 `routing.maxSessions` 默认值调整为 `5`，移除 `maxSessions` 与 `sessionModels` 固定 `16` 的业务上限，保留正安全整数校验，同时原样兼容用户已显式保存的 `3`、`8` 等历史配置。
- `src/client/routing.tsx` 与 `src/client/locales.ts` 移除输入框与模型槽位数组的 `16` 截断限制，更新文案为“每个任务最多可开的独立分工对话（默认 5，可调整）”，大数值下支持按 32 项分批浏览并始终保证已配置项与第 `N` 个末位槽位可直接访问。
- `src/app/routing.ts` `reserveSessionSlot` 改为 `O(已用槽位数)` 扫描而不再构造长度为 `N` 的数组；`src/executor/dsh.ts` 任务提示改为表达默认继承与显式覆盖例外，避免大 `N` 下产生与 `N` 成正比的提示词开销。
- `src/app/divisions.ts` 在待拆分子项超过用户设定的 `maxSessions` 时严格遵守限额不突破，同时将其余子项持久保留在 `deferredDivisions` 中对主会话、管理面板与后续批次可见；缩小 `maxSessions` 后自动阻断超限槽位派发。

**2. 深度融合工程技能集与分工结构化步骤清单工具（`orchestrator_division_todo`）**

- `src/index.ts` 与 `src/app/skill-files.ts` 打通 `DSH_BUNDLED_SKILL_DIR` 内置技能目录自动发现，并新增 5 项高信号工程技能（`code-navigation`、`planning-loop`、`gui-browser`、`frontend-design`、`diagnostics`），连同既有技能共 14 项内置技能全量生效。
- 为独立分工会话新增持久化结构化清单工具 `orchestrator_division_todo`（支持增量合并与重启/接班保留），并强化分工执行与独立复查的反提示注入与双门禁（类型+测试）验证协议。

## [0.3.15] - 2026-11-24

本版针对独立复验第 49 号目录发现的三项计划修订生命周期问题（`M07-j`、`M07-k`、`M07-l`）完成全面修复与边界加固。

### 修复与深度加固

**1. 复查期间变更交付范围自动更新复查会话与消息标识（M07-j）**

- 在 `DivisionCoordinator.dispatch` 修订计划时，一旦交付范围或成果版本发生改变（如在待审期间新增或修改分工），自动停止旧复查会话并将其标记为已取代（`state: 'superseded_late'`）存入 `reviewHistory`。
- 待本次修订的全部分工完成后，`startReview` 与 `reconcilePlan` 基于最新 `deliverableVersion` 与递增 `reviewSeq` 创建全新的复查会话与消息标识（`div-review-start:${taskId}:${verTag}:r${round}`），确保旧复查会话无法批准新范围，而当前复查会话可正常审阅全部最新成果并通过，且重启后可幂等恢复。

**2. 已完成分工修改要求返工后更新正式成果并保留历史（M07-k）**

- 计划修订或复查退回导致已完成分工返工时，自动将旧版正式成果归档至 `resultHistory`、递增 `revision` 并清空旧 `result`。
- 分工完成新修订并调用 `reportDivision`（`state: 'completed'`）时，无论显式传入 `result` 还是仅填写完成摘要 `summary`，均将本次新成果写入 `div.result`，确保下游依赖分工与独立复查均读取到最新版成果，同时基于 `deliveredEventIds` 防止旧消息重放回退。

**3. 计划修订移除运行中分工时主动停止会话并防止失控（M07-l）**

- 计划修订计算出被移除的分工后，先调用 `stopDivisionSessions` 取消其正在运行的宿主会话（含历史接班代次）并等待进入 `idle`：确认停止后释放模型槽位并将记录移入 `removedDivisions`（`status: 'stopped'`），若宿主无法停止该运行中会话则拒绝移除并保留成员可见。
- 被停止/移除的分工会话其工具守卫立即阻断后续工具调用，且迟到的 `reportDivision` / `sendToDivision` 均被明确拒绝，绝不覆盖当前计划成果。

## [0.3.14] - 2026-11-24

本版针对独立复验第 48 号目录发现的四项长任务与多交付物自动拆分缺陷（`M07-g`、`M07-h`、`M07-i`、`M06-b`）进行了全面修复与边界加固。

### 修复与深度加固

**1. 复杂工单与普通聊天多交付物自动规划拆分（M07-g）**

- 新增 `planDivisionsFromText(title, brief, maxSessions)` 并接入 `DivisionCoordinator.dispatch` 与 `DshExecutor.launch`：当自动多会话开启且任务达复杂度阈值时，不再固定写死单一 `investigate` 对话，而是自动从需求文本提取独立并行交付物（支持显式“一人做 X / 分别做 Y”分句、编号/项目符号清单、“模块 A、模块 B、模块 C 分别开对话并行做”并列枚举，以及 API/后端、前端/UI、数据库/迁移、认证、安全审计、测试/验证、文档、部署等多领域轨道），按 `maxSessions` 上限自动分配模型槽位并开启多个独立可打开分工会话。

**2. 独立复查轮次、审查会话与交付版本强绑定（M07-h）**

- `startReview` 在启动每轮独立复查时，于同一事务内持久绑定当前轮次 `round`、审查会话 `sessionId` 以及所有分工成果的指纹 `deliverableVersion`，并保留跨轮次 `history`。
- `submitReview` 与 `orchestrator_division_review_submit` 强制核对调用者会话（含接班路由后继）、所属轮次、`state === 'pending'` 以及 `deliverableVersion`：上一轮旧复查会话迟到提交的结论仅记入 `review.history`（`state: 'superseded_late'`）并拒绝改写当前待审轮次状态；同一轮重复提交亦被拒绝。

**3. 计划修订按稳定分工 ID 无损合并（M07-i）**

- `DivisionCoordinator.dispatch` 对同一 `taskId` 提交新 `planKey` 时，不再整表覆盖重建，而是按稳定 `divisionId` 智能合并：未变更的分工完整保留其 `completed` / `running` 状态、`result`、会话 ID、接班代次、模型槽位与已投递事件回执；仅对新增分工分配空闲槽位并启动，对说明或依赖发生实质修改的分工复用原会话投递修订通知。

**4. 分工接班成功后恢复流程防重投首次派工（M06-b）**

- `reconcilePlan` 识别已发生 60% 阈值接班的分工代次（`generation > 1` 或 `previousSessions.length > 0`）：首次派工请求 `division-start:${taskId}:${divisionId}` 仅限初代会话；接班后的后继会话在执行 `divisions.resume()` 或进程重启恢复时，只核对并补齐缺失的接班激活步骤（`activate:division:${taskId}:${divisionId}:g${generation}`），绝不向接班会话重复投递原始派工单。

## [0.3.13] - 2026-11-23

本版针对独立复验中暴露的分工生命周期韧性、单子项委托、汇报通知回执事务、并发追问状态保持、多轮复查打回闭环、分工会话接班激活恢复以及 Windows 深层中文路径引导复制栈溢出（`0xC0000409`）进行了深度加固。

### 修复与深度加固

**1. 真实工单执行路径接入独立分工计划与单子项委托（M07-a / M07-e）**

- `DshExecutor` 在 `multiSession` 开启且评估为高难度工单（`hard`）时，自动调用 `DivisionCoordinator.dispatch` 落盘持久化 `TaskPlan` 并创建真实可打开的分工会话（`GET /divisions` 与 `divisions.list()` 可见）。
- 放宽 `DivisionCoordinator.dispatch` 对 `divisions.length === 1` 的拆分限制：当难度达标且显式传入 1 个独立委派子项时，允许开启 1 个独立分工会话处理并在原对话汇总；未传分工项时仍返回 `no-split-needed`（0 额外会话）。

**2. 分工启动失败恢复、汇报通知回执分离与并发状态保护（M07-b / M07-c / M07-d）**

- 新增 `reconcilePlan(taskId)` 与 `divisions.resume()`：同一 `(taskId, planKey)` 重放或宿主重启恢复时，自动核对每个依赖已就绪的分工，仅对 `failed`（无已交付汇报）或未成功持有 `division-start` 请求的分工按原会话 ID 与请求 ID 幂等补建，已运行或已完成成员不受影响。
- 将“分工汇报落库”与“主协调窗口通知送达”分离：在同一 `store.atomic` 事务内记录分工进度并排入持久化 `pendingDeliveries`，仅在 `sessions.prompt` 成功送达目标会话后才写入 `deliveredNotificationIds` 并移除待投递项；瞬时失败后无论是重复汇报同一 `event_id` 还是调用 `resume()` 均会按稳定 `requestId` 补发，杜绝丢通知与重复轰炸。
- 消除 `sendToDivision`、`launchDivision`、`reportDivision`、`startReview`、`submitReview`、`observeModelCall` 跨 `await` 写回旧快照的竞态：`sendToDivision` 在 `await sessions.prompt` 完成后于 `store.atomic` 内重新读取最新计划并仅合并 `deliveredEventIds`，不会覆盖并发发生的 `completed` 状态与成果。

**3. 独立复查多轮打回重做闭环与分工会话接班恢复（M07-f / M06-a）**

- `submitReview` 支持最多 3 轮（`MAX_REVIEW_ROUNDS = 3`）打回重做：当 `approved: false` 时，自动识别受影响分工（支持显式 `rework_division_ids` 或从 `summary`/`findings` 文本匹配分工 ID/标题），将其状态切回 `running`、记录 `reworkDivisionIds` / `findings` / `acceptanceCriteria` 并投递返工提示；待返工分工重新汇报 `completed` 后自动启动 `round + 1` 轮独立复查（`state: 'pending'`）；达到 3 轮上限时明确标记 `limitReached: true`。
- `SessionRelay.moveDivision` 在提交事务中为接班分工持久化 `pendingActivation: { target, generation }`，并通过 `activateDivision` 确保新分工会话创建并投递 `activate:division:${taskId}:${divisionId}:g${generation}` 唤醒提示，成功后才清除 `pendingActivation`；若中途崩溃或瞬时失败，`relay.resume()` 会自动补建并唤醒新代分工会话，且连续多次接班（`r1 -> r2 -> r3`）及旧窗口残余输入转发均直达最新代次。

**4. Windows 深层中文路径引导复制栈溢出修复**

- 修复 `scripts/windows-profile-bootstrap.mjs` 在含中文的多层深路径（如 `_work/_stage`）下调用 Node.js v22.19.0 原生 `fs.cpSync(..., { recursive: true })` 触发 Windows `0xC0000409`（`3221226505` `STATUS_STACK_BUFFER_OVERRUN`）退出的问题，改用纯 JS 递归 `copyDir`（`mkdirSync` + `readdirSync` + `copyFileSync`），在深层中文路径与临时目录下一律稳定退出 `0`。

## [0.3.12] - 2026-11-23

本版完成从 0.3.11 遗留缺陷修复、多会话独立分工、运行时版本识别到跨平台测试与快速安全打包发布链的全面补齐。

### 新增与改进

**1. 多会话规划与独立可打开分工会话（M07）**

- 新增 `DivisionCoordinator` 与 `orchestrator_dispatch` / `orchestrator_division_send` / `orchestrator_division_status` 工具及 `GET /divisions` 面板接口。
- `assessComplexity` 同时支持明确难度值、`divisions` 规划、“简短难题”与“冗长简单题”识别：简单任务严格保持 0 额外会话，复杂任务才拆分为独立的持久化 DSH 会话（可在宿主/面板直接点击 `<SessionButton>` 打开）。
- 严格遵循 `maxSessions` 与 `sessionModels` 槽位策略：已配置槽位使用对应模型与思考深度，留空槽位继承发起会话实时模型，超限明确拒绝；支持依赖 DAG 自动唤醒、上游交付注入、`event_id` 汇报去重、请求边界实际模型调用轨迹记录，以及独立复查会话入口。

**2. 继任主会话权责、子会话/分工 60% 接力与崩溃恢复（M03–M06）**

- 修复 `Runtime` 初始化时按值捕获旧 `masterId` 导致继任主会话缺少管理工具、`httpHost` 返回过期主会话等缺陷；新增 `pendingOrchestrators` 确保接班主会话立即获得完整工具组并可实际派工。
- 子会话与分工会话达 60% 阈值后自动迁移接力，保留父子关联、模型槽位与共享任务，不额外消耗槽位配额。
- 多代迁移 `A -> B -> C` 自动压缩直达最新路由，提交态 `pendingActivation` / `masterActivation` / `subagentRelay` 崩溃恢复不丢失、不重复激活；未认领共享任务随摘要迁移，任务板读取失败时明确拒绝切换而非静默放行。

**3. 运行时版本与 Profile 识别、设置保存与无损升级（M02 / M08）**

- 新增 `VersionTracker`，启动时固定 `loaded` 版本与当前 DSH `profileName` / `profileDir`，查询与自检实时读取磁盘 `installed` 版本，不一致时在 `GET /state` 与 `/self-inspect` 中触发 `reloadRequired` 提醒。
- 修复 Web 面板 HTTP 路由 `SettingsBlockSchema` 遗漏 `'routing'` 与 `'budget'` 导致设置页保存报 400 的问题。
- 所有 Bundled 启动脚本（`start.cmd` / `start.sh`）统一接入 `windows-profile-bootstrap.mjs` / `unix-profile-bootstrap.mjs`（支持 `--profile` 与 `DSH_PROFILE`），先校验插件版本、入口与依赖并无损升级、保留用户既有 `cordis.patch.yml` 与其他插件。

**4. 一键安装脚本、打包性能与安全预检（M01 / M02）**

- 仓库与 Pages 根路径的 `install.ps1`、`install.sh` 及文本副本全部同步为动态查询最新 GitHub Release 资产并带 `v0.3.12` 兜底链，`install.ps1` 同时支持 `DSH_HOME` 覆盖。
- 修复 Windows Bundled 包混入 `node/node_modules/npm/.npmrc` 的问题；重构 `_build/make-dist-zips.mjs` 为 `worker_threads` 多核并行压缩 + 4 MB 缓冲顺序写入。
- 为 `scripts/release_preflight.py` 建立经原文核查的第三方依赖精确白名单（`docs/release-preflight-allowlist.md`）并强制要求 Bundled 包内含启动引导脚本。

### 修复与跨平台测试

- 修复 `feishu-loops.ts` 中 stderr `[event] ready` 竞态覆盖 JSON 解析报错的问题。
- 补全 Windows `.cmd` shim（`environment.ts`）与大小写不敏感路径比较，修复 Windows 套件与 `environment.spec.ts` / `commands.spec.ts` / `class-docs.spec.ts` / `docs.spec.ts` / `model-surface.spec.ts` 测试。

### 已知限制

- 各消息源（QQ / 微信 / 飞书 / 邮箱 / GitHub）真实外部账号长连收发未在本机联网实测（受限于真实账号凭据），相关行为通过协议与模拟集成测试验证。
- Linux / macOS 内置包已校验 ZIP64 结构、Unix 权限位（`0755` / `0644`）、原生依赖与 Git Bash `start.sh` / 引导脚本逻辑，未在物理 Linux / macOS 桌面机器双机开机实测。

## [0.3.11] - 2026-11-22

本版修的是会话接力这一类问题：一个会话填满上下文之后，交接要么让两个会话同时干活，要么把人的话弄丢，要么根本没交接；另有一键安装默认地址 404 与启动器误判 profile 已就绪两项。

### 修复

**1. 目标会话在工单切换之前就开始运行**

旧实现把交接摘要作为排队消息投递给新会话，排队消息会立刻唤醒它。新会话先跑起来时工单仍指向旧会话，两个会话同时在做一个工单；取消只能让它停下，取消之前已经执行的动作撤不回来。

现在摘要在提交之前只写入新会话历史、不唤醒（notice 形态）。指针在一次事务里切换完成后，才投递唤醒消息，请求号带代次，崩溃恢复时同一代次只唤醒一次。

**2. 切换之后敲进旧窗口的话会留在旧会话**

旧实现只在提交那一刻扫一次旧会话的收件箱。窗口还开着，人过一会儿再敲一句，这句话要么启动旧会话的第二轮，要么直接消失。

现在提交时即写好旧会话到新会话的路由；宿主收件箱认领事件里拦截发往已被取代会话的用户消息，先停这一轮再按原消息号转投新会话，同号不重复投递。路由在启动时从已提交记录重建，重启不丢。

**3. 队友空闲但名下还有未完成共享任务时仍放行切换**

旧实现只看成员活跃状态。一个空闲队友名下挂着进行中的任务时被当作无事，那块任务板留在旧会话里没人读取。

现在成员检查之后继续读共享任务板：有主或进行中的未完成任务即阻断，并报出前三条。任务板读不出来按无法确认处理，不当成没有。

**4. 主会话永远原地压缩，子代理不参与归档**

「每个会话到阈值都开新会话」只覆盖了有工单的会话。主协调会话没有工单，所以永远原地压缩；子代理被排除在归档范围之外。

现在主会话达阈值也换新会话：摘要含当前未结束的工单板，指针切换后才唤醒，旧窗口的输入走同一条路由。子代理纳入归档测量；子代理不换会话，因为它的上下文就是父会话的答案，而父会话正在这一轮里。

**5. 一键安装的默认下载地址返回 404**

四个线上安装脚本的默认地址都以 `releases/latest/download/Super-Agent-Plugin.tgz` 结尾，而发行资产名带版本号（`Super-Agent-Plugin-v0.3.11.tgz`），该地址重定向到最新 tag 后返回 404。按文档执行默认命令会在第二步失败。

现在改为读 Release 资产清单、按名称匹配取 `browser_download_url`；清单不可达时回退到固定版本直链。下载后打印文件名与 sha256，并校验 gzip 魔数，避免把错误页正文当成包安装。

**6. 启动器把缺插件或旧插件的 profile 当成已安装**

旧实现只判断 profile 目录与 `package.json` 是否存在。缺插件的 profile 照样进入宿主、插件保持缺失；已装旧版本时照样启动旧版本。

现在按「插件版本等于本包版本、入口文件存在、patch 层存在、插件依赖齐全」判定可用。不满足时走升级或修复：新插件先落临时目录校验，用户 `package.json` 只做加法合并并备份，`cordis.patch.yml` 原样保留，只替换插件目录；任一步失败回滚到原状并报错。

### 已知限制

- 主会话接力的验证在 Runtime、SQLite 与模拟会话控制器上完成，未在真实 DSH 上跑满一轮上下文。
- Linux 与 macOS 包内容与权限已验证，未在真机解压启动。
- 各渠道真实账号收发仍未验收。
## [0.3.10] - 2026-11-20

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


## [0.3.9] - 2026-11-19

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



## [0.3.8] - 2026-11-18

本版修的是 0.3.7 跨会话接力的四个缺陷：接管动作在几个关键点上与承诺不符。

### 修复

- **新会话编号无法被识别** —— 编号取自跨行模板字符串，首尾各带换行，而工单靠前缀判断识别会话，匹配不上；即使去掉换行，编号中的代次后缀也会被整段当作工单 ID。现改为持久化的「会话 → 工单」映射，创建时写入、之后统一查询，不再解析会话名；编号加合法性校验，含空白或控制字符的名称拒绝创建。
- **转交内容不是摘要却声称摘要已附上** —— 旧实现只发一句固定文案，工单状态记为「已摘要」，但没有任何代码生成或附带摘要。现在摘要由旧会话的持久化事件与工单记录生成（交办原文、完成与剩余工作、工作目录、等待中的提问、最近若干轮对话），在新会话创建前落盘；读不到旧会话记录时拒绝交接并说明原因。
- **切换期间输入可竞争，团队安全阀未实现** —— 旧实现只检查一次未投递输入，「活跃 Team」只是注释。现在同一工单的切换按序执行，切换前依次核对未投递消息、旧会话运行状态、Team 成员绑定、直接输入未接手内容，任一成立即保持原会话并报告原因。
- **指针在新会话可用前就切换，崩溃无法恢复** —— 旧实现先切指针再建会话，读取方不看阶段直接采信，崩溃不进入回滚分支，启动无恢复。现在区分「已提交的当前会话」与「正在准备的迁移目标」，只采信前者；迁移分四阶段可重放并逐段落盘，指针在单事务内提交；启动时扫描未完成迁移并从中断处继续，投递用固定请求标识，重复恢复不会重复投递。

### 测试

- 新增 `tests/relay.spec.ts`：通过真实 Runtime、SQLite 与宿主会话控制器验证会话身份映射、摘要来源、拒绝条件、崩溃恢复后不重复投递、迁移目标在提交前不作为路由目标。
- 全量 1348 项 / 1312 通过 / 36 失败，失败均为 Windows 上 POSIX 权限位、shell 与 tmux 不可用所致，与基线一致。

### 已知限制

- 跨会话接力未在真实 DSH 中做端到端故障注入验收（切换期间并发输入、活跃 Team 实际绑定、强制重启后的恢复）。
- 各通道未做真实收发验收；macOS / Linux 未在真机启动验证。


## [0.3.7] - 2026-11-18

### 修复

- **上下文占满时真正交接给新会话** —— 此前该阈值只做压缩，在同一会话内继续。现在改为真正的跨会话移交：工单记录当前会话与迁移阶段，切换幂等可恢复；输入、停止、复查、资源、健康状态全部跟随迁移记录；迁移前检查未投递输入与活跃 Team，不满足则明确报告并回退压缩；失败回滚。
- **文档测试不再因备份文件失败** —— `.bak-*` 文件曾留在 `src/` 内，被模块表比对判为「文档未列出的模块」。备份已移出源码树。
- **发布预检与实际资产对齐** —— 预检脚本此前仍按旧的 12 个资产校验，而实际发行是 4 个系统包 + 1 个插件包。

### 已知限制

- 跨会话交接只有单元测试覆盖，未在真实 DSH 中做故障注入验证。
- 各通道未做真实收发验收；macOS / Linux 未在真机启动验证。


## [0.3.6] - 2026-11-17

### 修复

- **发行包与源码不一致** —— 此前构建产物与最后一轮源码改动存在时间差。本版改为源码冻结、记录哈希、构建、逐文件比对，8 个内置包内嵌插件全部与源码一致。
- **Agent Teams 服务取不到** —— `isolate` 作用域导致 `ctx.get('agentTeams')` 恒为 `undefined`，硬工单拆分与独立复查静默失效。改为优先从执行会话自身上下文取值，根上下文作兜底。
- **来源配置的检查不准确** —— 配置 QQ / 邮箱时误走 GitHub 校验路径。本版按来源类型分别检查；IMAP 与 SMTP 独立报告。

### 新增

- **macOS / Linux 内置包** —— 装配各平台预编译原生模块（sharp / libvips / koffi / sherpa-onnx / node-addon），四个平台零错平台。

### 变更

- **发行形态简化** —— 仅提供插件形态与四系统内置包。


## [0.3.0] - 2026-11-13

这一版主要修「说要做到、实际没做到」的那几处：多会话拆分、多代理互通、模型继承，以及一次外部评审挑出来的跨平台硬伤。

### 新增

- **真正的多会话拆分**：难度跨过门槛时，工单里会提示主执行会话「这活可以拆」，它会用宿主的 Agent Teams 自己开成员、发任务、收结果。之前那个「自动拆分」的开关只换了模型，没有拆出任何会话。
- **Agent Teams 完整接入**：具名成员是活着的（可以多轮对话），有共享任务板，成员之间能用 `send_message` 点对点通信，卡住的成员能被别人唤醒。这一层之前完全没挂进 preset。
- **新会话继承你当前用的模型**（`inheritOperatorModel`，默认开启）：你在面板里选了什么模型，新开的会话就用什么。之前只要路由里勾了任何一个模型，你的选择就被覆盖了。
- **新增提示词段落「团队协作」**：讲清成员之间怎么切分写作用域、怎么互相监督、完成后去接下一个任务。可在「设置 → 提示词」里改。

### 变更

- **删掉了自研的 helper 会话层**。它创建会话却从不给这些会话派任务，只是把名字告诉主执行会话——会话空转占着并发槽位，真正的并行来自 Agent Teams。现在只有一条路径。

### 修复

- **`prepare` 命令在 Windows 上必定失败**：之前写死 `sh -c`，而纯 Windows 环境没有 `sh`，命令根本没跑起来，报错还指向一个你没写过的程序。现在按平台选：Windows 有 POSIX shell 就用它（命令写法不变），没有则用 `cmd.exe /c`。
- **服务脚本在 Windows 上连帮助都打不开**：它顶层 `import fcntl`，Windows 没有这个模块，一 import 就 `ImportError`。文件锁改用平台自己的实现（`msvcrt.locking`），`os.umask` 也加了平台判断。
- **服务脚本在 Windows 上要求 tmux**：没有 tmux 就拒绝启动。现在 Windows 用独立进程组起服务（不随终端关闭而退出），macOS / Linux 仍用 tmux 会话。
- **提示词里用了被弃用的词**：`member` 在术语表里已由 `agent` 取代，段落标题也算。

## [0.2.0] - 2026-11-11

这一版把研究原型做成了一个能长期挂着跑的助手：多了三个能收消息的地方、能同时挂多个账号、能自己调节花钱和上下文，也补上了在 Windows 上真正能跑通的那部分。

### 新增

- **QQ 来源**：接上一个 OneBot 端点（SnowLuma、NapCat 之类）就能收 QQ 群和私聊消息；群里只有 @ 它的消息算发给它，私聊里的都算。
- **微信与企业微信来源**：走同一个 OneBot 桥接的另外两个入口，配置方式和 QQ 一样，各有一套自己的白名单。
- **邮箱来源**：用 IMAP 收信、SMTP 回信，收到一封邮件就能开工，回复直接回到原线程。
- **一个平台挂多个号**：同一个平台可以配两个账号（比如两个 QQ 号、一个 QQ 一个微信），各自独立的端点和独立的授权名单；面板上把每个账号的状态分开列，一个号出问题不会被另一个号的正常状态盖住。
- **调度设置**：可以决定一件活开一个会话还是按难度自动拆成几个、允许用哪些模型（精确到厂商和版本）、思考多深、在前台还是后台跑；没被你勾上的模型永远不会被选中。
- **难度预判与选模型**：评估顺手给一个 0–100 的难度估计，跨过你设的门槛才用最强的已授权模型，否则用最省的那个——门槛只决定用哪个模型，不决定接不接这活。
- **上下文自动归档**：一轮会话的上下文占到窗口多少百分比就归档，并把活交接给新的上下文继续；百分比你自己设，默认 65%，不再是宿主写死的固定值。
- **每日用量上限**：按本机自己看到的用量累加，到线就当天不再派新活，已经在跑的跑完——不会把一轮工作从中间掐断。这个数是本机的下限（别处用同一个 key 花掉的不算），且只记在进程内，重启从零开始。
- **长任务提醒**：一件活超过你设的分钟数还没结束，它会说一声在干什么，免得你忘了还有活挂着；不想被打断可以关掉。
- **插件管理工具**：它能在你的 profile 里列出、安装、移除 DSH 插件与 bundle，走的是宿主自己的插件管理器，失败会回滚。
- **自查与自我修正**：它现在能看见自己的状态——报告这套安装还缺什么（每个缺口直接写清补哪一步就补上，不是给一个「配置未完成」的分类）、最近收到了多少活、哪个来源卡住了；还能查出哪些工单的工作目录已经不存在并修好。加上前面那个插件管理工具，它才有了「发现自己缺什么 → 自己补上」的闭环。**范围说清楚**：这是自查与自修，不是模型自己改代码、改提示词或改自己的权限——那些仍然要你点头。
- **交付物不再只等于代码**：任务要的是查清楚的答案、装好的插件、写好的文档或本地修好的问题，现在都算完成，不必把不属于「提 PR」的活推回给你。

### 变更

- 名字统一为 **Super Agent**（面板标题、语言文件与文档一致）。
- 插件对外多导出 `qq-watch` 与 `mail-watch` 两个入口，构建产物里也就有了对应的入口文件。
- 新增的设置块（调度、上下文与预算）各自有独立版本号，改错一块不会连带别的块；这两块只影响用哪个模型、什么时候归档、花多少，不涉及授权，所以改动不需要重新审批。

### 修复

- **Windows 上 worker 的 `gh` 认不出身份**：改用隔离的 `GH_CONFIG_DIR` 绑定账号，不再依赖 Windows 根本不会执行的 POSIX 包装脚本；启动检查会顺手验证 worker 的 `gh` 报的确实是配置的那个账号。
- **Windows 上配了 `.cmd` / `.bat` 的 CLI 起不来**：这类批处理包装现在通过 `cmd.exe` 执行，其余可执行文件不受影响。
- **Windows 上找不到只写了名字的 CLI**：按 `PATHEXT` 逐个后缀去找，也不再要求 Windows 上不存在的执行位。
- **Windows 上绝对路径被判非法**：盘符路径（`X:/…`）现在和 `/…` 一样被接受。
- **同一个平台配了第二个账号时，健康状态互相覆盖**：现在按账号分别记录，面板上取最差的那个状态显示，不会因为另一个号正常就把坏的那个盖掉。

## [0.1.0] - 2026-10-31

上游研究原型基线：只监听一个 GitHub 仓库（可选再加飞书），按策略判断谁可以派活、把获授权的请求变成工单，每个工单跑在自己的 DSH 会话和自己的工作目录里，做完回到原来的对话回话，配一个网页面板看进度。

这一版是研究代码，用于参考，不是可以直接投产的软件。

[Unreleased]: https://github.com/xyt071024/dsh-superagent-cn/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/xyt071024/dsh-superagent-cn/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xyt071024/dsh-superagent-cn/releases/tag/v0.1.0
