# 下载 / Downloads

Super Agent for DeepSeek Harness 的全部安装包。按形态分两大类，各自再分「标准版」与「破甲版」。

---

## 直接下载

下面六个文件都在 [`dl/`](dl/) 目录下，可直接点链接下载，也可用页面内的命令安装。

### 插件版（装进已有的 DSH）

| 版本 | 文件 | 大小 | 说明 |
|---|---|---|---|
| 标准版 | [`dsh-superagent-stable.tgz`](dl/dsh-superagent-stable.tgz) | 324 KB | 只加 Super Agent，不动既有权限设计 |
| 破甲版 | [`dsh-superagent-purge.tgz`](dl/dsh-superagent-purge.tgz) | 324 KB | 额外削弱三层权限中的提示词层，见下方警告 |

安装：

```bash
dsh plugin add https://xyt071024.github.io/dsh-superagent-cn/releases/dl/dsh-superagent-stable.tgz
```

### 白板版（自带 DSH，解压即用）

| 版本 | 文件 | 大小 | 说明 |
|---|---|---|---|
| 标准版 | [`superagent-native-stable.zip`](dl/superagent-native-stable.zip) | 1.7 MB | 全新 DSH profile，只含 Super Agent |
| 破甲版 | [`superagent-native-purge.zip`](dl/superagent-native-purge.zip) | 1.7 MB | 同上 + 破甲 |

解压后双击 `start.cmd`（Windows）或 `chmod +x start.sh && ./start.sh`（macOS / Linux）。第一次启动会自动铺 profile 并装那一个依赖，约 15 秒。

### 分卷压缩包（给手动安装的人）

| 版本 | 文件 | 说明 |
|---|---|---|
| 插件版标准 | [`superagent-plugin-stable.zip`](dl/superagent-plugin-stable.zip) | tgz + 依赖 + 安装脚本 + 说明 |
| 插件版破甲 | [`superagent-plugin-purge.zip`](dl/superagent-plugin-purge.zip) | 同上 |
| 白板版标准 | [`superagent-native-stable.zip`](dl/superagent-native-stable.zip) | 与上面白板版同一份 |
| 白板版破甲 | [`superagent-native-purge.zip`](dl/superagent-native-purge.zip) | 同上 |

---

## ⚠️ 破甲版说明

破甲版（purge）会削弱 Super Agent 自身的三层权限设计中的**提示词层**，让模型对指令的服从更彻底。它**不改变**网关白名单：谁能派活仍然由配置决定。

用它之前请先读 [破甲说明](../purge.html)，并在需要时执行 `dsh purge revert` 恢复。

---

## 安装前需要什么

| 形态 | 需要 |
|---|---|
| 插件版 | 一个已经能跑的 DSH，Node.js 22.19+ |
| 白板版 | 只要 Node.js 22.19+ |

Node.js：<https://nodejs.org>

完整步骤见 [安装文档](../install.html)。

---

## 校验

每个包都可用以下方式确认真伪（比对文件大小与解压后的结构）：

```bash
# 插件版
curl -sL -o t.tgz https://xyt071024.github.io/dsh-superagent-cn/releases/dl/dsh-superagent-stable.tgz
ls -l t.tgz && tar -tzf t.tgz | head

# 白板版
curl -sL -o t.zip https://xyt071024.github.io/dsh-superagent-cn/releases/dl/superagent-native-stable.zip
unzip -l t.zip | head
```

下载到的包里**不含任何人的账号、白名单、仓库名或令牌**——所有配置项都是空占位符，第一次启动后在设置界面里填自己的。

---

## 版本

当前打包版本：**0.2.0**。历史与变更见仓库根的 `CHANGELOG.md`。
