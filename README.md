# Super Agent for DeepSeek Harness

> A proactive agent system that takes work from anywhere, decides whether it should act, splits hard tasks across multiple models, and improves itself over time.
>
> 一个能从任意入口接活、自主判断该不该干、把难题拆给多个模型协同、并且会自我迭代的常驻智能体系统。

[中文](#中文) | [English](#english) | [日本語](#日本語)

---

## 中文

### 这是什么

Super Agent 建立在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 之上，是一个**会主动找活干的智能体**。

普通的 AI 助手：你问一句，它答一句。

Super Agent：你不在的时候它也在工作。有人给它发邮件、在 GitHub 上 @ 它、在 QQ 上找它——它会自己判断「这活该不该接」、「接了我能做什么」，然后动手，做完回来告诉你。

### 三种能力叠加

| 能力 | 说明 |
|---|---|
| **多源接入** | GitHub、飞书、企业微信、邮箱、QQ、微信，统一入口 |
| **权限判定** | 谁能派活、该不该接、范围多大，全部可配 |
| **多模型协同** | 难题自动拆成多个子会话，不同模型并行，互相补位 |

### 两种形态

- **融合版** — 装进你现有的 DSH，侧边栏多一个入口，不影响其它插件
- **纯净版** — 全新白板 DSH，只装它，走官方更新路径

### 两种状态

- **对话态** — 界面可见，你说话才动，可随时打断
- **静默态** — 进程常驻，无消息时几乎不消耗算力，消息到达自动唤醒

两种状态**流程完全一致**，区别只在是否显示在界面上。

### 从哪里开始读

1. [项目定位与核心概念](docs/01-overview.md) — 它是什么、解决什么问题
2. [完整任务流程](docs/02-flow.md) — 一条消息从进来到出去的每一步
3. [多会话协同机制](docs/03-collaboration.md) — 难题怎么拆、怎么互救、怎么回测
4. [设置界面设计](docs/04-settings.md) — 八个分组，字段级说明
5. [连接源与稳定性](docs/05-sources.md) — 七个入口怎么接、怎么保证不掉线
6. [代理方案](docs/06-proxy.md) — 三层架构与切换策略
7. [自我进化机制](docs/07-evolution.md) — 它怎么优化自己
8. [省流与成本控制](docs/08-cost.md) — 高 API 用量下的应对
9. [部署与工程量](docs/09-deployment.md) — 怎么装、要多久

### 与 DeepSeek Harness 的关系

本项目是 DSH 的一个 bundle（插件包），不是独立软件。

- **核心流程完全复用 DSH**：Source → Trigger → Thread → Eval → Ticket → Executor
- **本项目的扩展**：多源接入、多模型协同、自我进化、稳定性加固

如果你还没装 DSH，请先看 [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)。

### 许可证

MIT

---

## English

### What this is

Super Agent is built on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is an **agent that actively looks for work**.

A normal AI assistant: you ask, it answers.

Super Agent: it works while you are away. Someone emails it, mentions it on GitHub, or messages it on QQ — it decides **whether this work should be taken**, **what it can do within that scope**, then does it and reports back.

### Three capabilities combined

| Capability | Description |
|---|---|
| **Multi-source intake** | GitHub, Feishu, WeCom, Email, QQ, WeChat — one unified entry |
| **Authorization** | Who may request work, whether to accept, how far it may go — all configurable |
| **Multi-model collaboration** | Hard tasks split into sub-sessions with different models, working in parallel and covering each other |

### Two forms

- **Integrated** — installed into your existing DSH, one extra sidebar entry, other plugins untouched
- **Standalone** — a fresh blank DSH with only this installed, following the official update path

### Two states

- **Interactive** — visible UI, acts only when you speak, interruptible
- **Silent** — process resident, near-zero compute when idle, wakes on incoming messages

Both states **follow exactly the same flow**; only the UI presence differs.

### Where to start reading

1. [Positioning and core concepts](docs/01-overview.md)
2. [Complete task flow](docs/02-flow.md)
3. [Multi-session collaboration](docs/03-collaboration.md)
4. [Settings UI design](docs/04-settings.md)
5. [Sources and stability](docs/05-sources.md)
6. [Proxy architecture](docs/06-proxy.md)
7. [Self-evolution](docs/07-evolution.md)
8. [Cost control](docs/08-cost.md)
9. [Deployment](docs/09-deployment.md)

### Relationship to DeepSeek Harness

This project is a **bundle** (plugin package) for DSH, not standalone software.

- **Core flow reuses DSH entirely**: Source → Trigger → Thread → Eval → Ticket → Executor
- **What this project extends**: multi-source intake, multi-model collaboration, self-evolution, stability hardening

### License

MIT

---

## 日本語

### これは何か

Super Agent は [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) の上に構築されています。**自ら仕事を探すエージェント**です。

通常の AI アシスタント：質問すれば答える。

Super Agent：あなたがいない間も働きます。メールが届いたり、GitHub でメンションされたり、QQ でメッセージが来たりすると、**その仕事を引き受けるべきか**、**どこまでできるか**を自分で判断し、実行して報告します。

### 3 つの能力の組み合わせ

| 能力 | 説明 |
|---|---|
| **マルチソース受信** | GitHub、Feishu、WeCom、メール、QQ、WeChat を統一エントリで |
| **権限判定** | 誰が依頼できるか、引き受けるべきか、範囲はどこまでか — すべて設定可能 |
| **マルチモデル協調** | 難しいタスクを複数のサブセッションに分割し、異なるモデルが並行して補完し合う |

### 2 つの形態

- **統合版** — 既存の DSH にインストール、サイドバーに項目が 1 つ増えるだけ
- **スタンドアロン版** — 空の DSH にこれだけをインストール、公式の更新経路に従う

### 2 つの状態

- **対話状態** — UI 表示、話しかけた時だけ動作、中断可能
- **サイレント状態** — プロセス常駐、アイドル時の計算コストはほぼゼロ、メッセージ受信で起動

どちらの状態も**フローは完全に同一**で、UI 表示の有無だけが異なります。

### 読み始める場所

1. [位置づけと中核概念](docs/01-overview.md)
2. [タスクフロー全体](docs/02-flow.md)
3. [マルチセッション協調](docs/03-collaboration.md)
4. [設定 UI 設計](docs/04-settings.md)
5. [ソースと安定性](docs/05-sources.md)
6. [プロキシ設計](docs/06-proxy.md)
7. [自己進化](docs/07-evolution.md)
8. [コスト管理](docs/08-cost.md)
9. [デプロイ](docs/09-deployment.md)

### DeepSeek Harness との関係

本プロジェクトは DSH の **bundle（プラグインパッケージ）** であり、独立したソフトウェアではありません。

- **コアフローは DSH をそのまま再利用**：Source → Trigger → Thread → Eval → Ticket → Executor
- **本プロジェクトが拡張する部分**：マルチソース受信、マルチモデル協調、自己進化、安定性強化

### ライセンス

MIT
