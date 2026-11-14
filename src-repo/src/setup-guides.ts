/**
 * What each Source needs before it can receive work, and how to get it.
 *
 * The panel could previously say only what was wrong — "waiting for the qq endpoint", "the GitHub CLI is not set" — which
 * leaves a person to work out where that value comes from and in what order the steps go. A step here is written so it can
 * be *done*: it names the exact thing to open, the value to paste, and how to tell it worked.
 *
 * Order matters and is the whole point: a QQ bridge has to exist before its token means anything, and a token has to be
 * there before the login can be verified. Steps are listed in the order a person should walk them.
 */
import type { Localized } from './sources/kind.ts'

/** One thing to do, with where it happens and how to know it is done. */
export interface SetupStep {
  /** Stable id, used by the panel to track which step is being shown. */
  key: string
  title: Localized
  /** Where this happens: a URL to open, or a command to run. Empty when the step is only a decision. */
  where?: Localized
  /** A link to open for this step; absent when there is nothing to open. */
  url?: string
  /** How to tell the step worked. Omitted when the check button is the answer. */
  done?: Localized
  /** True when the step needs something only the person can do (scan a code, approve an app), not just a paste. */
  manual?: true
}

/** Everything one Source needs, in order, plus what is still missing right now. */
export interface SourceSetup {
  source: string
  /** One line describing what this Source is for, in the person's terms. */
  purpose: Localized
  steps: SetupStep[]
  /** What the deployment check found missing, as step keys. Empty when the Source is ready. */
  missing: string[]
  /** Whether the Source can receive work now. */
  ready: boolean
}

const FEISHU_OPEN = 'https://open.feishu.cn/app'

/**
 * The QQ / WeChat / WeCom family: all three speak OneBot v11, so one bridge serves any of them.
 *
 * The bridge is a separate program the person installs themselves, which is why the first step is a download rather than a
 * setting: there is no endpoint to configure until something is listening on one.
 */
const oneBot = (kind: string, title: string, purpose: Localized): SourceSetup => ({
  source: kind,
  purpose,
  steps: [
    {
      key: 'bridge',
      title: { zh: `装一个 OneBot 网关（${title} 用它收发消息）`, en: `Install a OneBot bridge (${title} sends and receives through it)` },
      where: { zh: 'SnowLuma 或 NapCat，两个都行；装完它会告诉你监听端口和访问 token',
        en: 'SnowLuma or NapCat — either one. When it starts it prints a port and an access token' },
      url: 'https://github.com/SnowLuma/SnowLuma',
      done: { zh: '浏览器打开 http://127.0.0.1:<端口> 能看到网关自己的页面', en: 'http://127.0.0.1:<port> shows the bridge\'s own page' },
    },
    {
      key: 'endpoint',
      title: { zh: '把网关的地址填进下面的「接口地址」', en: 'Paste the bridge address into Endpoint below' },
      where: { zh: '形如 http://127.0.0.1:3000', en: 'Like http://127.0.0.1:3000' },
    },
    {
      key: 'token',
      title: { zh: '把网关的访问 token 填进下面的「Token」', en: 'Paste the bridge access token into Token below' },
      where: { zh: '网关启动时打印的那串；没设就是空的', en: 'The string the bridge printed at startup; empty if it has none' },
    },
    {
      key: 'login',
      title: { zh: '在网关上扫码登录，然后点下面的「检查部署」', en: 'Scan the code in the bridge, then press Check deployment below' },
      done: { zh: '检查结果显示「已就绪」，并且能看到自己的号', en: 'The check reports ready and names your account' },
      manual: true,
    },
  ],
  missing: [],
  ready: false,
})

/**
 * Mail: IMAP in, SMTP out, and the app password is the only hard part.
 *
 * It is not the account password, and the provider only offers it after IMAP/SMTP is switched on, which is a step people
 * miss — so the step says to switch it on first and links to the page that does both.
 */
const mail: SourceSetup = {
  source: 'mail',
  purpose: { zh: '收到发给你的邮件时建工单；回复直接发回那个邮件线程', en: 'Opens a ticket when mail arrives, and replies land back in that thread' },
  steps: [
    {
      key: 'enable',
      title: { zh: '在邮箱设置里打开 IMAP/SMTP 服务', en: 'Switch on IMAP/SMTP in the mailbox settings' },
      where: { zh: 'QQ 邮箱：设置 → 账户 → POP3/IMAP/SMTP 服务', en: 'QQ Mail: Settings → Account → POP3/IMAP/SMTP service' },
      url: 'https://service.mail.qq.com/detail/0/75',
      done: { zh: '页面上那两个开关都是「已开启」', en: 'Both switches on that page read "on"' },
    },
    {
      key: 'secret',
      title: { zh: '生成授权码，填进下面的「授权码」', en: 'Generate an app password and paste it into App password below' },
      where: { zh: '开启服务时邮箱会给你一串 16 位字符，那才是授权码，不是登录密码',
        en: 'Turning the service on gives you a 16-character string — that is the app password, not your login password' },
      done: { zh: '授权码填进去之后，这一栏显示「已设置」', en: 'The field shows "set" once stored' },
    },
    {
      key: 'address',
      title: { zh: '把完整邮箱地址填进「邮箱地址」', en: 'Paste the full address into Mail address' },
      where: { zh: '它同时是 IMAP 和 SMTP 的登录名', en: 'It is the IMAP and SMTP login name as well' },
    },
    {
      key: 'check',
      title: { zh: '点「检查部署」，看能不能连上收件箱', en: 'Press Check deployment to see whether the inbox opens' },
      done: { zh: '检查结果显示「已就绪」', en: 'The check reports ready' },
    },
  ],
  missing: [],
  ready: false,
}

/** Feishu: a bot app plus a bot-only `lark-cli`, both of which have to exist before the Source does anything. */
const feishu: SourceSetup = {
  source: 'feishu',
  purpose: { zh: '群里 @ 它，或私聊它，就建工单；回复发回同一个会话', en: 'Mention it in a group or message it directly to open a ticket; replies go back to that conversation' },
  steps: [
    {
      key: 'app',
      title: { zh: '在飞书开放平台建一个企业自建应用，开通机器人能力', en: 'Create a custom app on the Feishu open platform and enable the bot' },
      where: { zh: '拿到 App ID 和 App Secret；权限至少要有「接收消息」和「发送消息」',
        en: 'You get an App ID and App Secret. Permissions need at least receive-message and send-message' },
      url: FEISHU_OPEN,
      done: { zh: '应用详情页的「凭证与基础信息」里能看到 App ID', en: 'Credentials & basic info on the app page shows an App ID' },
    },
    {
      key: 'cli',
      title: { zh: '装 lark-cli，并用这个应用的凭证登录机器人身份', en: 'Install lark-cli and sign in as the bot with that app\'s credentials' },
      where: { zh: 'lark-cli auth login --as bot（要用独立配置，不要和你自己的账号混用）',
        en: 'lark-cli auth login --as bot — with its own config, not mixed with your own account' },
      done: { zh: 'lark-cli auth status 显示 bot 身份 ready，且 strict-mode 是 bot',
        en: 'lark-cli auth status reports the bot identity ready, with strict-mode bot' },
    },
    {
      key: 'events',
      title: { zh: '在应用里订阅「接收消息」事件，把机器人拉进要监听的群', en: 'Subscribe to the receive-message event, and add the bot to the group it should watch' },
      where: { zh: '不订阅收不到消息；不拉进群就只看得到私聊', en: 'Without the subscription nothing arrives; without adding it to a group it only sees direct messages' },
    },
    {
      key: 'check',
      title: { zh: '点「检查部署」确认机器人在线', en: 'Press Check deployment to confirm the bot is online' },
      done: { zh: '检查结果显示「已就绪」', en: 'The check reports ready' },
    },
  ],
  missing: [],
  ready: false,
}

/** GitHub: an agent account with its own `gh` login, plus a repository it may actually push to. */
const github: SourceSetup = {
  source: 'github',
  purpose: { zh: '有 issue、PR 评论或 CI 失败时建工单；它能读代码、改代码、提 PR', en: 'Opens a ticket on issues, PR comments and CI failures; it can read code, change it, and open a pull request' },
  steps: [
    {
      key: 'gh',
      title: { zh: '装 GitHub CLI（gh）', en: 'Install the GitHub CLI (gh)' },
      where: { zh: 'winget install GitHub.cli 或从 cli.github.com 下载', en: 'winget install GitHub.cli, or download from cli.github.com' },
      url: 'https://cli.github.com',
      done: { zh: '命令行敲 gh --version 有输出', en: 'gh --version prints a version' },
    },
    {
      key: 'login',
      title: { zh: '用一个专用账号登录 gh（不要用你自己的主账号）', en: 'Sign gh in as a dedicated account — not your own main one' },
      where: { zh: 'gh auth login，然后在下面的「智能体 GitHub CLI」里填它的路径',
        en: 'gh auth login, then put its path in Agent GitHub CLI below' },
      done: { zh: 'gh auth status 显示已登录，且账号就是你想要的那个', en: 'gh auth status shows signed in, on the account you meant' },
      manual: true,
    },
    {
      key: 'repo',
      title: { zh: '把仓库填成 owner/name', en: 'Fill the repository as owner/name' },
      where: { zh: '必须给那个专用账号 push 权限，否则它只能读', en: 'The dedicated account needs push permission, or it can only read' },
      done: { zh: '检查部署不报「无法 push」', en: 'The check no longer reports "cannot push"' },
    },
    {
      key: 'check',
      title: { zh: '点「检查部署」确认能读到这个仓库', en: 'Press Check deployment to confirm it can read the repository' },
      done: { zh: '检查结果显示「已就绪」', en: 'The check reports ready' },
    },
  ],
  missing: [],
  ready: false,
}

/** Every Source's setup, keyed by kind. The panel reads this; nothing here touches the network. */
export const SETUP_GUIDES: Record<string, SourceSetup> = {
  qq: oneBot('qq', 'QQ', { zh: 'QQ 上有消息时建工单；回复发回同一个会话', en: 'Opens a ticket when a QQ message arrives; replies go back to that conversation' }),
  wechat: oneBot('wechat', '微信', { zh: '微信上有消息时建工单；回复发回同一个会话', en: 'Opens a ticket when a WeChat message arrives; replies go back to that conversation' }),
  wecom: oneBot('wecom', '企业微信', { zh: '企业微信上有消息时建工单；回复发回同一个会话', en: 'Opens a ticket when a WeCom message arrives; replies go back to that conversation' }),
  mail,
  feishu,
  github,
}

/** The guide for a kind, or undefined when the kind is unknown (a stored instance of a Source that is no longer installed). */
export const guideOf = (kind: string): SourceSetup | undefined => SETUP_GUIDES[kind]
