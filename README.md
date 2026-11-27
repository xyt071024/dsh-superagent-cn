# Super Agent for DeepSeek Harness

<p>
  <a href="README.md"><strong>简体中文</strong></a> &nbsp;·&nbsp;
  <a href="README.en.md">English</a> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="https://xyt071024.github.io/dsh-superagent-cn/install.html">安装指南</a> &nbsp;·&nbsp;
  <a href="CHANGELOG.md">更新日志</a> &nbsp;·&nbsp;
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases">项目发布页</a>
</p>

Super Agent 是一个由社区维护的 DeepSeek Harness（DSH）插件。它把工作区聊天、外部消息和后台工单连接起来。你可以在一个主对话中布置项目任务，让多个独立对话处理可以并行的部分，再回到主对话查看进度、测试结果和复查意见。

## 从一个任务开始

例如，要同时修改一个功能、补测试并核对安装说明，可以在 DSH 工作区新建聊天，选择 Super Agent 自动分工预设，在插件的设置页启用自动分工。发任务后，可以在同一工作区分别打开分工对话，给某个成员补充要求，也可以回到主对话查看汇总。简单任务可以留在当前聊天。实际拆分数量和速度取决于任务、所选模型及供应商并发限制。

新配置默认允许每个任务最多创建 5 个额外分工对话。你可以调整数量，给每个位置指定供应商和模型。留空的位置跟随发起任务时主聊天使用的模型。独立复查单独记录。设置页也提供难度阈值、思考强度和预算控制。

## 一项工作如何完成

<p align="center">
  <img src="assets/architecture-flow.svg" alt="Super Agent 工作流架构图" width="920">
</p>

- **进入项目。** 工作区聊天可以直接发起任务。已配置的外部来源将消息转换成带有会话或讨论串标识的事件。系统依据接入策略、任务关联和授权范围，判断应继续现有工作、进入评估还是保持安静。
- **分配与协作。** 协调器记录工作项、依赖和负责人。成员拥有各自的上下文，可以定向沟通、发布可拆分工作、领取其他成员开放的工作项，并向原负责人提交结果。进展和阻塞原因保留在任务记录里。
- **验收与复查。** 代码工作项需要对应本次交付版本的测试结果。文档和调研工作可以记录人工验收依据。启用独立复查后，审查意见可以触发返工。长任务支持按设定阈值压缩上下文并接续会话，默认阈值为 60%。
- **对外回复。** 发件箱记录待发、送达与丢弃。需要确认的草稿可以先准备，再由用户决定发送或撤销。渠道暂停时保留待发状态，以实际回执更新送达结果。

## 接入方式

| 入口 | 使用条件 |
|---|---|
| DSH 工作区聊天 | 配置一个可用的模型连接；在目标工作区内选择自动分工预设 |
| GitHub | 连接目标仓库，配置凭据、监听范围和操作权限 |
| 个人 QQ、微信、企业微信 | 使用兼容的 OneBot 网关，按网关要求登录并配置事件与消息接口；部分接入需要独立后台服务 |
| 官方 QQ 机器人 | 使用腾讯开放平台的机器人凭据，按机器人授权范围接收和回复消息 |
| 飞书、Gmail／邮件 | 按接入说明配置机器人或邮箱授权；邮件接收与发送分别使用 IMAP、SMTP |

## 安装与首次使用

1. 在发布页面选择资产。已有兼容 DSH 环境可选独立插件包；自带环境包提供 Windows x64、Linux x64、macOS Intel 和 Apple Silicon 四种构建。[项目发布页](https://github.com/xyt071024/dsh-superagent-cn/releases)
2. 解压对应平台的整包。Windows 运行 `start.cmd`，Linux 或 macOS 运行 `./start.sh`，按启动器给出的本地地址进入面板。安装前可查看当前版本的环境要求和平台验证范围。[安装指南](https://xyt071024.github.io/dsh-superagent-cn/install.html)
3. 先配置模型，在「超级代理人 → 设置」检查分工、模型和预算。第一次可用一个只读任务试用，例如分别核对项目的安装说明、配置示例和更新日志；再按需接入外部账号。

## 项目来源

本项目基于 DeepSeek Harness 团队公开的 Super-agent 原型，在工作区独立分工、成员互助、模型设置、中文使用体验和多平台交付方面进行了扩展。社区独立维护，项目许可为 MIT。具体版本的测试结果与已知限制见对应 Release。[上游原型](https://github.com/deepseek-ai/dsh-superagent-prototype) · [项目仓库](https://github.com/xyt071024/dsh-superagent-cn)
