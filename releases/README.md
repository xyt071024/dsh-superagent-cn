# 下载 / Downloads

按形态分两大类，各自再分「标准版」与「破甲版」。

## 目录结构

```
releases/
├── plugin/                    ← 插件版（装进已有 DSH）
│   ├── stable/                ← 标准版 Super Agent
│   └── purge/                 ← 破甲版
└── native/                    ← 白板版（自带 DSH，解压即用）
    ├── stable/                ← 标准版
    └── purge/                 ← 破甲版
```

## 当前状态

安装包尚未构建。构建后会放在对应目录，并在
[GitHub Releases](https://github.com/xyt071024/dsh-superagent-cn/releases) 同步发布。

## 命名规则

| 包 | 文件名格式 |
|---|---|
| 插件版 | `dsh-superagent-plugin-v<版本>.tar.gz` |
| 白板版 | `dsh-superagent-standalone-v<版本>-<平台>.zip` |
| 破甲插件 | `dsh-purge-plugin-v<版本>.tar.gz` |
| 破甲白板 | `dsh-purge-standalone-v<版本>-<平台>.zip` |

平台取值：`win-x64` / `mac-arm64` / `linux-x64`

## 安装方式

见 [安装与接入](../install.html) 和 [破甲模式](../purge.html)。

## 版本适配

| DSH 版本 | Super Agent | 破甲模式 |
|---|---|---|
| 0.2.1-rc.1 | 待验证 | 上游已验证 |
| 0.2.1-rc.2 | 待验证 | 上游已验证 |
| 0.2.1-rc.3 | 待验证 | 上游已验证 |
| 0.2.1-rc.5 | 待验证 | 上游已验证 |
| 0.2.2-rc.1 | 开发中 | 上游已验证 |

**装之前请核对版本**，否则可能出现插件打不开或软件起不来。
