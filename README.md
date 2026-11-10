# Super Agent for DeepSeek Harness

**中文** | [English](#english) | [日本語](#日本語)

> 📖 **推荐用网页版阅读**：[打开文档站点](https://xyt071024.github.io/dsh-superagent-cn/)
> 网页版支持在任意页面切换语言，跟随你阅读的位置。

---

## 中文

### 这是什么

一个建立在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 之上的**会自己找活干的智能体**。

普通 AI 助手：你问一句，它答一句。

Super Agent：你不在的时候它也在工作。有人给它发邮件、在 GitHub 上 @ 它、在 QQ 上找它——它会自己判断「这活该不该接」、「接了我能做什么」，然后动手，做完回来告诉你。

### 核心能力

| 能力 | 说明 |
|---|---|
| **多源接入** | GitHub、飞书、企业微信、邮箱、QQ、微信，统一入口 |
| **三层权限** | 网关（代码）→ 评估（模型）→ 授权（凭证）。消息内容改不了权限 |
| **多会话协同** | 难题自动拆成多个子会话，不同模型并行，卡住互相救援 |
| **自我进化** | 复盘 → 记经验 → 优化自己 |

### 两种形态 · 两种状态

- **形态**：融合版（装进现有 DSH）/ 纯净版（白板 DSH，走官方更新）
- **状态**：对话态（可见）/ 静默态（后台，消息唤醒）

### 文档导航

| # | 文档 | 内容 |
|---|---|---|
| 01 | [项目定位与核心概念](docs/zh/01-overview.md) | 它是什么、三层权限、设计哲学 |
| 02 | [完整任务流程](docs/zh/02-flow.md) | 一条消息从进来到出去的每一步 |
| 03 | [多会话协同机制](docs/zh/03-collaboration.md) | 难题怎么拆、怎么互救、怎么回测 |
| 04 | [设置界面设计](docs/zh/04-settings.md) | 八个分组，字段级说明 |
| 05 | [连接源与稳定性](docs/zh/05-sources.md) | 七个入口怎么接、怎么保证不掉线 |
| 06 | [代理方案](docs/zh/06-proxy.md) | 三层架构与切换策略 |
| 07 | [自我进化机制](docs/zh/07-evolution.md) | 它怎么优化自己 |
| 08 | [省流与成本控制](docs/zh/08-cost.md) | 高 API 用量下的应对 |
| 09 | [部署与工程量](docs/zh/09-deployment.md) | 怎么装、要多久 |

### 与 DeepSeek Harness 的关系

本项目是 DSH 的一个 bundle（插件包），不是独立软件。

- **核心流程完全复用 DSH**：Source → Trigger → Thread → Eval → Ticket → Executor
- **本项目的扩展**：多源接入、多模型协同、自我进化、稳定性加固

### 许可证

MIT

---

## English

### What this is

An **agent that looks for work**, built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A normal AI assistant: you ask, it answers.

Super Agent: it works while you are away. Someone emails it, mentions it on GitHub, or messages it on QQ — it decides **whether this work should be taken**, **what it can do within that scope**, then does it and reports back.

### Core capabilities

| Capability | Description |
|---|---|
| **Multi-source intake** | GitHub, Feishu, WeCom, email, QQ, WeChat — one unified entry |
| **Three-layer authorization** | Gate (code) → Assessment (model) → Mandate (credential). Message content cannot change permissions |
| **Multi-session collaboration** | Hard tasks split into sub-sessions with different models, rescuing each other when stuck |
| **Self-evolution** | Reflect → record lessons → optimize itself |

### Two forms · Two states

- **Forms**: Integrated (into existing DSH) / Standalone (blank DSH, official update path)
- **States**: Interactive (visible) / Silent (background, wakes on message)

### Documentation

| # | Document | Content |
|---|---|---|
| 01 | [Positioning and Core Concepts](docs/en/01-overview.md) | What it is, three-layer authorization, design philosophy |
| 02 | [Complete Task Flow](docs/en/02-flow.md) | Every step from incoming message to reply |
| 03 | [Multi-Session Collaboration](docs/en/03-collaboration.md) | How tasks split, rescue, and verify |
| 04 | [Settings UI Design](docs/en/04-settings.md) | Eight groups, field by field |
| 05 | [Sources and Stability](docs/en/05-sources.md) | Seven entry points and how they stay connected |
| 06 | [Proxy Architecture](docs/en/06-proxy.md) | Three layers and switching strategy |
| 07 | [Self-Evolution](docs/en/07-evolution.md) | How it improves itself |
| 08 | [Cost Control](docs/en/08-cost.md) | Coping with high API usage |
| 09 | [Deployment](docs/en/09-deployment.md) | How to install, how long it takes |

### Relationship to DeepSeek Harness

This project is a **bundle** (plugin package) for DSH, not standalone software.

- **Core flow reuses DSH entirely**: Source → Trigger → Thread → Eval → Ticket → Executor
- **What this project extends**: multi-source intake, multi-model collaboration, self-evolution, stability hardening

### License

MIT

---

## 日本語

### これは何か

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) の上に構築された、**自ら仕事を探すエージェント**です。

通常の AI アシスタント：質問すれば答える。

Super Agent：あなたがいない間も働きます。メールが届いたり、GitHub でメンションされたり、QQ でメッセージが来たりすると、**その仕事を引き受けるべきか**、**どこまでできるか**を自分で判断し、実行して報告します。

### 中核能力

| 能力 | 説明 |
|---|---|
| **マルチソース受信** | GitHub、Feishu、WeCom、メール、QQ、WeChat を統一エントリで |
| **3 層の権限モデル** | ゲート（コード）→ 評価（モデル）→ 委任（資格情報）。メッセージ内容では権限を変更できません |
| **マルチセッション協調** | 難しいタスクを複数のサブセッションに分割し、異なるモデルが並行して補完し合います |
| **自己進化** | 振り返り → 経験を記録 → 自己最適化 |

### 2 つの形態 · 2 つの状態

- **形態**：統合版（既存 DSH に導入）/ スタンドアロン版（空の DSH、公式更新経路）
- **状態**：対話状態（表示）/ サイレント状態（バックグラウンド、メッセージで起動）

### ドキュメント

| # | ドキュメント | 内容 |
|---|---|---|
| 01 | [位置づけと中核概念](docs/ja/01-overview.md) | 何であるか、3 層権限、設計思想 |
| 02 | [タスクフロー全体](docs/ja/02-flow.md) | メッセージ受信から返信までの全ステップ |
| 03 | [マルチセッション協調](docs/ja/03-collaboration.md) | 分割・救済・検証の仕組み |
| 04 | [設定 UI 設計](docs/ja/04-settings.md) | 8 つのグループ、項目ごとの説明 |
| 05 | [ソースと安定性](docs/ja/05-sources.md) | 7 つの入口と接続維持の方法 |
| 06 | [プロキシ設計](docs/ja/06-proxy.md) | 3 層構成と切り替え戦略 |
| 07 | [自己進化](docs/ja/07-evolution.md) | どのように自己改善するか |
| 08 | [コスト管理](docs/ja/08-cost.md) | API 使用量が多い場合の対応 |
| 09 | [デプロイ](docs/ja/09-deployment.md) | 導入手順と所要期間 |

### DeepSeek Harness との関係

本プロジェクトは DSH の **bundle（プラグインパッケージ）** であり、独立したソフトウェアではありません。

- **コアフローは DSH をそのまま再利用**：Source → Trigger → Thread → Eval → Ticket → Executor
- **本プロジェクトが拡張する部分**：マルチソース受信、マルチモデル協調、自己進化、安定性強化

### ライセンス

MIT
