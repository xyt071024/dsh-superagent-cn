# 致谢与参考来源 / Credits & References

[中文](#中文) | [English](#english) | [日本語](#日本語)

---

本项目不是原创作品。它站在很多人的肩膀上，其中很多人的名字我们甚至不知道。

**开源最基本原则：用了谁的东西，就要写上谁的名字。** 下面尽可能列全。

---

## 中文

### 一、核心源头（必须署名）

#### 1. dsh-superagent-prototype — 本项目的直接源头

本项目由 DeepSeek 官方开源的 **dsh-superagent-prototype** 延伸而来。

| 项 | 内容 |
|---|---|
| 仓库 | https://github.com/deepseek-ai/dsh-superagent-prototype |
| 作者 | **DeepSeek Harness Team** |
| 开源时间 | 2026-11-02 |
| 许可证 | MIT |
| 提交哈希 | `8c32a9d`（本项目基于此版本） |

**它提供了什么**：整个「主动型 Agent」的核心架构——Source / Trigger / Thread / Eval / Ticket / Executor 六层模型，三层权限设计（Gate / Assessment / Mandate），以及 DSH bundle 的完整实现。

**本项目加了什么**：多源接入（邮箱、企微、微信等）、多会话协同、自我进化、稳定性加固、中文文档与设置界面。**核心架构一行没改。**

> ⚠️ 官方 README 明确声明这是 **research prototype，不是官方产品**。本项目同样不是官方发行版。

#### 2. DeepSeek Harness — 运行底座

| 项 | 内容 |
|---|---|
| 仓库 | https://github.com/deepseek-ai/deepseek-harness |
| 作者 | **DeepSeek** |
| 许可证 | MIT |

整个系统跑在 DSH 之上。没有它，这个项目不存在。

---

### 二、破甲模式（Purge Mode）的来源

破甲模式不是我们写的，是把现成的开源作品集成进来。

#### 1. dsh-purge（原始项目）

| 项 | 内容 |
|---|---|
| 作者 | **小杨 / YuJunZhiXue** |
| 仓库 | https://github.com/YuJunZhiXue/dsh-purge |
| 许可证 | MIT |

#### 2. dsh-purge Community（社区维护版）

| 项 | 内容 |
|---|---|
| 维护者 | **kingcharleslzy-ai** |
| 仓库 | https://github.com/kingcharleslzy-ai/dsh-purge |
| 当前版本 | 1.6.84 |
| 许可证 | MIT |

**说明**：本项目集成的破甲模式基于社区版。原作者署名、版权声明与 MIT 许可证完整保留。本项目的破甲模式**不是**上游作者的官方发行版，也未获其背书。

#### 3. 破甲模式的贡献者名单

以下是上游 `dsh-purge Community` 的贡献者。他们修复的每一个 bug、提交的每一份复现，都间接让本项目受益。

| 贡献者 | 贡献 |
|---|---|
| [小杨 / YuJunZhiXue](https://github.com/YuJunZhiXue) | 原始 dsh-purge 项目作者；保留原 Git 历史、MIT 许可证和署名 |
| [kingcharleslzy-ai](https://github.com/kingcharleslzy-ai) | Community 分支维护、发行与集成 |
| [luowang-ui](https://github.com/luowang-ui) | [PR #1](https://github.com/kingcharleslzy-ai/dsh-purge/pull/1)：修复桌面 CLI 修复流程误用异步复制 |
| [heigit](https://github.com/heigit) | [issue #3](https://github.com/kingcharleslzy-ai/dsh-purge/issues/3)：Web/Headless 备份与更新问题的复现与源码分析 |
| [OGHong](https://github.com/OGHong) | [issue #5](https://github.com/kingcharleslzy-ai/dsh-purge/issues/5)：定位 Electron ASAR 文件系统导致的自检误判 |
| [Wangxiaolu0716](https://github.com/Wangxiaolu0716) | [PR #11](https://github.com/kingcharleslzy-ai/dsh-purge/pull/11)：Windows 归档换包失败后的等待恢复 |
| [wtfsb19](https://github.com/wtfsb19) | [issue #10](https://github.com/kingcharleslzy-ai/dsh-purge/issues/10)：Windows 生命周期故障分析 |
| [MingShi350](https://github.com/MingShi350) | [issue #9](https://github.com/kingcharleslzy-ai/dsh-purge/issues/9)：现代设置接口与 legacy shim 冲突定位 |
| [loLollipop / Lollipopdamn](https://github.com/loLollipop) | [PR #27](https://github.com/kingcharleslzy-ai/dsh-purge/pull/27)：诊断误报、版本比较、状态戳与回滚路径修复 |
| [youki258 / youki](https://github.com/youki258) | [PR #33](https://github.com/kingcharleslzy-ai/dsh-purge/pull/33)：npm 嵌套宿主自检误报的目录归一化方案 |
| [SimonQvQ / Simon](https://github.com/SimonQvQ) | [PR #42](https://github.com/kingcharleslzy-ai/dsh-purge/pull/42)：Linux CLI/Web 安装与用户宿主副本支持 |
| [alexopenfan-xiaxin / alex.xin](https://github.com/alexopenfan-xiaxin) | [#44](https://github.com/kingcharleslzy-ai/dsh-purge/issues/44) 慢网更新实测；[PR #45](https://github.com/kingcharleslzy-ai/dsh-purge/pull/45) / [#46](https://github.com/kingcharleslzy-ai/dsh-purge/pull/46) / [#47](https://github.com/kingcharleslzy-ai/dsh-purge/pull/47) |
| [Minervaowl7](https://github.com/Minervaowl7) | [PR #88](https://github.com/kingcharleslzy-ai/dsh-purge/pull/88)：缺文件异常与遗留维护锁修复 |
| [ShiTan-677](https://github.com/ShiTan-677) | PR #88 讨论中的 macOS 独立复核与版本定位 |
| [Minggle](https://github.com/Minggle) | [PR #99](https://github.com/kingcharleslzy-ai/dsh-purge/pull/99)：更新代理、GitHub token 配置与界面 |
| [Steooenwolf-666](https://github.com/Steooenwolf-666) / [hans](https://github.com/a320583781-create) | [PR #103](https://github.com/kingcharleslzy-ai/dsh-purge/pull/103)：恢复原生技能目录发现 |
| [longyanbo1224-debug](https://github.com/longyanbo1224-debug) | [PR #131](https://github.com/kingcharleslzy-ai/dsh-purge/pull/131)：归档独立包配置警示与文档守卫 |

---

### 三、技术方案参考

| 来源 | 用途 |
|---|---|
| [IMAP IDLE 规范 (RFC 2177)](https://datatracker.ietf.org/doc/html/rfc2177) | 邮箱实时推送的设计依据 |
| [Playwright](https://github.com/microsoft/playwright) | 浏览器自动化（Edge 授权向导） |
| [Agent Teams (DSH)](https://github.com/deepseek-ai/deepseek-harness) | 多会话协同的底层机制 |
| [Model Context Protocol](https://github.com/modelcontextprotocol) | 工具接入协议参考 |

---

### 四、还可能有遗漏

**如果你发现我们用了你的东西却没写你的名字，请提 issue，我们立刻补上。**

尤其是：
- 早期 DSH 生态里那些没留名的小工具
- 在 issue / 讨论区回答过问题的人
- 写中文教程、翻译文档的人

---

## English

### Core origins (attribution required)

**dsh-superagent-prototype** — the direct origin of this project.
- Repository: https://github.com/deepseek-ai/dsh-superagent-prototype
- Author: **DeepSeek Harness Team**
- Released: 2026-11-02
- License: MIT
- Commit: `8c32a9d`

It provides the entire core architecture: the six-layer Source / Trigger / Thread / Eval / Ticket / Executor model, three-layer authorization (Gate / Assessment / Mandate), and the complete DSH bundle implementation.

This project adds: multi-source intake (email, WeCom, WeChat, etc.), multi-session collaboration, self-evolution, stability hardening, and Chinese documentation with a settings UI. **The core architecture is unchanged.**

> The official README states this is a **research prototype, not an official product**. This project is likewise not an official release.

**DeepSeek Harness** — the runtime foundation.
- Repository: https://github.com/deepseek-ai/deepseek-harness
- Author: **DeepSeek**
- License: MIT

### Purge Mode origins

Purge Mode is not our work; it integrates existing open-source projects.

**dsh-purge** (original) — author **小杨 / YuJunZhiXue**, https://github.com/YuJunZhiXue/dsh-purge, MIT.

**dsh-purge Community** (community-maintained) — maintainer **kingcharleslzy-ai**, https://github.com/kingcharleslzy-ai/dsh-purge, v1.6.84, MIT.

Original authorship, copyright, and the MIT license are fully preserved. This project's Purge Mode is **not** an official release by the upstream authors and is not endorsed by them.

Upstream contributors are listed in full in the Chinese section above (`dsh-purge Community` contributor table).

### Technical references

| Source | Purpose |
|---|---|
| [IMAP IDLE (RFC 2177)](https://datatracker.ietf.org/doc/html/rfc2177) | Real-time mail push design |
| [Playwright](https://github.com/microsoft/playwright) | Browser automation for the Edge authorization wizard |
| [Agent Teams (DSH)](https://github.com/deepseek-ai/deepseek-harness) | Underlying multi-session mechanism |
| [Model Context Protocol](https://github.com/modelcontextprotocol) | Tool integration protocol reference |

### If we missed you

**If we used your work without crediting you, open an issue and we will add it immediately.**

---

## 日本語

### 中核となる出自（帰属表示が必要）

**dsh-superagent-prototype** — 本プロジェクトの直接の出自。
- リポジトリ：https://github.com/deepseek-ai/dsh-superagent-prototype
- 作者：**DeepSeek Harness Team**
- 公開：2026-11-02
- ライセンス：MIT
- コミット：`8c32a9d`

Source / Trigger / Thread / Eval / Ticket / Executor の 6 層モデル、3 層権限設計（Gate / Assessment / Mandate）、DSH bundle の完全な実装を提供しています。

本プロジェクトが追加したもの：マルチソース受信（メール、WeCom、WeChat など）、マルチセッション協調、自己進化、安定性強化、中国語ドキュメントと設定 UI。**中核アーキテクチャは変更していません。**

> 公式 README は **研究用プロトタイプであり、公式製品ではない** と明記しています。本プロジェクトも同様に公式リリースではありません。

**DeepSeek Harness** — 実行基盤。
- リポジトリ：https://github.com/deepseek-ai/deepseek-harness
- 作者：**DeepSeek**
- ライセンス：MIT

### 破甲モード（Purge Mode）の出自

破甲モードは私たちの作品ではなく、既存のオープンソース作品を統合したものです。

**dsh-purge**（オリジナル） — 作者 **小杨 / YuJunZhiXue**、https://github.com/YuJunZhiXue/dsh-purge、MIT

**dsh-purge Community**（コミュニティ維持版） — 維持者 **kingcharleslzy-ai**、https://github.com/kingcharleslzy-ai/dsh-purge、v1.6.84、MIT

原作者の署名、著作権、MIT ライセンスは完全に保持しています。本プロジェクトの破甲モードは上流作者の公式リリースでは**ありません**。上流の貢献者一覧は上記中国語セクションに全文掲載しています。

### 技術参考

| 出典 | 用途 |
|---|---|
| [IMAP IDLE (RFC 2177)](https://datatracker.ietf.org/doc/html/rfc2177) | メール即時プッシュの設計根拠 |
| [Playwright](https://github.com/microsoft/playwright) | Edge 認証ウィザードのブラウザ自動化 |
| [Agent Teams (DSH)](https://github.com/deepseek-ai/deepseek-harness) | マルチセッション協調の基盤 |
| [Model Context Protocol](https://github.com/modelcontextprotocol) | ツール統合プロトコルの参考 |

### 記載漏れがある場合

**あなたの成果物を使用しながら名前を記載していない場合は、issue でお知らせください。直ちに追記します。**
