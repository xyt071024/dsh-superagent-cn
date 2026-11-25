/** Browser plugin entry point registering the sidebar icon, main management panel, and Plugin Manager config view. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { openKnownSession, SessionNavigationError } from '../navigation.ts'
import { App } from './app.tsx'
import { PluginConfig, usePageForm } from './deployment.tsx'
import { en, zh } from './locales.ts'
import { navigatePanelTo, settingsRoute, type SettingsGroup } from './route.ts'
import type { T } from './text.ts'

type ClientContext = Context & { sessions: ISessions }
const NS = 'dshSuperagent'
const PANEL_ID = 'dsh-superagent' as MainPanelId
const ENTRY = 'dsh-superagent'

function HammerIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 3.5h9l3.5 1.75v2.5L15 9.5H6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" /><path d="M10 9.5v10.25a1.75 1.75 0 0 0 3.5 0V9.5" /><path d="M10 15.5h3.5" />
  </svg>
}

/** Mounted panel wrapper; cancels any pending Session navigation when a new one starts or the panel unmounts. */
function Mounted({ ctx, t }: { ctx: ClientContext; t: T }) {
  const pending = useRef<AbortController>(undefined)
  useEffect(() => () => { pending.current?.abort() }, [])
  const openSession = useCallback(async (id: string) => {
    pending.current?.abort()
    const request = new AbortController(); pending.current = request
    try {
      await openKnownSession(ctx.sessions, id as SessionId, target => { ctx.uiWorkspace.openSession(target) }, request.signal)
    } catch (error) {
      if (error instanceof SessionNavigationError) throw new Error(t(error.code === 'not-ready' ? 'sessionListNotReady' : 'sessionNotListed'))
      throw error
    }
  }, [ctx, t])
  const form = usePageForm(ctx.get('configForms')?.get<Record<string, unknown>>(ENTRY))
  return <App t={t} openSession={openSession} deploymentForm={form} />
}

/** 在当前聊天窗口顶栏展示分工启用状态，并提供直达设置与新建自动分工对话入口。 */
function ChatDivisionBadge({ ctx, t, openSettings }: { ctx: ClientContext; t: T; openSettings: (group: SettingsGroup) => void }) {
  const [routing, setRouting] = useState<{ multiSession: 'single' | 'auto'; maxSessions: number }>()
  useEffect(() => {
    let alive = true
    const load = () => {
      fetch('/orchestrator/api/settings', { headers: { 'x-orchestrator-request': '1' } })
        .then(res => res.ok ? res.json() as Promise<{ blocks?: { routing?: { value?: { multiSession: 'single' | 'auto'; maxSessions: number } } } }> : undefined)
        .then(data => {
          const val = data?.blocks?.routing?.value
          if (alive && val) setRouting({ multiSession: val.multiSession, maxSessions: val.maxSessions })
        })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 15_000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  if (!routing) return null
  const label = routing.multiSession === 'auto'
    ? t('chatDivisionAuto', { max: routing.maxSessions })
    : t('chatDivisionSingle')
  return <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <button type="button" title={t('chatDivisionNewHint')} onClick={() => openSettings('routing')}
      style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, border: '1px solid currentColor', opacity: 0.85, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
      {`${label} · ${t('chatDivisionSettings')}`}
    </button>
    <button type="button" title={t('chatDivisionNewHint')} onClick={() => { try { ctx.uiWorkspace.startSession() } catch { /* ignore */ } }}
      style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, border: '1px solid currentColor', opacity: 0.72, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
      {t('chatDivisionNewAction')}
    </button>
  </div>
}

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace']
/** Registers the panel, sidebar icon, Plugin Manager config view, and conversation status shortcut. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-superagent: dictionaries')
  const t = ctx.locale.bind(NS)
  const openSettings = (group: SettingsGroup) => {
    navigatePanelTo(settingsRoute(group))
    try { (ctx.get('layout') as { selectPanel?: (id: MainPanelId | null) => void } | undefined)?.selectPanel?.(PANEL_ID) } catch { /* ignore */ }
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) },
    (props: { t: T }) => <Mounted ctx={ctx} t={props.t} />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => t('panel'), locale: NS }, HammerIcon))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: `${ENTRY}#${ENTRY}`, locale: NS },
    (props: PluginConfigViewProps & { t: T }) => <PluginConfig t={props.t} view={props.view} form={props.form} openSettings={openSettings} />))
  try {
    ctx.slots.inject('conversation.session.header.utilities' as never, () => ctx.slots.register({
      name: 'conversation.session.header.utilities' as never,
      id: 'dsh-superagent-division-status',
      order: 40,
      locale: NS,
    } as never, (props: { t: T }) => <ChatDivisionBadge ctx={ctx} t={props.t} openSettings={openSettings} />))
  } catch { /* host without conversation utility slot */ }
}
