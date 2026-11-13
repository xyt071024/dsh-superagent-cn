<p align="center">
  <img src="assets/banner.svg" alt="Super Agent" width="820">
</p>

<h1 align="center">Super Agent</h1>

<p align="center">
  <strong>DeepSeek Harness 上で動く自律型エージェント —— 頼まれなくても働きます。</strong>
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a> | <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases"><img src="https://img.shields.io/badge/release-v0.3.0-2ea44f" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://xyt071024.github.io/dsh-superagent-cn/"><img src="https://img.shields.io/badge/docs-中文%20%7C%20EN%20%7C%20日本語-6f42c1" alt="docs"></a>
  <img src="https://img.shields.io/badge/Node-22.19%2B%20%7C%2024%2B-339933" alt="node">
  <img src="https://img.shields.io/badge/DSH-0.2.1--0.2.9-4b5563" alt="dsh">
</p>

---

**普通の AI アシスタント：あなたが聞けば、答えます。**

**Super Agent：あなたが不在の間も働きます。** メールが届いた、GitHub でメンションされた、QQ にメッセージが来た——
その仕事を引き受けるべきか、どこまでできるかを自分で判断し、実行して報告します。

> 複数の入口から仕事を受け取り → 引き受けるか判断し → 十分に大きければメンバーを開いて分担し → 完了を報告するエージェント。
> DeepSeek のオープンソース [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT）を基に、
> 三つのメッセージ入口、複数インスタンス、ルーティング、自己進化、コンテキストの自動引き継ぎ、汎用ツール群を追加しています。

---

## ✨ 概要

- 📥 **七つの入口を自動で監視** — GitHub / QQメール / QQ / WeChat / WeCom / Feishu / Gmail。一つだけでも動きます
- 🚦 **三段階の認可** — ゲート（純粋なコード、送信者が誰かだけを見る）/ 評価（引き受けるかをモデルが判断）/ マンデート（不変）
- 🧠 **仕事を本当に分割** — 実行セッション自身が名前付きメンバーを開き、書き込み範囲を分けて切り分け、結果をまとめます
- 🗂️ **コンテキストの自動引き継ぎ** — 設定した割合（既定 65%）に達するとアーカイブし、新しいコンテキストへ引き継いで続行
- 💰 **支出の上限** — 日次のトークン台帳。超過すると新しい仕事は受けず、実行中のものは完走させます
- 🔧 **汎用ツール群** — コード、文書、調査、シェル、そして**自分でプラグインを導入**。足りないものは入れます
- 📚 **六つの内蔵スキル** — shell / install / research / delegate / verify / docs
- 🔇 **既定では静か** — 人が判断すべきときだけ口を出します
- 🪶 **二つの形態** — zip からそのまま動くスタンドアロン版、または既存の DSH に一行で入るプラグイン版

---

## 🚀 クイックスタート

### 前提

- **Node.js 22.19+ または 24+**
- **DeepSeek Harness**（プラグイン版で必要。スタンドアロン版は自前の profile を持ち込みます）
- `gh auth login` 済みの GitHub CLI（GitHub ソースを使う場合）

### 方法 1 — プラグイン版（DSH 導入済み）

```bash
dsh plugin --profile superagent add https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.3.0/Super-Agent-Plugin-Stable-v0.3.0.tgz
```

DSH を再起動すると、サイドバーに **Superagent** が現れます。

### 方法 2 — スタンドアロン版（zip から実行）

[Releases](https://github.com/xyt071024/dsh-superagent-cn/releases) からお使いのシステム用の `Super-Agent-Bundled-<os>-<arch>-Stable-v0.3.0.zip`（Node と DSH 同梱、約 200 MB）をダウンロードして展開し、`start.cmd`（Windows）または `./start.sh`（macOS / Linux）を実行します。

初回実行で profile が `~/.dsh/profiles/superagent` に導入され、空いているポート（3082–3182）が選ばれます。**表示されたパネルのアドレスを読んでください** —— それがあなたのポートです。

### 次に

パネルを開く → サイドバーの **Superagent** → **設定** → **ソース** で一つ設定します。各プラットフォームには、認証情報の入手方法と入力方法を示すガイドがあります。

詳しい手順：**[インストールと接続](install.md)**。

---

## 📦 受け取れる入口

| プラットフォーム | プロトコル | 状態 |
|---|---|---|
| **GitHub** | `gh` CLI の通知 + ポーリング | ✅ **実測済み** |
| **QQ** | OneBot v11 HTTP | ✅ **実測済み** |
| **QQ メール** | IMAP ポーリング + SMTP | 実装済み・未検証 |
| **Gmail** | 同上 | 実装済み・未検証 |
| **WeChat** | OneBot v11（WeChat 側ブリッジ経由） | 実装済み・未検証 |
| **WeCom** | OneBot v11（WeCom 側ブリッジ経由） | 実装済み・未検証 |
| **Feishu** | CLI イベントストリーム + 履歴ポーリング | 実装済み・未検証 |

**「実測済み」と書かれた行だけが、この環境で実際に動作したものです。** 残りはコードは完全ですが一度も接続していません——根拠のない主張を結論として書きません。

---

## 🧩 機能

<details>
<summary><b>認可と安全性</b>（クリックで展開）</summary>

**二つの段階があり、固いのは一つ目だけです。**

| 段階 | 性質 | 内容 |
|---|---|---|
| ゲート | **純粋なコード** | 送信者が誰かだけを見て、本文は読みません。「以前の指示を無視せよ」と書かれても通りません |
| 評価 | モデルの判断 | ゲート通過後、引き受けるかどこまでやるかをモデルが判断します。**この段階はメッセージ内容の影響を受け得ます** |
| マンデート | 不変 | 受注時に発行。人が停止するか、再検証に失敗した場合のみ取り消せます |

固い保証は一段目だけです。「メッセージ内容では権限判定を一切変えられない」とは決して主張しません。

</details>

<details>
<summary><b>複数インスタンス：一つのインスタンスは一つの仕事だけ</b>（クリックで展開）</summary>

リポジトリが二つ、チームが二つ、アカウントが二つなら、インスタンスも二つです。

> **一つのインスタンス = 一つの profile = 一つのリポジトリ = 一つの bot。**

四つはそれぞれ固有でなければなりません：profile / ポート / stateDir / **bot の認証情報ディレクトリ**（共有すると二つのインスタンスが同じ身元で動きます）。

最も見落としやすい二点：**新しい profile にはモデルが設定されていません**（provider はその profile 自身のプラグインが登録します）、そして**初回起動で `status` が 3 で終了するのは正常です**（設定待ち。再起動を繰り返さないでください）。

手順の全体：[デプロイと二つ目のインスタンス](https://xyt071024.github.io/dsh-superagent-cn/docs/ja/09-deployment.html)。

</details>

<details>
<summary><b>二つの動作状態</b>（クリックで展開）</summary>

| 状態 | 内容 |
|---|---|
| **対話** | パネルが表示され、話しかけたときだけ動き、いつでも中断できます |
| **静穏** | バックグラウンドで常駐。待機中はほとんどコストがかからず、メッセージで目を覚まします |

処理の流れは同じで、違いは画面を出すかどうかだけです。

</details>

<details>
<summary><b>信頼できるか —— 正直な限界</b>（クリックで展開）</summary>

**できること**：コードの変更、PR の作成、文書作成、調査、コマンド実行、ファイル操作、Web 利用、そして**プラグインを自分で導入して拡張すること**。

**できないこと**：モデルの訓練（それはベンダーの仕事で、こちらは利用側です）、設計判断の代行。

**マルチエージェントの実際の限界**：`subagent`、`subagent_fork`、`workflow` はありますが、子エージェント同士に**情報共有も進捗共有もなく、詰まると救出ではなく停止され、単発かつ木構造**です。ピアセッションが相互に報告する仕組みは未実装です。

信頼性は**固いルール**（純粋なコードのゲート、不変のマンデート、構造化された報告）から来ており、エージェントが賢いからではありません。

</details>

---

## 🛠 技術スタック

| 層 | 技術 |
|---|---|
| 実行環境 | Node.js 22.19+ / 24+、DeepSeek Harness `0.2.1`–`0.2.9` |
| 言語 | TypeScript（strict、`tsc --noEmit` エラーゼロ） |
| ビルド | tsdown（rolldown + dts） |
| プラグイン基盤 | [Cordis](https://github.com/shigma/cordis) + `@deepseek-ai/dsh-*` のサービス注入 |
| 保存 | SQLite（WAL）— チケット / 判断記録 / カーソル / 経験 |
| テスト | Vitest（65 ファイル / 1258 ケース） |
| パネル | React + 独自 HTTP API（同一オリジンの `x-orchestrator-request` 検証） |
| コンテキスト | ホストの `ctx.compaction` を再利用。このプロジェクトが決めるのはしきい値と引き継ぎだけ |
| メッセージ入口 | OneBot v11（QQ/WeChat/WeCom 共通ファクトリ）、自作 IMAP + curl SMTP、`gh` CLI、`lark-cli` イベントストリーム |
| 配布 | GitHub Releases（六つのパッケージ）+ GitHub Pages（36 ページ、中英日） |

---

## 🗂 プロジェクト構成

```
src/
├── sources/            # github / qq（OneBot ファクトリ）/ mail（IMAP+SMTP）/ feishu
│   ├── registry.ts     # インスタンス。一つの kind に複数アカウント（qq-work）
│   ├── poll.ts         # ポーリングカーソルと失敗カウント
│   └── host.ts         # Source ホスト
├── app/                # ランタイム
│   ├── runtime.ts      # 組み立ての起点：起動停止、一時停止、長時間タスク通知
│   ├── sessions.ts     # WORK_TOOLS 許可リストと Session の装飾
│   ├── assessment.ts   # 評価：引き受けるか、難易度
│   ├── routing.ts      # 難易度別のモデル選択、分割、前面/背面
│   ├── archive.ts      # コンテキストの自動引き継ぎ（ホストの compaction を再利用）
│   ├── usage.ts        # 日次トークン台帳
│   ├── self-inspect.ts # 自己点検：何が足りないか、次に何をするか
│   ├── tools/          # メイン Session のツール（route / read / report / plugin …）
│   └── views/          # パネルのビューと HTTP
├── client/             # フロントエンド：設定、ルーティング、予算、ロケール
├── core/               # ドメイン：Ticket / Mandate / Assignment / Report
├── policy.ts           # 全設定スキーマ + Policy バージョン + ゲート
├── deployment.ts       # 設定解決とマシン抽象
└── setup.ts            # 環境の検査と問題の報告

prompts/                # worker.md(<=1000) / orchestrator.md(<=1400) / work.md / shared.md
skills/                 # 六つの内蔵スキル。実行時にスキルルートへ登録
├── dsh-superagent-shell/      # シェル、バックグラウンドジョブ、サンドボックス
├── dsh-superagent-install/    # プラグイン/CLI/ランタイムの導入と検証
├── dsh-superagent-research/   # ソースを読む。検証済みと推測を分ける
├── dsh-superagent-delegate/   # 子エージェントへの委任：指示書と、返ってきたものの検証
├── dsh-superagent-verify/     # 完了を証明する：型とテストは別の関門、基準線との差分
└── dsh-superagent-docs/       # コードと一致するドキュメント

docs/                   # 000 哲学 … 009 二つ目のインスタンス
scripts/dsh-superagent # 起動スクリプト（終了コード 0 正常 / 1 主サービス / 2 コンポーネント / 3 設定待ち）
tests/                  # 65 のテストファイル
```

---

## 📖 さらに読む

- **[ドキュメントサイト](https://xyt071024.github.io/dsh-superagent-cn/)** — 中 / 英 / 日。切り替えても同じ記事に留まります
- **[位置づけ](docs/ja/01-overview.md)** — 何であるか、認可の設計
- **[タスクの流れ](docs/ja/02-flow.md)** — メッセージが届いてから何が起きるか
- **[マルチセッション協調](docs/ja/03-collaboration.md)** — 難しいタスクの分割
- **[接続元](docs/ja/05-sources.md)** — 各プラットフォームの接続方法
- **[デプロイ](docs/ja/09-deployment.md)** — 構成、依存、二つ目のインスタンス
- **[変更履歴](CHANGELOG.md)** — 各バージョンの変更点
- **[上流との差分](UPSTREAM-DIFF.md)** — 何をなぜ変えたか
- **[セキュリティ](SECURITY.md)** — 境界がどこまでか

---

## ⚠️ 破甲（Purge）モード

破甲版は**ホスト本体を書き換えます**（DSH への 86 箇所のパッチ、一部の内蔵制限を迂回）。

- **何も保証しません**：出力は予測できず、DSH の更新で壊れる可能性があり、コンプライアンスは利用者の責任です
- **自分が所有し、結果を受け入れる環境でのみ使用してください**
- `dsh purge apply` を明示的に実行する必要があり、`dsh purge revert` で戻せます

詳細：**[破甲モード](purge.md)**。

---

## 📄 ライセンス

[MIT](LICENSE)。

中核アーキテクチャは DeepSeek のオープンソース **[dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)**
（作者 **DeepSeek Harness Team**、MIT、commit `8c32a9d` ベース）に由来します。

**六層アーキテクチャと三段階認可の設計はそのプロジェクト由来で、変更していません。** 本プロジェクトはマルチソース取り込み、
マルチセッション協調、自己進化、安定性の強化、三言語ドキュメントを追加しています。

完全なソース一覧、上流の貢献者名簿、第三者コンポーネントの謝辞：**[クレジットと参考元](credits.html)**。

---

## 🙏 謝辞

- **上流**：[DeepSeek Harness Team](https://github.com/deepseek-ai/deepseek-harness) — アーキテクチャとプラグイン基盤
- **プラグイン基盤**：[Cordis](https://github.com/shigma/cordis)（MIT）
- **メッセージブリッジ**：[OneBot v11](https://github.com/botuniverse/onebot-11) プロトコル、SnowLuma / NapCat などの実装
- **アイコン**：[Lucide](https://lucide.dev)（ISC）
- **README の構成**：[Playa-Cyrene/Cyrene-Agent](https://github.com/Playa-Cyrene/Cyrene-Agent) から学びました

あなたの成果を使っているのに名前が無い場合は、[issue を立ててください](https://github.com/xyt071024/dsh-superagent-cn/issues)。すぐ直します。
