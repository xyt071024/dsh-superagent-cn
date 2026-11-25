/**
 * Routing settings group: how much autonomy a run gets over Sessions, models, thinking depth and where it runs.
 * Every field here is an operator decision, so each one is explained where it sits rather than in a manual.
 */
import { useEffect, useState } from 'react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { LIMITS } from '../limits.ts'
import type { RoleModel } from '../policy.ts'
import { usePanel } from './provider.tsx'
import { Button, Icon, InfoTip, Input, Pill, Tag } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { ConfigHistory, Field, Fields, ModelField, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { Hint, LabelValue, Section } from './widgets.tsx'

/** Ticks the exact `provider/model` ids a run may use, so no unapproved model is ever selected. */
function ModelAllowance({ value, groups, onChange }: {
  value: string[]
  groups: ModelCatalog['groups']
  onChange: (next: string[]) => void
}) {
  const { t } = usePanel()
  const [query, setQuery] = useState('')
  const chosen = new Set(value)
  const needle = query.trim().toLowerCase()
  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter(entry => entry !== id) : [...value, id])
  // A model id only steers selection when the catalog really has it. One that vanished from the profile would otherwise
  // stay ticked, silently never match, and quietly narrow the allowance to whatever else remains.
  const known = new Set(groups.flatMap(group => group.models.map(model => `${group.id}/${model.id}`)))
  const missing = value.filter(entry => !known.has(entry))
  const shown = groups
    .map(group => ({ ...group, models: group.models.filter(model => {
      const id = `${group.id}/${model.id}`
      return !needle || id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle)
    }) }))
    .filter(group => group.models.length)
  return <div className="dt-allowance">
    <Hint>{value.length ? t('routingAllowCount', { count: value.length }) : t('routingAllowAll')}</Hint>
    {missing.length > 0 && <div className="dt-callout" data-tone="warning">
      <p>{t('routingAllowMissing', { models: missing.join('、') })}</p>
      <div className="dt-filters">
        <Pill active={false} onClick={() => onChange(value.filter(entry => known.has(entry)))}>{t('routingAllowDropMissing')}</Pill>
      </div>
    </div>}
    <Input value={query} placeholder={t('routingAllowSearch')} spellCheck={false} onChange={event => setQuery(event.target.value)} />
    {value.length > 0 && <div className="dt-filters">
      <Pill active={false} onClick={() => onChange([])}>{t('routingAllowClear')}</Pill>
    </div>}
    {/* Why: an empty allowance means "whatever the profile offers", so the list shows states, not a required field. */}
    {shown.length === 0 && <Hint>{t('routingAllowNoMatch')}</Hint>}
    {shown.map(group => <div key={group.id} className="dt-allowance-group">
      <div className="dt-allowance-head"><Icon name="hash" />{group.name}<span className="dt-count">{group.id}</span></div>
      <div className="dt-allowance-models">{group.models.map(model => {
        const id = `${group.id}/${model.id}`
        return <label key={id} className="dt-allowance-model" data-on={chosen.has(id) ? 'true' : undefined}>
          <input type="checkbox" checked={chosen.has(id)} onChange={() => toggle(id)} />
          <span className="dt-allowance-name">{model.name}</span>
          <span className="dt-allowance-id">{model.id}</span>
        </label>
      })}</div>
    </div>)}
  </div>
}

/** 合并读取旧数组 sessionModels 与稀疏 sessionModelOverrides，返回紧凑的槽位例外映射（M07-m2）。 */
function collectOverrides(
  sessionModels: readonly (RoleModel | null)[] | undefined,
  sessionModelOverrides: Record<string, RoleModel> | undefined,
): Record<string, RoleModel> {
  const out: Record<string, RoleModel> = {}
  if (Array.isArray(sessionModels)) {
    for (let i = 0; i < sessionModels.length; i++) {
      const m = sessionModels[i]
      if (m) out[String(i)] = m
    }
  }
  if (sessionModelOverrides) {
    for (const [k, m] of Object.entries(sessionModelOverrides)) {
      if (m) out[k] = m
    }
  }
  return out
}

/** 计算当前页周边可见的分页窗口（始终含首页、当前页邻近页与末页，配合上一页/下一页和编号直达确保 1..N 全可达，M07-m1）。 */
function visiblePages(activeBatch: number, batchCount: number): number[] {
  if (batchCount <= 9) return Array.from({ length: batchCount }, (_, i) => i)
  const set = new Set<number>([0, batchCount - 1])
  for (let p = Math.max(0, activeBatch - 2); p <= Math.min(batchCount - 1, activeBatch + 2); p++) set.add(p)
  return [...set].sort((a, b) => a - b)
}

export function RoutingSettings() {
  const { t, call } = usePanel()
  const { blocks } = useSettings().settings
  const routing = blocks.routing.value
  const savedOverrides = collectOverrides(routing.sessionModels, routing.sessionModelOverrides)
  const saved = {
    ...routing,
    sessionModels: [] as (RoleModel | null)[],
    sessionModelOverrides: savedOverrides,
    maxSessions: String(routing.maxSessions),
    difficultyThreshold: String(routing.difficultyThreshold),
  }
  const draft = useBlockDraft('routing', saved, blocks.routing.revision,
    value => ({
      ...value,
      sessionModels: [],
      sessionModelOverrides: collectOverrides(value.sessionModels, value.sessionModelOverrides),
      maxSessions: numberOf(value.maxSessions),
      difficultyThreshold: numberOf(value.difficultyThreshold),
    }))
  const value = draft.value
  const edit = (next: Partial<typeof value>) => draft.edit({ ...value, ...next })
  const [batchIndex, setBatchIndex] = useState(0)
  const [jumpText, setJumpText] = useState('')
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const [refreshingModels, setRefreshingModels] = useState(false)
  const refreshCatalog = () => {
    setRefreshingModels(true)
    call?.('GET models')?.then(next => { setCatalog(next); setRefreshingModels(false) }, () => { setRefreshingModels(false) })
  }
  useEffect(() => { refreshCatalog() }, [call])
  const groups = catalog?.groups ?? []
  const multi = value.multiSession === 'auto'
  const totalSlots = Math.max(0, Math.floor(Number(value.maxSessions) || 0))
  const batchSize = 32
  const batchCount = Math.max(1, Math.ceil(totalSlots / batchSize))
  const activeBatch = Math.max(0, Math.min(batchIndex ?? 0, batchCount - 1))
  const batchStart = activeBatch * batchSize
  const batchEnd = Math.min(totalSlots, batchStart + batchSize)
  const overrides = collectOverrides(value.sessionModels, value.sessionModelOverrides)
  const configuredEntries = Object.entries(overrides)
    .map(([k, m]) => [Number(k), m] as const)
    .filter(([idx]) => Number.isInteger(idx) && idx >= 0 && idx < totalSlots)
    .sort((a, b) => a[0] - b[0])
  const visibleSlots = (() => {
    const indices = new Set<number>()
    for (let i = batchStart; i < batchEnd; i++) indices.add(i)
    for (const [idx] of configuredEntries) indices.add(idx)
    if (totalSlots > 0) indices.add(totalSlots - 1)
    return [...indices].sort((a, b) => a - b)
  })()
  const jumpToSlot = (raw?: string) => {
    const num = Math.floor(Number((raw ?? jumpText ?? '').trim()))
    if (!Number.isFinite(num) || num < 1 || num > totalSlots) return
    const targetBatch = Math.floor((num - 1) / batchSize)
    setBatchIndex(targetBatch)
    setJumpText(String(num))
  }
  const updateSlotModel = (index: number, model: RoleModel | null) => {
    // M07-m2: 仅按槽位编号写入稀疏 sessionModelOverrides，不再向 sessionModels 填充海量 null
    const nextOverrides = { ...overrides }
    if (model) nextOverrides[String(index)] = model
    else delete nextOverrides[String(index)]
    edit({ sessionModels: [], sessionModelOverrides: nextOverrides })
  }
  const draftNoticeKind = draft.state?.notice?.kind
  const statusFailed = draftNoticeKind === 'failed' || draftNoticeKind === 'invalid' || draftNoticeKind === 'conflict' || draftNoticeKind === 'unstored'
  const statusTone = statusFailed ? 'danger' : draft.busy ? 'info' : draft.dirty ? 'warning' : 'neutral'
  const statusLabel = statusFailed ? t('routingStatusFailed') : draft.busy ? t('routingStatusSaving') : draft.dirty ? t('routingStatusDirty') : t('routingStatusSaved')
  const pages = visiblePages(activeBatch, batchCount)
  return <div className="dt-form">
    <form className="dt-form" onSubmit={event => { void draft.submit(event) }}>
      <Fields disabled={draft.busy}>
        <div className="dt-form dt-block">
          <div className="dt-row-meta">
            <h2 className="dt-block-title">{t('routingSessions')}<InfoTip text={t('routingIntro')} /></h2>
            <Tag tone={statusTone}>{statusLabel}</Tag>
          </div>
          <Hint>{t('routingPresetNotice')}</Hint>
          <Section title={t('routingMultiSession')} hint={t('routingMultiSessionHint')}>
            <div className="dt-filters">
              <Pill active={!multi} onClick={() => edit({ multiSession: 'single' })}>{t('routingSingle')}</Pill>
              <Pill active={multi} onClick={() => edit({ multiSession: 'auto' })}>{t('routingAuto')}</Pill>
            </div>
          </Section>
          {multi && <>
            <Field label={t('routingMaxSessions')} hint={t('routingMaxSessionsHint')}>
              <Input type="number" min={1} required value={value.maxSessions}
                onChange={event => edit({ maxSessions: event.target.value })} />
            </Field>
            <div className="dt-row-meta">
              <Hint>{t('routingSessionModelHint')}</Hint>
              <Button variant="outline" size="sm" icon={<Icon name="refresh" size={14} />} disabled={refreshingModels}
                onClick={() => refreshCatalog()}>{t('routingModelRefresh')}</Button>
            </div>
            {configuredEntries.length > 0 && <div className="dt-filters">
              <span className="dt-hint">{t('routingConfiguredSlots', { count: configuredEntries.length })}</span>
              {configuredEntries.map(([idx, m]) => <Pill key={`cfg-${idx}`} active={activeBatch === Math.floor(idx / batchSize)}
                onClick={() => setBatchIndex(Math.floor(idx / batchSize))}>
                {`#${idx + 1} ${m.provider}/${m.model}`}
              </Pill>)}
            </div>}
            {batchCount > 1 && <div className="dt-form">
              <div className="dt-filters">
                <Button variant="outline" size="sm" disabled={activeBatch <= 0}
                  onClick={() => setBatchIndex(Math.max(0, activeBatch - 1))}>{t('routingPagePrev')}</Button>
                {pages.map(page => {
                  const start = page * batchSize + 1
                  const end = Math.min(totalSlots, (page + 1) * batchSize)
                  return <Pill key={page} active={activeBatch === page} onClick={() => setBatchIndex(page)}>
                    {t('routingSessionBatch', { start, end })}
                  </Pill>
                })}
                <Button variant="outline" size="sm" disabled={activeBatch >= batchCount - 1}
                  onClick={() => setBatchIndex(Math.min(batchCount - 1, activeBatch + 1))}>{t('routingPageNext')}</Button>
              </div>
              <div className="dt-row-meta">
                <span className="dt-hint">{t('routingPageIndicator', { page: activeBatch + 1, total: batchCount, slots: totalSlots })}</span>
                <label className="dt-row-meta">
                  <span>{t('routingSlotJumpLabel')}</span>
                  <Input id="dt-slot-jump" type="number" min={1} max={totalSlots} placeholder={`1–${totalSlots}`}
                    value={jumpText ?? ''}
                    onChange={event => setJumpText(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); jumpToSlot(event.currentTarget.value) } }} />
                </label>
                <Button variant="outline" size="sm" onClick={() => jumpToSlot()}>{t('routingSlotJumpAction')}</Button>
              </div>
            </div>}
            {visibleSlots.map(index =>
              <Section key={index} title={t('routingSessionModel', { number: index + 1 })}>
                <ModelField id={`dt-session-model-${index}`} value={overrides[String(index)] ?? null}
                  inheritLabel={t('routingModelFollowOrigin')}
                  catalog={catalog}
                  onRefreshCatalog={refreshCatalog}
                  refreshing={refreshingModels}
                  onChange={model => updateSlotModel(index, model)} />
              </Section>)}
            <Field label={t('routingThinking')} hint={t('routingThinkingHint')}>
              <div className="dt-filters">
                {(['auto', 'low', 'medium', 'high'] as const).map(effort => <Pill key={effort} active={value.thinking === effort}
                  onClick={() => edit({ thinking: effort })}>{t(`routingThinking_${effort}`)}</Pill>)}
              </div>
            </Field>
            <Field label={t('routingThreshold')} hint={t('routingThresholdHint')}
              note={t('routingThresholdNote', { percent: value.difficultyThreshold })}>
              <Input type="number" min={LIMITS.difficultyThreshold.min} max={LIMITS.difficultyThreshold.max} required
                value={value.difficultyThreshold} onChange={event => edit({ difficultyThreshold: event.target.value })} />
            </Field>
          </>}
        </div>
        <div className="dt-form dt-block">
          <h2 className="dt-block-title">{t('routingPlacement')}<InfoTip text={t('routingPlacementHint')} /></h2>
          <div className="dt-filters">
            {(['background', 'foreground', 'ask'] as const).map(placement => <Pill key={placement}
              active={value.placement === placement} onClick={() => edit({ placement })}>{t(`routingPlace_${placement}`)}</Pill>)}
          </div>
          <LabelValue label={t('routingPlacementNow')} value={t(`routingPlace_${value.placement}`)} />
        </div>
        <div className="dt-form dt-block">
          <h2 className="dt-block-title">{t('routingModels')}<InfoTip text={t('routingModelsHint')} /></h2>
          <ModelAllowance value={value.allow} groups={groups} onChange={allow => edit({ allow })} />
        </div>
      </Fields>
      <SaveBar {...draft} onDiscard={draft.discard} />
    </form>
    <ConfigHistory blocks={['routing']} />
  </div>
}
