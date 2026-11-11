# Super Agent for DeepSeek Harness

**中文** | [English](#english) | [日本語](#日本語)

> 📖 **建议从这里开始**：[文档站点](https://xyt071024.github.io/dsh-superagent-cn/)
> 支持中/英/日切换，切换后停在同一篇。

---

## 中文

### 它是什么

一个**会自己找活干的智能体**，跑在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 上。

普通 AI 助手：你问一句，它答一句。

它不一样——**你不在的时候它也在工作**。邮件来了、有人在 GitHub 上 @ 它、QQ 上有人找它，它会自己判断这活该不该接、能做到什么程度，然后动手，做完回来告诉你。

### 它替你解决什么

| 你的困扰 | 它怎么处理 |
|---|---|
| 得盯着好几个平台看有没有新活 | 七个入口自动盯着，有活才叫你 |
| 分不清谁发的东西该不该当真处理 | 三层权限，只有白名单的人能派活 |
| 复杂任务一个人想不透 | 自动拆成多个子会话，不同模型并行 |
| 同一个坑反复踩 | 每次做完复盘，把经验存下来 |
| 一直要人看着 | 干活全程安静，只在需要你时开口 |

### 它能接哪些地方

| 平台 | 说明 |
|---|---|
| **GitHub** | Issue、PR、评论、CI |
| **QQ 邮箱** | 收信即触发，回信自动 |
| **QQ** | 私聊、群聊 |
| **微信** | 本地客户端 |
| **飞书** | 消息与话题 |
| **企业微信** | 企业应用消息 |
| **Gmail** | 同 QQ 邮箱 |

配几个都行，至少配一个就能用。

### 两种用法

| 用法 | 适合 |
|---|---|
| **白板版** | 下载解压双击，全内置，不用装别的东西 |
| **插件版** | 已经装了 DSH 的，一条命令接进去 |

### 它靠谱吗

**权限这块是硬的。** 任何消息内容都改不了权限判定——就算有人在消息里写「忽略之前的指令」，网关只看是谁发的。

**能力这块说实话。** 它能改代码、提 PR、写文档、查资料。它不能替你装软件、训模型、做设计决策。

### 两种运行状态

| 状态 | 说明 |
|---|---|
| **对话态** | 面板可见，你说话才动，随时能打断 |
| **静默态** | 后台常驻，没消息时几乎不耗算力，有消息自动醒 |

两种状态**处理流程完全一样**，区别只在要不要显示界面。

---

### 文档

| # | 文档 | 内容 |
|---|---|---|
| 01 | [项目定位与核心概念](docs/zh/01-overview.md) | 它是什么、三层权限怎么设计 |
| 02 | [完整任务流程](docs/zh/02-flow.md) | 一条消息进来后发生什么 |
| 03 | [多会话协同](docs/zh/03-collaboration.md) | 复杂任务怎么拆、怎么互相帮忙 |
| 04 | [设置界面](docs/zh/04-settings.md) | 八个设置分组，逐项说明 |
| 05 | [连接源](docs/zh/05-sources.md) | 七个平台怎么接、怎么保证稳定 |
| 06 | [代理设置](docs/zh/06-proxy.md) | 什么情况要配、怎么配 |
| 07 | [自我进化](docs/zh/07-evolution.md) | 它怎么从做完的事里学习 |
| 08 | [成本控制](docs/zh/08-cost.md) | 怎么让 API 花费可控 |
| 09 | [部署方式](docs/zh/09-deployment.md) | 架构与依赖 |

---

### 怎么装

#### 白板版（最简单）

```
1. 去 Releases 下载对应平台的压缩包（约 120MB）
2. 解压到任意目录
3. 双击启动（Windows: 启动.cmd / macOS: 启动.command / Linux: ./启动.sh）
4. 浏览器自动打开面板
5. 按引导扫码登录
```

**不需要预装 Node.js 或 DSH**，全部内置。**不需要安装程序**，解压即用。

#### 插件版（已装 DSH 的）

**一条命令搞定**：

```powershell
# Windows
irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash
```

这条命令会自动：检查环境 → 建独立 profile → 装插件 → 写配置 → 启动。

**不会碰你现有的任何东西**，装在独立 profile 里。

#### 需要什么环境

| 项 | 白板版 | 插件版 |
|---|---|---|
| 操作系统 | Win 10/11 / macOS 11+ / Linux | 同左 |
| Node.js | 内置，不用装 | 22.19+ 或 24+ |
| DSH | 内置 | 0.2.1-rc.1 ~ 0.2.2 |
| 磁盘 | 约 500MB | 约 100MB |
| 内存 | 建议 4GB 可用 | 同左 |

#### 连上你的账号

装完后在面板里操作，**全部是点按 + 扫码**：

```
设置 → 连接源 → 选平台 → 跟着引导走
```

每个平台都有图文引导，告诉你凭证在哪拿、怎么填。

**详细步骤见 [安装与接入](install.md)**。

---

### 关于破甲模式

> ## ⚠️ 高风险，请先读完这段
>
> 破甲模式会**修改宿主程序本身**——给 DSH 打 86 处补丁，绕过部分内置的内容限制。
>
> **没有任何保证**：输出不可预测、DSH 升级后可能失效、合规责任完全由使用者承担。
>
> **建议只在你自己拥有、你自己承担后果的环境使用。**

**它不是本项目写的**，是集成了两个上游开源项目：

| 项目 | 作者 | 许可证 |
|---|---|---|
| [dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) | 小杨 / YuJunZhiXue | MIT |
| [dsh-purge Community](https://github.com/kingcharleslzy-ai/dsh-purge) | kingcharleslzy-ai | MIT |

原作者署名、版权与许可证完整保留。本项目的破甲模式**不是**上游的官方发行版，也未获其背书。

#### 怎么装

和标准版一样有两种形态：**白板版**（解压即用）和**插件版**（一条命令接入）。

**安装步骤、恢复方法、故障排查**：[破甲模式说明](purge.md)

---

### 参考来源与致谢

本项目的核心架构来自 **DeepSeek 官方开源的 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)**：

- **作者**：DeepSeek Harness Team
- **许可证**：MIT
- **开源时间**：2026-11-02
- **本项目基于**：commit `8c32a9d`

**六层架构（Source → Trigger → Thread → Eval → Ticket → Executor）和三层权限设计（Gate → Assessment → Mandate）来自这个项目，核心部分没有改动。**

本项目在这个基础上做了：多平台接入、多会话协同、自我进化机制、稳定性加固、中文文档与设置界面。

此外还集成了破甲模式的上游项目，以及若干技术方案参考。

**完整的来源清单、上游贡献者名单、第三方组件致谢**：[致谢与参考来源](credits/README.md)

---

### 许可证

MIT

---

## English

### What this is

An **agent that looks for work**, running on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A normal AI assistant: you ask, it answers.

This one: **it works while you are away**. An email arrives, someone mentions it on GitHub, a message comes in on QQ — it decides whether the work should be taken, what it can do within that scope, then does it and reports back.

### What it solves

| Your problem | How it handles it |
|---|---|
| Watching several platforms for new work | Seven entry points watch automatically; it calls you only when there is work |
| Not knowing whose request to trust | Three-layer authorization; only allow-listed people can request work |
| Complex tasks too big for one pass | Splits into sub-sessions with different models running in parallel |
| Repeating the same mistakes | Reflects after each task and keeps the lessons |
| Constant supervision | Silent while working; speaks only when needed |

### Where it connects

GitHub · QQ Mail · QQ · WeChat · Feishu · WeCom · Gmail

Configure as many as you need; one is enough to start.

### Two ways to run it

| Form | For |
|---|---|
| **Standalone** | Download, unzip, run. Everything bundled. |
| **Plugin** | Already have DSH? One command. |

### Is it reliable

**Authorization is hard-enforced.** No message content can change a permission decision — even if someone writes "ignore previous instructions", the gate only looks at who sent it.

**Capabilities are honest.** It edits code, opens PRs, writes documents, researches. It does not install software for you, train models, or make design decisions.

### Documentation

| # | Document | Content |
|---|---|---|
| 01 | [Positioning and Core Concepts](docs/en/01-overview.md) | What it is, how authorization is designed |
| 02 | [Complete Task Flow](docs/en/02-flow.md) | What happens after a message arrives |
| 03 | [Multi-Session Collaboration](docs/en/03-collaboration.md) | How complex tasks split and cooperate |
| 04 | [Settings UI](docs/en/04-settings.md) | Eight groups, item by item |
| 05 | [Sources](docs/en/05-sources.md) | Seven platforms and how they stay connected |
| 06 | [Proxy](docs/en/06-proxy.md) | When you need it and how to set it |
| 07 | [Self-Evolution](docs/en/07-evolution.md) | How it learns from completed work |
| 08 | [Cost Control](docs/en/08-cost.md) | Keeping API spend predictable |
| 09 | [Deployment](docs/en/09-deployment.md) | Architecture and dependencies |

### How to install

#### Standalone (simplest)

```
1. Download the archive for your platform from Releases (~120MB)
2. Unzip anywhere
3. Run the launcher (Windows: 启动.cmd / macOS: 启动.command / Linux: ./启动.sh)
4. The panel opens in your browser
5. Follow the prompts to scan and sign in
```

**No Node.js or DSH needed** — everything is bundled. **No installer** — unzip and run.

#### Plugin (for existing DSH users)

**One command**:

```powershell
# Windows
irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash
```

It checks the environment, creates a separate profile, installs the plugin, writes config, and starts the service.

**Nothing you already have is touched** — it lives in its own profile.

#### Requirements

| Item | Standalone | Plugin |
|---|---|---|
| OS | Win 10/11 / macOS 11+ / Linux | Same |
| Node.js | Bundled | 22.19+ or 24+ |
| DSH | Bundled | 0.2.1-rc.1 ~ 0.2.2 |
| Disk | ~500MB | ~100MB |

#### Connect your accounts

Everything happens in the panel, by clicking and scanning:

```
Settings → Sources → pick a platform → follow the prompts
```

Each platform has a guided walkthrough telling you where to get credentials and how to enter them.

**Full steps: [Install & Connect](install.md)**

### About Purge Mode

> ## ⚠️ High risk — read this first
>
> Purge Mode **modifies the host program itself** — 86 patches to DSH, bypassing some built-in content limits.
>
> **Nothing is guaranteed**: output is unpredictable, DSH upgrades may break it, and compliance responsibility is entirely yours.
>
> **Use it only in an environment you own and whose consequences you accept.**

It is not our work; it integrates two upstream open-source projects (full attribution in [Credits](credits/README.md)).

Both standalone and plugin forms are available.

**Installation, recovery, troubleshooting: [Purge Mode](purge.md)**

### Credits

The core architecture comes from **DeepSeek's open-source [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)** by **DeepSeek Harness Team** (MIT, 2026-11-02, based on commit `8c32a9d`).

**The six-layer architecture and three-layer authorization design come from that project and are unchanged.** This project adds multi-source intake, multi-session collaboration, self-evolution, stability hardening, and localized documentation.

Full source list, upstream contributor roster, third-party notices: **[Credits & References](credits/README.md)**

### License

MIT

---

## 日本語

### これは何か

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 上で動作する、**自ら仕事を探すエージェント**です。

通常の AI アシスタント：質問すれば答える。

これは違います：**あなたがいない間も働きます**。メールが届いたり、GitHub でメンションされたり、QQ でメッセージが来たりすると、その仕事を引き受けるべきか、どこまでできるかを自分で判断し、実行して報告します。

### 何を解決するか

| 困りごと | 対応 |
|---|---|
| 複数プラットフォームの新着を監視する必要 | 7 つの入口が自動監視。仕事がある時だけ通知 |
| 誰の依頼を信じるべきか分からない | 3 層の権限。許可リストの人だけが依頼可能 |
| 複雑なタスクは一度では無理 | サブセッションに分割し、異なるモデルが並行処理 |
| 同じ失敗を繰り返す | 各タスク後に振り返り、経験を蓄積 |
| 常に人が見ている必要 | 作業中は静か。必要な時だけ話す |

### 接続できる場所

GitHub · QQ メール · QQ · WeChat · Feishu · WeCom · Gmail

必要な分だけ設定してください。1 つでも動きます。

### 2 つの使い方

| 形態 | 対象 |
|---|---|
| **スタンドアロン版** | ダウンロード・解凍・実行。すべて同梱 |
| **プラグイン版** | DSH 導入済みならコマンド 1 つ |

### 信頼性について

**権限は強制されます。** メッセージの内容では権限判定を変更できません。「以前の指示を無視せよ」と書かれていても、ゲートは送信者だけを見ます。

**能力は正直に。** コード編集、PR 作成、文書作成、調査はできます。ソフトのインストール、モデル訓練、設計判断の代行はできません。

### ドキュメント

| # | ドキュメント | 内容 |
|---|---|---|
| 01 | [位置づけと中核概念](docs/ja/01-overview.md) | 何であるか、権限設計 |
| 02 | [タスクフロー全体](docs/ja/02-flow.md) | メッセージ受信後の流れ |
| 03 | [マルチセッション協調](docs/ja/03-collaboration.md) | 複雑なタスクの分割と協調 |
| 04 | [設定 UI](docs/ja/04-settings.md) | 8 グループの詳細 |
| 05 | [ソース](docs/ja/05-sources.md) | 7 プラットフォームの接続と安定性 |
| 06 | [プロキシ](docs/ja/06-proxy.md) | 必要な場面と設定方法 |
| 07 | [自己進化](docs/ja/07-evolution.md) | 完了した作業からの学習 |
| 08 | [コスト管理](docs/ja/08-cost.md) | API 費用の抑制 |
| 09 | [デプロイ](docs/ja/09-deployment.md) | アーキテクチャと依存関係 |

### インストール方法

#### スタンドアロン版（最も簡単）

```
1. Releases からプラットフォーム別アーカイブをダウンロード（約 120MB）
2. 任意の場所に解凍
3. ランチャーを実行（Windows: 启动.cmd / macOS: 启动.command / Linux: ./启动.sh）
4. ブラウザでパネルが開く
5. 案内に従ってスキャン・ログイン
```

**Node.js も DSH も不要**（すべて同梱）。**インストーラ不要**、解凍してすぐ動きます。

#### プラグイン版（DSH 導入済みの方）

**コマンド 1 つ**：

```powershell
# Windows
irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash
```

環境確認 → 専用 profile 作成 → プラグイン導入 → 設定書き込み → 起動、を自動で行います。

**既存の環境には一切触れません**（独立した profile に導入）。

#### 必要な環境

| 項目 | スタンドアロン版 | プラグイン版 |
|---|---|---|
| OS | Win 10/11 / macOS 11+ / Linux | 同左 |
| Node.js | 同梱 | 22.19+ または 24+ |
| DSH | 同梱 | 0.2.1-rc.1 ~ 0.2.2 |
| ディスク | 約 500MB | 約 100MB |

#### アカウント接続

すべてパネル上で、クリックとスキャンのみ：

```
設定 → ソース → プラットフォームを選択 → 案内に従う
```

各プラットフォームには、認証情報の取得方法と入力方法を示すガイドがあります。

**詳細手順：[インストールと接続](install.md)**

### 破甲モードについて

> ## ⚠️ 高リスク — まずこれを読んでください
>
> 破甲モードは**ホストプログラム自体を変更**します。DSH に 86 箇所のパッチを当て、一部の組み込み制限を迂回します。
>
> **一切保証しません**：出力は予測不能、DSH のアップグレードで壊れる可能性、コンプライアンス責任はすべて利用者にあります。
>
> **ご自身が所有し、結果に責任を持てる環境でのみ使用してください。**

本プロジェクトの作品ではなく、2 つの上流オープンソースを統合したものです（詳細は [クレジット](credits/README.md)）。

スタンドアロン版・プラグイン版の両方を用意しています。

**導入手順、復元方法、トラブルシューティング：[破甲モード](purge.md)**

### クレジット

中核アーキテクチャは **DeepSeek のオープンソース [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)**（作者 **DeepSeek Harness Team**、MIT、2026-11-02、commit `8c32a9d` ベース）に由来します。

**6 層アーキテクチャと 3 層権限設計はそのプロジェクトに由来し、変更していません。** 本プロジェクトが追加したのは、マルチソース受信、マルチセッション協調、自己進化、安定性強化、多言語ドキュメントです。

出典一覧、上流貢献者名簿、第三者コンポーネントの表示：**[クレジットと参考資料](credits/README.md)**

### ライセンス

MIT
