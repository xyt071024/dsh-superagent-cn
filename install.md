# 安装 Super Agent（v0.4.0）

三种装法，按你的环境选择。

---

## 方式一：一键在线安装脚本（已装 Node 22.19+ 与 DSH）

自动查询 GitHub 最新正式版、校验 gzip 头与 SHA-256，并在独立 `superagent` profile 中完成安装与配置（不会覆盖已有 `cordis.patch.yml`）：

**Windows（PowerShell）：**

```powershell
irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex
```

**macOS / Linux（Bash）：**

```bash
curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash
```

---

## 方式二：四平台零依赖内置包（不需要预装 Node 或 DSH）

下载对应系统的整包，解压后直接运行启动脚本。

| 系统 | 下载 |
|---|---|
| **Windows x64** | [Super-Agent-Bundled-Windows-x64-v0.4.0.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.4.0/Super-Agent-Bundled-Windows-x64-v0.4.0.zip) |
| **macOS Apple Silicon**（M1/M2/M3/M4） | [Super-Agent-Bundled-macOS-arm64-v0.4.0.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.4.0/Super-Agent-Bundled-macOS-arm64-v0.4.0.zip) |
| **macOS Intel** | [Super-Agent-Bundled-macOS-x64-v0.4.0.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.4.0/Super-Agent-Bundled-macOS-x64-v0.4.0.zip) |
| **Linux x64** | [Super-Agent-Bundled-Linux-x64-v0.4.0.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.4.0/Super-Agent-Bundled-Linux-x64-v0.4.0.zip) |

### 步骤

1. **解压**到任意可写目录（不要放 `C:\Program Files` 或需要管理员权限的位置）。
2. **运行启动脚本**：Windows 双击 `start.cmd`，macOS / Linux 执行 `./start.sh`。
3. **自动初始化**：把 profile 装到 `~/.dsh/profiles/superagent`，选一个空闲端口（3082–3182）并启动面板。
4. **打开面板**：访问终端打印的本地地址（形如 `http://127.0.0.1:3087`）。

> **无损升级与崩溃恢复**：如果已有旧版 profile，启动脚本会自动备份并无损升级 `dsh-superagent` 插件，保留原有的 `cordis.patch.yml` 及其他插件。`v0.4.0` 新增 PID 感知状态目录锁：运行中的实例绝不会被误抢锁，Windows 异常强杀后无需等待 30 秒即可立即安全重启。

---

## 方式三：独立插件包（已装 DSH）

```bash
dsh plugin add ./Super-Agent-Plugin-v0.4.0.tgz
```

或指定 profile：

```bash
dsh plugin --profile superagent add ./Super-Agent-Plugin-v0.4.0.tgz
```

下载：[Super-Agent-Plugin-v0.4.0.tgz](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.4.0/Super-Agent-Plugin-v0.4.0.tgz)

> 插件需要 Node.js 22.19+（或 24+）与已安装的 DSH（0.2.2+）。

---

## 装完之后

1. **先配模型与分工设置**：在 DSH 配置可用模型，进入「超级代理人 → 设置」查看「会话分工与模型」（默认每任务最多 5 个独立分工，可自由调大并逐槽位混配模型或留空继承）和「上下文与预算」（默认 60% 接力阈值）。
2. **推荐先跑一个只读任务**：在工作区选择 Super Agent 自动分工预设，试着输入「请分别核对项目的安装说明、配置示例和更新日志，各自给出文件依据，最后汇总」。
3. **按需配置外部来源**：在 设置 → 来源 中按需配置 GitHub、飞书、个人 QQ / 微信 / 企业微信（OneBot）、官方 QQBot 或 IMAP/SMTP 邮箱（含 Gmail）。
4. **按需开启独立复查**：在 设置 → 路由 / 执行 中打开后，复杂工单完成后会另开只读独立审查员（作者不可自审），最多复审 3 轮；代码工作项始终强制校验受控测试凭据。

---

## 验证边界与已知限制

- **自动分工与独立复查默认关闭**：需在设置页按需启用（拆分多人协作会增加 token 消耗）。
- **外部渠道与真实模型吞吐**：已通过协议测试、错误映射与多轮回归验证；七条外部渠道的真实账号收发与真实商业模型 API Key 下的吞吐请按你的环境实测。
- **macOS / Linux 真机桌面运行**：已通过 Linux CI 全量测试（1,393 通过）、ZIP 权限位、原生模块与引导脚本校验，尚未在物理 macOS / Linux 真机双击实跑。

---

## 卸载

```bash
dsh plugin remove dsh-superagent
```

内置包装的还可删除独立 profile：

```bash
rm -rf ~/.dsh/profiles/superagent
```

Windows：`rmdir /s %USERPROFILE%\.dsh\profiles\superagent`

---

## 遇到问题

- **启动脚本一闪就关** —— 在终端里运行查看完整报错
- **提示状态目录被占用（`ELOCKED`）** —— 报错会列出当前持有锁的活跃 PID，请勿强删锁目录，先正常关闭旧实例或重启
- **端口被占** —— 会自动切换空闲端口，以终端打印的 `127.0.0.1:<port>` 为准
- 提 issue：https://github.com/xyt071024/dsh-superagent-cn/issues
