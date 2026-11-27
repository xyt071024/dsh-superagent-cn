# 安装 Super Agent

两种装法，看你的情况选。

---

## 方式一：内置包（不需要预装 Node 或 DSH）

下载对应你系统的包，解压，运行启动脚本。

| 系统 | 下载 |
|---|---|
| **Windows x64** | [Super-Agent-Bundled-Windows-x64-v0.3.20.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.3.20/Super-Agent-Bundled-Windows-x64-v0.3.20.zip) |
| **macOS Apple Silicon**（M1/M2/M3/M4） | [Super-Agent-Bundled-macOS-arm64-v0.3.20.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.3.20/Super-Agent-Bundled-macOS-arm64-v0.3.20.zip) |
| **macOS Intel** | [Super-Agent-Bundled-macOS-x64-v0.3.20.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.3.20/Super-Agent-Bundled-macOS-x64-v0.3.20.zip) |
| **Linux x64** | [Super-Agent-Bundled-Linux-x64-v0.3.20.zip](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.3.20/Super-Agent-Bundled-Linux-x64-v0.3.20.zip) |

### 步骤

1. **解压**到任意目录

   > 不要放 `C:\Program Files` 或需要管理员权限的位置。

2. **运行启动脚本**

   | 系统 | 运行 |
   |---|---|
   | Windows | 双击 `start.cmd` |
   | macOS / Linux | `./start.sh` |

3. **它会自动做三件事**

   - 把 profile 装到 `~/.dsh/profiles/superagent`
   - 选一个空闲端口（3082–3182）
   - 启动面板

4. **打开面板**

   终端会打印地址，形如 `http://127.0.0.1:3087`。

> **如果已有旧版 profile**，启动脚本会自动备份并无损升级 `dsh-superagent` 插件，保留你原有的 `cordis.patch.yml` 及其他插件。

---

## 方式二：插件包（已装 DSH）

```bash
dsh plugin add ./Super-Agent-Plugin-v0.3.20.tgz
```

或指定 profile：

```bash
dsh plugin --profile superagent add ./Super-Agent-Plugin-v0.3.20.tgz
```

下载：[Super-Agent-Plugin-v0.3.20.tgz](https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.3.20/Super-Agent-Plugin-v0.3.20.tgz)

> 插件需要 Node.js 22.19+ 与已安装的 DSH（0.2.2）。

---

## 装完之后

### 1. 配置来源

打开 设置 → 来源，配置你要用的通道：

- **QQ** —— 填 OneBot 网关地址与 token，点「检查」会实际连接网关
- **邮箱** —— 填地址与密码，IMAP 与 SMTP 分别检查
- **GitHub** —— 填 token 与仓库
- **飞书** —— 填 App ID / Secret

配错时会明确告诉你缺什么，不会只显示「等待部署检查」。

### 2. 可选：开启多人协作

默认是单人执行。想要一个工单拆多人：

设置 → 执行 → 多会话 → 选 `auto`

> 拆分会显著增加 token 消耗。

### 3. 可选：开启独立复查

设置 → 执行 → 独立复查 → 打开

复杂工单完成后会另开一个只读审查员，看不到执行过程。最多复审 3 轮。

---

## 已知限制

**多会话与独立复查默认关闭。** 需在 设置 → 路由 / 执行 中按需开启。

**各通道未做真实外部账号收发验收。** 已验证协议行为与错误映射；真实外部账号的登录、收发、断线恢复未在本机联网验证。

**macOS / Linux 未在物理真机桌面启动验证。** 包结构、原生模块、Unix 权限位与引导脚本已校验，但未在物理 macOS / Linux 机器双击实跑。

---

## 卸载

```bash
dsh plugin remove dsh-superagent
```

内置包装的还要删掉 profile：

```bash
rm -rf ~/.dsh/profiles/superagent
```

Windows：`rmdir /s %USERPROFILE%\.dsh\profiles\superagent`

---

## 遇到问题

- **启动脚本一闪就关** —— 在终端里跑，看报错
- **端口被占** —— 它会自动换，实在不行看终端打印的地址
- **面板打不开** —— 确认 `127.0.0.1` 后面的端口和终端打印的一致
- 提 issue：https://github.com/xyt071024/dsh-superagent-cn/issues
