/**
 * 上下文与预算设置组：什么时候归档交接、长任务要不要打断你、一天最多花多少 token。
 *
 * 这三项都是「谁掏钱、谁被打扰」的决定，所以逐项写在设置里，不藏进代码。
 */
import { LIMITS } from '../limits.ts'
import { InfoTip, Input, Pill, Switch } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { ConfigHistory, Field, Fields, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { usePanel } from './provider.tsx'
import { Hint, Section } from './widgets.tsx'

export function BudgetSettings() {
  const { t } = usePanel()
  const { blocks } = useSettings().settings
  const budget = blocks.budget.value
  const saved = {
    ...budget,
    archivePercent: String(budget.archivePercent),
    longTaskMinutes: String(budget.longTaskMinutes),
    dailyTokens: String(budget.dailyTokens),
  }
  const draft = useBlockDraft('budget', saved, blocks.budget.revision,
    value => ({ ...value, archivePercent: numberOf(value.archivePercent), longTaskMinutes: numberOf(value.longTaskMinutes),
      dailyTokens: numberOf(value.dailyTokens) }))
  const value = draft.value
  const edit = (next: Partial<typeof value>) => draft.edit({ ...value, ...next })
  return <div className="dt-form">
    <form className="dt-form" onSubmit={event => { void draft.submit(event) }}>
      <Fields disabled={draft.busy}>
        <div className="dt-form dt-block">
          <h2 className="dt-block-title">{t('budgetArchive')}<InfoTip text={t('budgetArchiveHint')} /></h2>
          <Section title={t('budgetArchiveSwitch')} hint={t('budgetArchiveSwitchHint')}>
            <Switch checked={value.archiveEnabled} label={t('budgetArchiveSwitch')} onChange={archiveEnabled => edit({ archiveEnabled })} />
          </Section>
          {value.archiveEnabled && <Field label={t('budgetArchivePercent')} hint={t('budgetArchivePercentHint')}
            note={t('budgetArchivePercentNote', { percent: value.archivePercent })}>
            <Input type="number" min={LIMITS.archivePercent.min} max={LIMITS.archivePercent.max} required
              value={value.archivePercent} onChange={event => edit({ archivePercent: event.target.value })} />
          </Field>}
          <Hint>{t('budgetArchiveApplies')}</Hint>
        </div>
        <div className="dt-form dt-block">
          <h2 className="dt-block-title">{t('budgetLongTask')}<InfoTip text={t('budgetLongTaskHint')} /></h2>
          <Section title={t('budgetNotify')} hint={t('budgetNotifyHint')}>
            <Switch checked={value.notifyLongTask} label={t('budgetNotify')} onChange={notifyLongTask => edit({ notifyLongTask })} />
          </Section>
          {value.notifyLongTask && <Field label={t('budgetLongTaskMinutes')} hint={t('budgetLongTaskMinutesHint')}
            note={t('budgetLongTaskMinutesNote', { minutes: value.longTaskMinutes })}>
            <Input type="number" min={LIMITS.longTaskMinutes.min} max={LIMITS.longTaskMinutes.max} required
              value={value.longTaskMinutes} onChange={event => edit({ longTaskMinutes: event.target.value })} />
          </Field>}
        </div>
        <div className="dt-form dt-block">
          <h2 className="dt-block-title">{t('budgetDaily')}<InfoTip text={t('budgetDailyHint')} /></h2>
          <div className="dt-filters">
            {([0, 2_000_000, 10_000_000, 50_000_000] as const).map(tokens => <Pill key={tokens}
              active={Number(value.dailyTokens) === tokens}
              onClick={() => edit({ dailyTokens: String(tokens) })}>{tokens === 0 ? t('budgetUnlimited') : t('budgetTokens', { tokens: tokens.toLocaleString('en-US') })}</Pill>)}
          </div>
          <Field label={t('budgetDailyTokens')} hint={t('budgetDailyTokensHint')}
            note={t('budgetDailyTokensNote', { tokens: Number(value.dailyTokens) === 0 ? t('budgetUnlimited') : value.dailyTokens })}>
            <Input type="number" min={0} required value={value.dailyTokens}
              onChange={event => edit({ dailyTokens: event.target.value })} />
          </Field>
          <Hint>{t('budgetDailyApplies')}</Hint>
        </div>
      </Fields>
      <SaveBar {...draft} onDiscard={draft.discard} />
    </form>
    <ConfigHistory blocks={['budget']} />
  </div>
}
