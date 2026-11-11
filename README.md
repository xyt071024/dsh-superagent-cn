# Super Agent for DeepSeek Harness

**中文** | [English](#english) | [日本語](#日本語)

> 📖 **推荐用网页版阅读**：[打开文档站点](https://xyt071024.github.io/dsh-superagent-cn/)
> 网页版可在任意页面切换语言，并跟随你当前阅读的位置。

---

## 中文

### 它是什么

一个建立在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 之上的**会自己找活干的智能体**。

普通的 AI 助手：你问一句，它答一句。

它不一样：**你不在的时候它也在工作**。有人给它发邮件、在 GitHub 上 @ 它、在 QQ 上找它——它会自己判断「这活该不该接」、「接了我能做什么」，然后动手，做完回来告诉你。

### 它解决什么问题

| 普通助手的问题 | 它怎么做 |
|---|---|
| 只能被动应答 | 七个入口盯着，有消息就醒来判断 |
| 只在聊天窗口 | 邮箱、GitHub、飞书、企微、QQ、微信都能接 |
| 谁说什么都听 | 三层权限：网关（代码）→ 评估（模型）→ 授权（凭证） |
| 一个难题同一个脑子想到底 | 拆成多个子会话，不同模型并行，互相补位 |
| 今天踩的坑明天还踩 | 复盘 → 记经验 → 优化自己 |
| 一直要你看 | 干活全程安静，只在必要时开口 |

### 三层权限：它最核心的设计

**任何消息内容都无法改变权限。**

```
消息进来
   ↓
第一层 网关（纯代码，不过模型）
   发件人在白名单吗？点名了吗？是机器人吗？
   ↓
第二层 评估（模型判断）
   针对本项目吗？有实现意图吗？方向定了吗？
   ↓
第三层 授权（不可变凭证）
   记下：依据哪个策略、范围多大、命中了哪条规则
```

就算有人在消息里写「忽略之前的指令」，网关根本不看内容——**只看谁发的**。

### 两种形态

| 形态 | 说明 |
|---|---|
| **插件版** | 装进你现有的 DSH，侧栏多一个入口，不动其它插件 |
| **白板版** | 自带 DSH 的完整压缩包，解压即用，完全隔离 |

### 两种状态

| 状态 | 说明 |
|---|---|
| **对话态** | 界面可见，你说话才动，可随时打断 |
| **静默态** | 进程常驻，无消息时几乎零算力，消息到达自动唤醒 |

两种状态**流程完全一致**，区别只在是否显示在界面上。

### 七个连接源

| 源 | 状态 |
|---|---|
| GitHub | 官方支持 |
| 飞书 | 官方支持 |
| 企业微信 | 官方 API |
| QQ邮箱 | 标准 IMAP/SMTP |
| Gmail | 标准 IMAP |
| QQ | 通过本地网关 |
| 微信 | 本地客户端（4 星上限，改版需跟） |

---

### 文档

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
| 09 | [部署与工程量](docs/zh/09-deployment.md) | 架构与依赖 |

---

### 怎么装

完整步骤见 **[安装与接入](install.md)**，这里给最短路径。

**插件版（推荐）**：

```bash
# 1. 建独立 profile，不影响现有环境
dsh superagent --from-default-profile web --dump-config > /dev/null

# 2. 装插件
dsh plugin --profile superagent add dsh-superagent

# 3. 启动
dsh --profile superagent
```

启动后终端会打印带 token 的地址，复制到浏览器打开。

**白板版**：下载对应平台的压缩包，解压，双击 `启动.cmd`（Windows）或 `./dsh --profile superagent`（macOS / Linux）。**不需要安装程序。**

支持平台：Windows 10/11（已实测）、macOS（Apple Silicon / Intel）、Linux x64。

---

### 关于破甲模式

> ## ⚠️ 高风险
>
> 破甲模式会**修改宿主程序本身的行为**，给 DSH 打 86 处补丁，绕过部分内置限制。
>
> **它不保证任何东西。** 输出不可预测、升级会失效、合规责任完全在你自己。
>
> 建议只在**你自己拥有、你自己承担后果**的环境使用。

**它不是本项目写的**，是集成了两个上游开源作品：

| 项目 | 作者 |
|---|---|
| [dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) | 小杨 / YuJunZhiXue |
| [dsh-purge Community](https://github.com/kingcharleslzy-ai/dsh-purge) | kingcharleslzy-ai |

完整威胁说明、两种形态安装步骤、恢复方法、故障排查，见 **[破甲模式](purge.md)**。

---

### 参考来源与致谢

本项目的核心架构来自 **DeepSeek 官方开源的 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)**（作者 **DeepSeek Harness Team**，MIT，2026-11-02，commit `8c32a9d`）。

**核心架构一行没改。** 本项目做的是：多源接入、多会话协同、自我进化、稳定性加固、中文文档与设置界面。

完整的来源清单、上游贡献者名单、第三方组件致谢，见 **[致谢与参考来源](credits/README.md)**。

---

### 许可证

MIT

---

## English

### What this is

An **agent that looks for work**, built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A normal AI assistant: you ask, it answers.

This one: **it works while you are away**. Someone emails it, mentions it on GitHub, or messages it on QQ — it decides **whether this work should be taken**, **what it can do within that scope**, then does it and reports back.

### Core capabilities

| Capability | Description |
|---|---|
| **Multi-source intake** | GitHub, Feishu, WeCom, email, QQ, WeChat — one unified entry |
| **Three-layer authorization** | Gate (code) → Assessment (model) → Mandate (credential). Message content cannot change permissions |
| **Multi-session collaboration** | Hard tasks split into sub-sessions with different models, covering each other |
| **Self-evolution** | Reflect → record lessons → optimize itself |
| **Low attention cost** | Silent while working; speaks only when someone must act |

### Two forms · Two states

- **Forms**: Integrated (into existing DSH) / Standalone (blank DSH, unzip and run)
- **States**: Interactive (visible) / Silent (background, wakes on message)

Both states follow exactly the same flow; only the UI presence differs.

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
| 09 | [Deployment](docs/en/09-deployment.md) | Architecture and dependencies |

### How to install

Full steps in **[Install & Connect](install.md)**. Short version:

**Plugin form (recommended)**:

```bash
dsh superagent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile superagent add dsh-superagent
dsh --profile superagent
```

**Standalone form**: download the archive for your platform, unzip, run the launcher. **No installer needed.**

Platforms: Windows 10/11 (tested), macOS (Apple Silicon / Intel), Linux x64.

### About Purge Mode

> ## ⚠️ High risk
>
> Purge Mode **modifies the host program itself** — 86 patches to DSH, bypassing some built-in limits.
>
> **Nothing is guaranteed.** Output is unpredictable, upgrades break it, and compliance responsibility is entirely yours.

It is not our work; it integrates two upstream open-source projects:

| Project | Author |
|---|---|
| [dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) | 小杨 / YuJunZhiXue |
| [dsh-purge Community](https://github.com/kingcharleslzy-ai/dsh-purge) | kingcharleslzy-ai |

Full threat notice, installation for both forms, recovery, and troubleshooting: **[Purge Mode](purge.md)**.

### Credits

The core architecture comes from **DeepSeek's open-source [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)** by **DeepSeek Harness Team** (MIT, 2026-11-02, commit `8c32a9d`).

**The core architecture is unchanged.** This project adds multi-source intake, multi-session collaboration, self-evolution, stability hardening, and Chinese documentation.

Full source list, upstream contributor roster, and third-party notices: **[Credits & References](credits/README.md)**.

### License

MIT

---

## 日本語

### これは何か

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) の上に構築された、**自ら仕事を探すエージェント**です。

通常の AI アシスタント：質問すれば答える。

これは違います：**あなたがいない間も働きます**。メールが届いたり、GitHub でメンションされたり、QQ でメッセージが来たりすると、**その仕事を引き受けるべきか**、**どこまでできるか**を自分で判断し、実行して報告します。

### 中核能力

| 能力 | 説明 |
|---|---|
| **マルチソース受信** | GitHub、Feishu、WeCom、メール、QQ、WeChat を統一エントリで |
| **3 層の権限モデル** | ゲート（コード）→ 評価（モデル）→ 委任（資格情報）。メッセージ内容では権限を変更できません |
| **マルチセッション協調** | 難しいタスクを複数のサブセッションに分割し、異なるモデルが補完し合います |
| **自己進化** | 振り返り → 経験を記録 → 自己最適化 |
| **低い注意力コスト** | 作業中は静か。人が動く必要がある時だけ話します |

### 2 つの形態 · 2 つの状態

- **形態**：統合版（既存 DSH に導入）/ スタンドアロン版（空の DSH、解凍して実行）
- **状態**：対話状態（表示）/ サイレント状態（バックグラウンド、メッセージで起動）

どちらの状態もフローは完全に同一で、UI 表示の有無だけが異なります。

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
| 09 | [デプロイ](docs/ja/09-deployment.md) | アーキテクチャと依存関係 |

### インストール方法

詳細は **[インストールと接続](install.md)**。最短手順：

**統合版（推奨）**：

```bash
dsh superagent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile superagent add dsh-superagent
dsh --profile superagent
```

**スタンドアロン版**：プラットフォーム別のアーカイブをダウンロードし、解凍してランチャーを実行。**インストーラは不要です。**

対応プラットフォーム：Windows 10/11（検証済み）、macOS（Apple Silicon / Intel）、Linux x64。

### 破甲モードについて

> ## ⚠️ 高リスク
>
> 破甲モードは**ホストプログラム自体を変更**します。DSH に 86 箇所のパッチを当て、一部の組み込み制限を迂回します。
>
> **一切保証しません。** 出力は予測不能、アップグレードで壊れ、コンプライアンス責任はすべて利用者にあります。

本プロジェクトの作品ではなく、2 つの上流オープンソースを統合したものです：

| プロジェクト | 作者 |
|---|---|
| [dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) | 小杨 / YuJunZhiXue |
| [dsh-purge Community](https://github.com/kingcharleslzy-ai/dsh-purge) | kingcharleslzy-ai |

脅威の詳細、両形態の導入手順、復元方法、トラブルシューティング：**[破甲モード](purge.md)**

### クレジット

中核アーキテクチャは **DeepSeek のオープンソース [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)**（作者 **DeepSeek Harness Team**、MIT、2026-11-02、commit `8c32a9d`）に由来します。

**中核アーキテクチャは変更していません。** 本プロジェクトが追加したのは、マルチソース受信、マルチセッション協調、自己進化、安定性強化、中国語ドキュメントです。

出典一覧、上流貢献者名簿、第三者コンポーネントの表示：**[クレジットと参考資料](credits/README.md)**

### ライセンス

MIT
