/** Overview page: pending Tickets requiring human action, active system problems, 24-hour flow counts, and Executor load. */
import { useState, type ReactNode } from 'react'
import { usePoll, type Problem } from './api.ts'
import type { ApiResponse } from '../app/api.ts'
import type { DshSuperagentKey } from './locales.ts'
import { Button, Icon } from './controls.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { setupPage, settingsRoute, type Route } from './route.ts'
import { TicketLine } from './rows.tsx'
import { healthText, localized, reasonLabel, valueLabel, readableMarkers } from './text.ts'
import { CheckSetupButton, ConfirmButton, Hint, LoadState, Section, SetupMessage } from './widgets.tsx'

function ProblemLine({ problem, onChanged }: { problem: Problem; onChanged: () => Promise<void> }) {
  const { t, call, navigate } = usePanel()
  const post = useAction((request: () => Promise<unknown>) => request(), { reload: onChanged })
  const row = (title: string, detail: ReactNode, route: Route | undefined, hint?: string, actions?: ReactNode) => <li
    className="dt-row dt-link dt-att dt-att-error">
    <div className="dt-row-main">
      <div className="dt-att-what">{route ? <button type="button" className="dt-open dt-open-wrap"
        onClick={() => navigate(route)}>{title}</button> : title}</div>
      {detail}{hint && <Hint>{hint}</Hint>}{actions && <div className="dt-row-meta dt-row-buttons">{actions}</div>}
    </div>
  </li>
  const go = (label: string, route: Route) => <Button variant="outline" size="sm" icon={<Icon name="settings"
    size={14} />} onClick={() => navigate(route)}>{label}</Button>
  const raw = (text: string | undefined) => text && <p className="dt-error dt-clamp dt-mono">{text}</p>
  const worded = (text: string) => <p className="dt-error">{text}</p>
  switch (problem.kind) {
    // A failed Feishu bot check pauses only the Feishu Source; other setup problems halt the entire service.
    case 'setup': return row(t(problem.place === 'feishu' ? 'problemSetupFeishu' : 'problemSetup'), <p className="dt-error"><SetupMessage
      problem={problem} /></p>,
      setupPage(problem.place), t(`problemSetupFix.${problem.place}`), <CheckSetupButton />)
    case 'no-source': return row(t('problemNoSource'), undefined, settingsRoute('source'), undefined, go(t('actionOpenSources'),
      settingsRoute('source')))
    case 'no-allowed': return row(t('problemNoAllowed'), undefined, settingsRoute('eval'), undefined, go(t('actionAddAllowed'),
      settingsRoute('eval')))
    case 'executor-paused': return row(t('problemPaused'), undefined, { page: 'execution' }, undefined,
      <ConfirmButton variant="outline" icon="play" label={t('resumeProcessing')} title={t('resumeProcessing')}
        message={t('resumeProcessingConfirm')}
        onConfirm={async () => { await call('POST executor/pause', { body: { paused: false } }); await onChanged() }} />)
    case 'runtime-error': return row(t('problemRuntime', { name: valueLabel(t, 'health', problem.name) }), raw(problem.detail), undefined)
    case 'source-error': {
      const health = problem.source.health
      return row(t('sourceError', { source: localized(t, problem.source.title) }), health.code ? worded(healthText(t, health))
        : raw(health.detail), { page: 'source' }, t('sourceErrorHint'))
    }
    case 'eval-overdue': return row(t('problemEvalOverdue', { thread: readableMarkers(t, problem.thread.title) }), undefined, { page: 'trigger',
      id: problem.thread.key })
    case 'eval-unavailable': return row(t('problemEvalUnavailable', { thread: readableMarkers(t, problem.thread.title) }), raw(reasonLabel(t,
      problem.reason)),
      { page: 'trigger', id: problem.thread.key, query: { trigger: problem.triggerId } }, undefined, <>
        <Button variant="outline" size="sm" icon={<Icon name="refresh" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST triggers/:id/requeue', { id: problem.triggerId })) }}>{t('requeue')}</Button>
        <Button variant="outline" size="sm" icon={<Icon name="dismiss" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST decisions/:id/dismiss', { id: problem.decisionId })) }}>{t('dismiss')}</Button>
      </>)
    case 'outgoing': return row(t('problemReply', { source: valueLabel(t, 'source', problem.outgoing.channel.source),
      attempts: problem.outgoing.attempts }),
      raw(problem.outgoing.error), undefined)
  }
}

export function OverviewPage() {
  const { t, call, navigate } = usePanel()
  const { setup } = usePanelData()
  const { data, error, reload } = usePoll(() => call('GET overview'), [])
  if (!data) return <LoadState error={error} loading />
  const stat = (label: string, value: ReactNode, route?: Route) => <span className="dt-stat">
    <span className="dt-stat-label">{label}</span>
    {route ? <button type="button" className="dt-textlink dt-stat-value" onClick={() => navigate(route)}>{value}</button> : <span
      className="dt-stat-value">{value}</span>}
  </span>
  const more = (route: Route) => <button type="button" className="dt-textlink dt-more-link"
    onClick={() => navigate(route)}>{t('details')}</button>
  return <>
    {error && <LoadState error={error} loading={false} />}
    <Section title={t('pendingTickets')} count={data.person.length}>
      {data.person.length ? <ul className="dt-list dt-cards">{data.person.map(ticket => <TicketLine key={ticket.id} ticket={ticket} question
        onChanged={reload} />)}</ul>
        : <Hint>{t('needsYouNone')}</Hint>}
    </Section>
    <Inspection />
    <SpeculativeDrafts />
    <HeldEffects />
    {data.problems.length > 0 && <Section title={t('problems')} count={data.problems.length}>
      <ul className="dt-list dt-cards">{data.problems.map((problem, index) => <ProblemLine key={index} problem={problem}
        onChanged={reload} />)}</ul>
    </Section>}
    <Section title={t('lastDay')} action={more({ page: 'trigger', query: { filter: 'recent' } })}>
      {/* Received and evaluated counts operate on Triggers rather than Threads or Decisions, so they do not link to filtered views. */}
      <div className="dt-stats">
        {stat(t('flowReceivedLabel'), data.flow.received)}
        {stat(t('flowFilteredLabel'), data.flow.filtered, data.flow.filtered ? { page: 'source' } : undefined)}
        {stat(t('flowJudgedLabel'), data.flow.judged)}
        {stat(t('flowAcceptedLabel'), data.flow.accepted, { page: 'eval', query: { window: '24h' } })}
        {data.flow.dropped > 0 && stat(t('flowDroppedLabel'), data.flow.dropped, { page: 'source' })}
      </div>
    </Section>
    <Section title={t('term.executor')} action={more({ page: 'execution' })}>
      {/* Pauses surface in `problems` above, so Executor counts render the same in both states; while setup waits, nothing runs. */}
      {setup?.problem ? <Hint>{t('executorWaitingSetup')}</Hint> : <div className="dt-stats">
        {stat(t('executingLabel'), `${data.executor.running} / ${data.executor.maxWorkers}`)}
        {stat(t('queuedLabel'), data.executor.queued)}
        {stat(t('idleLabel'), data.executor.idle)}
      </div>}
    </Section>
  </>
}

function SpeculativeDrafts() {
  const { call, t } = usePanel()
  const { data, reload } = usePoll(() => call('GET drafts'), [])
  const action = useAction(async (run: () => Promise<unknown>) => { await run(); await reload() })
  const active = (data?.drafts ?? []).filter(d => d.status === 'draft' || d.status === 'delivery_failed' || d.status === 'delivering')
  if (!active.length) return null
  return <Section title={t('draftsTitle')} count={active.length}>
    <Hint>{t('draftsHint')}</Hint>
    <ul className="dt-list">{active.map(draft => <li key={draft.draftId} className="dt-row">
      <div className="dt-row-main">
        <div className="dt-row-title">{draft.title} <span className="dt-mono">({draft.status}{draft.receiptStatus === 'pending' ? ' · pending' : ''})</span></div>
        <Hint>{draft.content.slice(0, 240)}</Hint>
      </div>
      <div className="dt-row-actions">
        <Button variant="outline" size="sm" disabled={action.busy || draft.status === 'delivering'}
          onClick={() => { void action.run(() => call('POST drafts/:id/confirm', { id: draft.draftId })) }}>{t('draftConfirm')}</Button>
        <Button variant="outline" size="sm" disabled={action.busy || draft.status === 'delivering'}
          onClick={() => { void action.run(() => call('POST drafts/:id/revoke', { id: draft.draftId, body: { reason: 'revoked in panel' } })) }}>{t('draftRevoke')}</Button>
        <Button variant="outline" size="sm" disabled={action.busy || draft.status === 'delivering'}
          onClick={() => { void action.run(() => call('POST drafts/:id/discard', { id: draft.draftId, body: { reason: 'discarded in panel' } })) }}>{t('draftDiscard')}</Button>
      </div>
    </li>)}</ul>
  </Section>
}

function HeldEffects() {
  const { call, t } = usePanel()
  const { data, reload } = usePoll(() => call('GET effects/held'), [])
  const action = useAction(async (kind: string) => { await call('POST effects/:kind/retry-held', { kind }); await reload() })
  if (!data?.items.length) return null
  return <Section title={t('effectsHeldTitle')} count={data.items.length}>
    <Hint>{t('effectsHeldHint')}</Hint>
    <ul className="dt-list">{data.items.map(item => <li key={item.kind} className="dt-row">
      <span>{valueLabel(t, 'health', item.kind)}: {item.count}</span>
      <Button variant="outline" size="sm" disabled={action.busy} onClick={() => { void action.run(item.kind) }}>{t('effectsHeldRetry')}</Button>
    </li>)}</ul>
  </Section>
}

/** Read-only, user-triggered diagnostics; network checks and repairs are not implied. */
function Inspection() {
  const { t, call } = usePanel()
  const { state } = usePanelData()
  const [result, setResult] = useState<ApiResponse<'GET self-inspect'> | undefined>()
  const [update, setUpdate] = useState<ApiResponse<'GET update-check'> | undefined>()
  const action = useAction(async () => { setResult(await call('GET self-inspect')) })
  const checkUpdate = useAction(async () => { setUpdate(await call('GET update-check')) })
  const version = result?.version ?? state?.version
  const problems = result?.inspection.gaps ?? []
  const missing = result?.hygiene.missing ?? []
  const labels: Record<string, DshSuperagentKey> = { noLiveSource: 'inspect.noLiveSource', noSource: 'inspect.noSource',
    emptyAllowList: 'inspect.emptyAllowList', observeOnly: 'inspect.observeOnly', source_paused: 'inspect.source_paused',
    source_error: 'inspect.source_error', reloadRequired: 'inspect.reloadRequired' }
  return <Section title={t('inspectTitle')} action={<Button variant="outline" size="sm" disabled={action.busy}
    onClick={() => { void action.run() }}>{t('inspectRun')}</Button>}>
    <Hint>{t('inspectScope')}</Hint>
    {version && <div className="dt-row-meta">
      <span>{t('versionProfile')}: {version.profileName ?? '—'}</span>
      <span>{t('versionLoaded')}: {version.loaded ?? '—'}</span>
      <span>{t('versionInstalled')}: {version.installed ?? '—'}</span>
    </div>}
    {version?.reloadRequired && <p className="dt-banner dt-danger">
      {t('versionReloadRequired', { loaded: version.loaded ?? '?', installed: version.installed ?? '?' })}
    </p>}
    {result && (problems.length || missing.length ? <ul className="dt-list">{problems.map((gap, index) =>
      <li className="dt-row" key={`${gap.code}-${index}`}><div className="dt-row-main">
        <span>{labels[gap.code] ? t(labels[gap.code]!) : gap.detail}</span>{(gap.code.startsWith('source_') || gap.code === 'reloadRequired') && <p className="dt-hint">{gap.detail}</p>}
      </div></li>)}{missing.map(item => <li key={item} className="dt-row"><span>{t('inspectMissingDirectory')}: {item}</span></li>)}</ul>
      : <Hint>{t('inspectClear')}</Hint>)}
    <div className="dt-row-meta dt-row-buttons">
      <Button variant="outline" size="sm" disabled={checkUpdate.busy} onClick={() => { void checkUpdate.run() }}>
        {t(checkUpdate.busy ? 'updateChecking' : 'updateCheck')}
      </Button>
      {update && <span>{t('updateCurrent')}: {update.current ?? '—'} · {t('updateLatest')}: {update.latest ?? '—'} · {t(
        update.status === 'available' ? 'updateAvailable' : update.status === 'up-to-date' ? 'updateCurrentLatest' : update.status === 'newer-local' ? 'updateNewerLocal' : 'updateUnknown'
      )} · <a className="dt-field-link" href={update.releases} target="_blank" rel="noreferrer noopener">{t('updateReleases')}</a></span>}
    </div>
  </Section>
}
