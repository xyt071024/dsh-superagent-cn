/**
 * `orchestrator_plugin`: 装 / 卸 / 查 DSH 插件与 bundle。
 *
 * 这是「全能型选手」里最关键的一环 —— 没有它，agent 想给自己加能力只能靠 `bash` 手敲
 * `pnpm add`，没有任何规则引导，也拿不到 plugin manager 的原子性和回滚。
 *
 * 走宿主自己的 `ctx.pluginManager`（DSH 的 `@deepseek-ai/dsh-plugin-manager/tools` 用的就是它），
 * 所以行为与面板里点按钮完全一致：同样会挑 registry、同样会在失败时把 package.json 和
 * pnpm-lock.yaml 还原、同样报告需不需要重启。
 *
 * 权限：`WORK_TOOLS` 里有 `bash`，本来就是任意命令执行；这里不额外收窄，由 Policy 白名单决定
 * 谁能派活。真正的边界是「谁能发起工单」，不是「这个工具能不能用」。
 */
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { tool, type Tool } from './tool.ts'

/** `ctx.pluginManager` 的公开面，只取本工具用得到的那几个方法。 */
interface Manager {
  listBundles(): Promise<unknown>
  listPlugins(): Promise<unknown>
  installBundle(spec: string, options?: { activate?: boolean }): Promise<unknown>
  removeBundle(name: string): Promise<unknown>
}

/** 宿主没有 plugin manager 时（白板 profile 未启用）给出的说明，而不是抛错。 */
const MISSING = 'This profile has no plugin manager, so plugins cannot be changed from here. '
  + 'A profile enables it with the `@deepseek-ai/dsh-plugin-manager` bundle; the DSH web profile ships it.'

export function pluginTool(context: Context): Tool {
  return tool({
    name: 'orchestrator_plugin',
    // Kept short: the orchestrator's prompt and tool budget is a hard limit, and this tool is the smallest that still does its job.
    description: 'List, install or remove this profile\'s DSH plugins.',
    schema: z.object({
      // `operation` rather than `action`: the role prompts read "a necessary human action", and an `action` option here would
      // make that prose look like a parameter value this tool refuses.
      operation: z.enum(['list_bundles', 'list_plugins', 'install_bundle', 'remove_bundle']),
      target: z.string().trim().min(1).optional().describe('The install spec or the bundle name.'),
    }).strict(),
    execute: async ({ operation, target }) => {
      const manager = context.get('pluginManager') as Manager | undefined
      if (!manager) return { available: false, detail: MISSING }
      switch (operation) {
        case 'list_bundles': return { available: true, bundles: await manager.listBundles() }
        case 'list_plugins': return { available: true, plugins: await manager.listPlugins() }
        case 'install_bundle':
          if (!target) throw new Error('install_bundle needs target: an npm name, a git URL, a tarball URL, or an absolute local directory')
          return { available: true, ...(await manager.installBundle(target) as object) }
        case 'remove_bundle':
          if (!target) throw new Error('remove_bundle needs target: the exact installed bundle name')
          return { available: true, ...(await manager.removeBundle(target) as object) }
      }
    },
  })
}
