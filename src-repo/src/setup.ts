/** Structured startup and configuration errors with the settings location where the operator can fix them. */
import { fill } from './infra/text.ts'

export type SetupPlace = 'deployment' | 'github' | 'feishu' | 'qq' | 'mail'
export const SETUP_PROBLEMS = {
  foreignFile: ['deployment', '{file} was not written by dsh-superagent; move it, or choose another state directory.'],
  gitTooOld: ['deployment', 'git does not read the github.com credential configuration dsh-superagent writes; dsh-superagent needs git 2.32 or later.'],
  environmentFailed: ['deployment', 'Preparing the agent environment failed.'],
  repositoryUnset: ['github', 'The GitHub Source names no repository.'],
  agentCliUnset: ['github', 'The agent GitHub CLI is not set.'],
  agentCliMissing: ['github', 'The agent GitHub CLI was not found.'],
  agentCliSignedOut: ['github', 'The agent GitHub CLI cannot read its account.'],
  agentCliNoAccount: ['github', 'The agent GitHub CLI did not report a GitHub account.'],
  repositoryUnreadable: ['github', '@{account} cannot read {repository}.'],
  repositoryUnreported: ['github', 'The agent GitHub CLI did not return {repository}.'],
  repositoryReadOnly: ['github', '@{account} cannot push to {repository}.'],
  feishuCliFailed: ['feishu', 'The bot lark-cli does not work.'],
  feishuNoApp: ['feishu', 'auth status of the bot lark-cli did not report the app.'],
  feishuBotNotReady: ['feishu', 'The bot identity of app {app} is {status}; configure the app secret with lark-cli.'],
  feishuUserIdentity: ['feishu', 'The bot lark-cli allows user identities (strict mode {mode}); give the bot its own lark-cli configuration in strict mode bot, as docs/006-deployment.md describes.'],
  feishuNoBot: ['feishu', 'The Feishu bot API did not return the bot\'s open_id.'],
  // OneBot covers QQ, WeChat and WeCom: one factory makes all three, so one set of checks serves them. Before these codes
  // existed a misconfigured gateway showed only 'waiting' or 'error' and never said what was missing - the complaint this
  // project kept getting. The check behind them is probeSource in source-probe.ts, which sends no message and returns no
  // credentials. These are *startup* checks: they name the missing setting, so the panel can point at the field to fix.
  onebotEndpointUnset: ['qq', 'The {platform} Source names no gateway endpoint; its messages cannot arrive or be sent.'],
  onebotUnreachable: ['qq', 'Nothing answers at the {platform} gateway endpoint {endpoint}; start the gateway, or correct the address.'],
  onebotAuthFailed: ['qq', 'The {platform} gateway rejected the access token. Copy the token the gateway prints at startup.'],
  onebotFailed: ['qq', 'The {platform} gateway did not answer the identity check; see its own window for the reason.'],
  mailAddressUnset: ['mail', 'The mailbox Source names no address, so there is nothing to read.'],
  mailPasswordUnset: ['mail', 'The mailbox Source has no app password; an ordinary account password will be rejected.'],
  mailImapUnreachable: ['mail', 'The mail server did not answer at {server}; check the address and the network.'],
  mailImapAuthFailed: ['mail', 'The mail server rejected the address or the app password; generate a new app password for this mailbox.'],
  mailSmtpUnreachable: ['mail', 'The outgoing mail server did not answer at {server}; the mailbox can be read but not replied to.'],
  mailSmtpAuthFailed: ['mail', 'The outgoing mail server rejected the address or the app password; the mailbox can be read but not replied to.'],
} as const satisfies Record<string, readonly [SetupPlace, string]>
export type SetupCode = keyof typeof SETUP_PROBLEMS
export interface SetupProblem { place: SetupPlace; code: SetupCode; values: Record<string, string>; detail: string }

/**
 * Thrown by deployment and account verification checks when a required CLI, account, or repository check fails.
 * `Setup` records it for the management overview, and the HTTP layer returns `problem` so the panel can localize it.
 */
export class SetupError extends Error {
  readonly place: SetupPlace
  constructor(readonly code: SetupCode, readonly values: Record<string, string> = {}) {
    const [place, text] = SETUP_PROBLEMS[code]
    const sentence = fill(text, values)
    super(values.output ? `${sentence}\n${values.output}` : sentence)
    this.place = place
  }
  get problem(): SetupProblem { return { place: this.place, code: this.code, values: this.values, detail: this.message } }
}
