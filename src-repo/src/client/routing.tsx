/**
 * Routing settings group: how much autonomy a run gets over Sessions, models, thinking depth and where it runs.
 * Every field here is an operator decision, so each one is explained where it sits rather than in a manual.
 */
import { useEffect, useState } from 'react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { LIMITS } from '../limits.ts'
import { usePanel } from './provider.tsx'
import { Icon, InfoTip, Input, Pill } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { ConfigHistory, Field, Fields, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
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

export function RoutingSettings() {
  const { t, call } = usePanel()
  const { blocks } = useSettings().settings
  const routing = blocks.routing.value
  const saved = { ...routing, difficultyThreshold: String(routing.difficultyThreshold) }
  const draft = useBlockDraft('routing', saved, blocks.routing.revision,
    value => ({ ...value, difficultyThreshold: numberOf(value.difficultyThreshold) }))
  const value = draft.value
  const edit = (next: Partial<typeof value>) => draft.edit({ ...value, ...next })
  const [catalog, setCatalog] = useState<ModelCatalog>()
  useEffect(() => { call('GET models').then(setCatalog, () => undefined) }, [call])
  const groups = catalog?.groups ?? []
  const multi = value.multiSession === 'auto'
  return <div className="dt-form">
    <form className="dt-form" onSubmit={event => { void draft.submit(event) }}>
      <Fields disabled={draft.busy}>
        <div className="dt-form dt-block">
          <h2 className="dt-block-title">{t('routingSessions')}<InfoTip text={t('routingIntro')} /></h2>
          <Section title={t('routingMultiSession')} hint={t('routingMultiSessionHint')}>
            <div className="dt-filters">
              <Pill active={!multi} onClick={() => edit({ multiSession: 'single' })}>{t('routingSingle')}</Pill>
              <Pill active={multi} onClick={() => edit({ multiSession: 'auto' })}>{t('routingAuto')}</Pill>
            </div>
          </Section>
          {multi && <>
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
