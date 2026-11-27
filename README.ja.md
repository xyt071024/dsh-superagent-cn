<p align="center">
  <img src="assets/hero-cover.jpg" alt="Super Agent — DeepSeek Harness 向け自律型マルチセッション・エージェント" width="920">
</p>

<h1 align="center">Super Agent</h1>

<p align="center">
  <strong>DeepSeek Harness (DSH) 上で稼働する常時自律型マルチセッション開発エージェント</strong><br>
  <sub>マルチチャネル受信 · 3層コード権限ゲート · 自律タスク分割＆スロット別モデル編成 · 60% 無損失コンテキストリレー · 独立レビュー</sub>
</p>

<p align="center">
  <a href="README.md">简体中文</a> &nbsp;·&nbsp;
  <a href="README.en.md">English</a> &nbsp;·&nbsp;
  <a href="README.ja.md"><strong>日本語</strong></a> &nbsp;·&nbsp;
  <a href="https://xyt071024.github.io/dsh-superagent-cn/ja/index.html">ドキュメント</a> &nbsp;·&nbsp;
  <a href="https://xyt071024.github.io/dsh-superagent-cn/ja/install.html">導入ガイド</a>
</p>

<p align="center">
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases"><img src="https://img.shields.io/badge/Release-v0.3.18-10b981?style=flat-square" alt="Release v0.3.18"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-38bdf8?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-22.19%2B%20%7C%2024%2B-339933?style=flat-square" alt="Node.js">
  <img src="https://img.shields.io/badge/DSH-0.2.1%2B-6366f1?style=flat-square" alt="DeepSeek Harness">
  <img src="https://img.shields.io/badge/Tests-1370%20Passed%20%7C%200%20Failed-2ea44f?style=flat-square" alt="Tests">
</p>

---

## Super Agent とは？

従来の対話型 AI は「1 問 1 答・単一ウィンドウ」の受動的な仕組みであり、大規模な改修や複数チャネルからの依頼、長時間タスクではコンテキスト溢れや自己承認による品質低下が避けられませんでした。

**Super Agent (`dsh-superagent`)** は DeepSeek Harness を自律型エンジニアリング協調基盤へと拡張します：

- **マルチチャネル自律受付**：**GitHub、Feishu（飛書）、個人 QQ、公式 QQBot、WeChat、WeCom、IMAP/SMTP メール（Gmail 対応）**、および DSH ローカル画面を一元監視。コード強制の権限ゲートと意味評価を通過した依頼のみを永続的な **チケット（Ticket）** として起票します。
- **簡単な作業は即時処理、複雑な課題は複数セッションへ自律分割**：軽微な修正は追加セッション `0` で高速完了。複雑なタスクは DSH サイドバーから個別に開いて対話できる **独立分担セッション（Division Sessions）** を自動生成します。タスクあたりの既定上限は **5**（固定 16 上限を撤廃し、`1`、`5`、`8`、`17`、`32` など任意の正整数に調整可能）。各スロットに個別モデルを指定するか、空欄で開始時モデルを継承できます。
- **60% 閾値の無損失コンテキストリレー**：メイン協調・ワーカー・サブエージェント・分担セッションのすべてで、コンテキスト使用率が既定 **60%** に達すると意図・制約・最新進捗・未割当タスクを抽出し、新世代セッション（`r1 → r2 → r3`）へ原子的に引き継ぎます。
- **読み取り専用の独立レビュー閉鎖ループ**：全分担完了後、成果物フィンガープリントに紐づく独立レビューセッションが実ファイルとテスト結果を検証し、不備があれば最大 **3 ラウンド** まで差し戻し修正を行います。

---

## アーキテクチャ全体像

<p align="center">
  <img src="assets/architecture-flow.svg" alt="Super Agent アーキテクチャ図" width="960">
</p>

### 1. マルチセッション自律協調＆スロット別モデル選択

<p align="center">
  <img src="assets/multi-session-collab.jpg" alt="マルチセッション並列協調と独立レビュー" width="880">
</p>

### 2. 60% コンテキストリレー＆SQLite 永続化

<p align="center">
  <img src="assets/context-relay-engine.jpg" alt="60% コンテキストリレーエンジン" width="880">
</p>

### 3. 内蔵 14 スキル＆構造化チェックリスト（`orchestrator_division_todo`）

`DSH_BUNDLED_SKILL_DIR` により `code-navigation`、`planning-loop`、`gui-browser`、`frontend-design`、`diagnostics`、`delegate`、`verify`、`research`、`shell`、`install`、`mirror`、`docs`、`github`、`feishu` の計 **14 スキル** をオンデマンドで読み込み、各分担セッションには再起動や引き継ぎ後も保持される `orchestrator_division_todo` ツールを提供します。

---

## インストールとアップグレード

### 方法 1：ワンライナー導入スクリプト

**Windows (PowerShell):**
```powershell
irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex
```

**macOS / Linux (Bash):**
```bash
curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash
```

### 方法 2：Node.js・DSH 同梱バンドル版（[GitHub Releases](https://github.com/xyt071024/dsh-superagent-cn/releases/latest)）

| 対象環境 | ファイル名 | 起動方法 |
|---|---|---|
| **Windows x64** | `Super-Agent-Bundled-Windows-x64-v0.3.18.zip` | 解凍して `start.cmd` を実行 |
| **macOS Apple Silicon (arm64)** | `Super-Agent-Bundled-macOS-arm64-v0.3.18.zip` | 解凍して `./start.sh` を実行 |
| **macOS Intel (x64)** | `Super-Agent-Bundled-macOS-x64-v0.3.18.zip` | 解凍して `./start.sh` を実行 |
| **Linux x64** | `Super-Agent-Bundled-Linux-x64-v0.3.18.zip` | 解凍して `./start.sh` を実行 |
| **既存 DSH 用プラグイン単体** | `Super-Agent-Plugin-v0.3.18.tgz` | `dsh plugin add ./Super-Agent-Plugin-v0.3.18.tgz` |

---

## 検証ステータス

- **型検査・ビルド**：`tsc --noEmit` エラー 0、`lib/` 全モジュール完全一致
- **自動テストスイート**：Windows 77 ファイル（**1,370 件合格 / 0 件失敗 / 15 件スキップ**）、Linux＆Windows CI 全 4 ジョブ合格、独立検収スイート（第 41〜50 号）**37 / 37 件合格**
- **分離インストール＆プリフライト検査**：Windows 実パッケージ起動 HTTP 200（`0.3.18`）、`release_preflight.py` 5 成果物スキャン **0 件検出**
- **未検証範囲**：macOS / Linux 実機デスクトップでの GUI 通し確認、および外部本番アカウントを用いた実送受信は別途実機検証対象です。

---

## 謝辞・ライセンス

- **上流プロジェクト**：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT）および [DeepSeek Harness](https://github.com/deepseek-ai)
- **設計研究参考**：[elder-plinius/CL4R1T4S](https://github.com/elder-plinius/CL4R1T4S)（GPLv3 公開コーパスを外部設計研究の参考として参照。本リポジトリのすべてのコード・スキル・プロンプトは独自に執筆された MIT 実装です）
- 本プロジェクトは非公式のコミュニティ配布版であり、[MIT License](LICENSE) の下で公開されています。
