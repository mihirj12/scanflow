import type {
  ChainStep,
  ChainValidationContext,
  ServiceTypeDto,
} from '@scanflow/contracts';
import { isGapMaxUnbounded } from '@scanflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactElement } from 'react';

import { fetchTemplate, fetchTemplateSummaries } from '../api/client';

import {
  blankStep,
  defaultGapAfterInject,
  isInjectStep,
  normalizeChainSteps,
  reorderChainSteps,
  sameResourceOptions,
  summarizeChain,
  validateChainSteps,
  type ChainIssue,
} from './chain-editor';

export interface ChainBuilderProps {
  steps: ChainStep[];
  onChange: (next: {
    steps: ChainStep[];
    templateId: string | null;
    templateName: string | null;
    modified: boolean;
  }) => void;
  serviceTypes: readonly ServiceTypeDto[];
  validationContext: ChainValidationContext;
  templateId: string | null;
  templateName: string | null;
  modified: boolean;
}

export function ChainBuilder({
  steps,
  onChange,
  serviceTypes,
  validationContext,
  templateId,
  templateName,
  modified,
}: ChainBuilderProps): ReactElement {
  const templates = useQuery({
    queryKey: ['appointment-templates'],
    queryFn: fetchTemplateSummaries,
  });

  const validation = validateChainSteps(steps, validationContext);
  const issuesByStep = groupIssues(validation.ok ? [] : validation.issues);
  const summary = summarizeChain(steps);

  const header =
    templateName === null
      ? 'Blank chain'
      : modified
        ? `${templateName} (modified)`
        : templateName;

  function emit(
    nextSteps: ChainStep[],
    extras: { markModified?: boolean; clearTemplate?: boolean } = {},
  ): void {
    const normalised = normalizeChainSteps(nextSteps, serviceTypes);
    onChange({
      steps: normalised,
      templateId: extras.clearTemplate === true ? null : templateId,
      templateName: extras.clearTemplate === true ? null : templateName,
      modified:
        extras.markModified === true ||
        modified ||
        extras.clearTemplate === true,
    });
  }

  async function loadPreset(id: string): Promise<void> {
    if (id === '') {
      onChange({
        steps: serviceTypes[0] ? [blankStep(serviceTypes[0].id, 1)] : [],
        templateId: null,
        templateName: null,
        modified: false,
      });
      return;
    }
    const detail = await fetchTemplate(id);
    onChange({
      steps: normalizeChainSteps(detail.steps, serviceTypes),
      templateId: detail.id,
      templateName: detail.name,
      modified: false,
    });
  }

  return (
    <div className="chain-builder">
      <label className="field">
        <span className="field__label">Start from</span>
        <select
          value={templateId ?? ''}
          onChange={(event) => {
            void loadPreset(event.target.value);
          }}
        >
          <option value="">Blank chain</option>
          {(templates.data?.items ?? [])
            .filter((t) => t.active)
            .map((template) => (
              <option key={template.id} value={template.id}>
                {template.code} — {template.name}
              </option>
            ))}
        </select>
      </label>

      <h3 className="chain-builder__title">{header}</h3>

      <ol className="chain-builder__list">
        {steps.map((step, index) => (
          <li
            key={`step-${String(step.seq)}-${step.serviceTypeId}`}
            className="chain-step"
          >
            <div className="chain-step__toolbar">
              <span className="chain-step__seq">Step {step.seq}</span>
              <button
                type="button"
                className="btn btn--ghost btn--compact"
                aria-label={`Move step ${String(step.seq)} up`}
                disabled={index === 0}
                onClick={() => {
                  emit(
                    reorderChainSteps(steps, index, index - 1, serviceTypes),
                    {
                      markModified: true,
                    },
                  );
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--compact"
                aria-label={`Move step ${String(step.seq)} down`}
                disabled={index === steps.length - 1}
                onClick={() => {
                  emit(
                    reorderChainSteps(steps, index, index + 1, serviceTypes),
                    {
                      markModified: true,
                    },
                  );
                }}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--compact"
                aria-label={`Remove step ${String(step.seq)}`}
                disabled={steps.length <= 1}
                onClick={() => {
                  emit(
                    steps.filter((_, i) => i !== index),
                    { markModified: true },
                  );
                }}
              >
                Remove
              </button>
            </div>

            <label className="field">
              <span className="field__label">Service</span>
              <select
                value={step.serviceTypeId}
                onChange={(event) => {
                  let next = steps.map((s, i) =>
                    i === index
                      ? { ...s, serviceTypeId: event.target.value }
                      : s,
                  );
                  const changed = next[index];
                  if (
                    changed !== undefined &&
                    isInjectStep(changed, serviceTypes) &&
                    index < next.length - 1
                  ) {
                    next = next.map((s, i) =>
                      i === index + 1 ? defaultGapAfterInject(s) : s,
                    );
                  }
                  emit(next, { markModified: true });
                }}
              >
                {serviceTypes.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} ({service.resourceType})
                  </option>
                ))}
              </select>
            </label>

            <div className="field field--row">
              <span className="field__label">Duration</span>
              <div className="stepper">
                <button
                  type="button"
                  className="btn btn--ghost btn--compact"
                  aria-label="Decrease duration"
                  onClick={() => {
                    const next = steps.map((s, i) =>
                      i === index
                        ? {
                            ...s,
                            durationMin: Math.max(
                              validationContext.slotMinutes,
                              s.durationMin - validationContext.slotMinutes,
                            ),
                          }
                        : s,
                    );
                    emit(next, { markModified: true });
                  }}
                >
                  −
                </button>
                <span className="stepper__value">{step.durationMin} min</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--compact"
                  aria-label="Increase duration"
                  onClick={() => {
                    const next = steps.map((s, i) =>
                      i === index
                        ? {
                            ...s,
                            durationMin:
                              s.durationMin + validationContext.slotMinutes,
                          }
                        : s,
                    );
                    emit(next, { markModified: true });
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {isInjectStep(step, serviceTypes) && index < steps.length - 1
              ? (() => {
                  const following = steps[index + 1];
                  if (following === undefined) return null;
                  const maxLimited =
                    !isGapMaxUnbounded(following) && following.minGapMin > 0;
                  return (
                    <div className="field field--row">
                      <span className="field__label">
                        Gap after injection (minimum
                        {maxLimited ? ' / maximum' : ''})
                      </span>
                      <div className="stepper stepper--gap">
                        <MinuteStepper
                          label="Minimum wait after injection"
                          value={following.minGapMin}
                          slotMinutes={validationContext.slotMinutes}
                          onChange={(minGapMin) => {
                            const next = steps.map((s, i) => {
                              if (i !== index + 1) return s;
                              const maxUnbounded = isGapMaxUnbounded(s);
                              return {
                                ...s,
                                minGapMin,
                                maxGapMin: maxUnbounded
                                  ? 0
                                  : minGapMin === 0
                                    ? 0
                                    : Math.max(s.maxGapMin, minGapMin),
                              };
                            });
                            emit(next, { markModified: true });
                          }}
                        />
                        <label className="patient-window__toggle patient-window__toggle--compact">
                          <input
                            type="checkbox"
                            checked={maxLimited}
                            disabled={following.minGapMin === 0}
                            onChange={(event) => {
                              const next = steps.map((s, i) => {
                                if (i !== index + 1) return s;
                                if (event.target.checked) {
                                  return {
                                    ...s,
                                    maxGapMin: Math.max(
                                      s.minGapMin,
                                      s.maxGapMin > 0
                                        ? s.maxGapMin
                                        : s.minGapMin,
                                    ),
                                  };
                                }
                                return { ...s, maxGapMin: 0 };
                              });
                              emit(next, { markModified: true });
                            }}
                          />
                          <span>Limit maximum wait</span>
                        </label>
                        {maxLimited ? (
                          <MinuteStepper
                            label="Maximum wait after injection"
                            value={following.maxGapMin}
                            slotMinutes={validationContext.slotMinutes}
                            onChange={(maxGapMin) => {
                              const next = steps.map((s, i) =>
                                i === index + 1
                                  ? {
                                      ...s,
                                      maxGapMin,
                                      minGapMin: Math.min(
                                        s.minGapMin,
                                        maxGapMin,
                                      ),
                                    }
                                  : s,
                              );
                              emit(next, { markModified: true });
                            }}
                          />
                        ) : following.minGapMin > 0 ? (
                          <span className="stepper__value stepper__value--muted">
                            No maximum
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })()
              : null}

            {(() => {
              const options = sameResourceOptions(steps, index, serviceTypes);
              if (options.length === 0) return null;
              return (
                <label className="field">
                  <span className="field__label">Same resource as</span>
                  <select
                    value={step.sameResourceAsSeq ?? ''}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const next = steps.map((s, i) => {
                        if (i !== index) return s;
                        if (raw === '') {
                          return {
                            seq: s.seq,
                            serviceTypeId: s.serviceTypeId,
                            durationMin: s.durationMin,
                            minGapMin: s.minGapMin,
                            maxGapMin: s.maxGapMin,
                            setupMin: s.setupMin,
                            teardownMin: s.teardownMin,
                          };
                        }
                        return { ...s, sameResourceAsSeq: Number(raw) };
                      });
                      emit(next, { markModified: true });
                    }}
                  >
                    <option value="">Any matching resource</option>
                    {options.map((option) => (
                      <option key={option.seq} value={option.seq}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })()}

            {(issuesByStep.get(index) ?? []).map((issue) => (
              <p
                key={issue.path.join('.') + issue.message}
                className="field__error"
                role="alert"
              >
                {issue.message}
              </p>
            ))}
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => {
          const first = serviceTypes[0];
          if (first === undefined) return;
          const last = steps[steps.length - 1];
          emit(
            [
              ...steps,
              blankStep(first.id, steps.length + 1, {
                ...(last === undefined
                  ? {}
                  : { afterStep: last, serviceTypes }),
              }),
            ],
            { markModified: true },
          );
        }}
      >
        Add step
      </button>

      <dl className="chain-summary">
        <div>
          <dt>Steps</dt>
          <dd>{summary.stepCount}</dd>
        </div>
        <div>
          <dt>Service time</dt>
          <dd>{summary.serviceMinutes} min</dd>
        </div>
        <div>
          <dt>Minimum delay</dt>
          <dd>{summary.minDelayMinutes} min</dd>
        </div>
        <div>
          <dt>Minimum span</dt>
          <dd>{summary.minSpanMinutes} min</dd>
        </div>
      </dl>

      {!validation.ok
        ? validation.issues
            .filter((issue) => issue.stepIndex === undefined)
            .map((issue) => (
              <p key={issue.message} className="field__error" role="alert">
                {issue.message}
              </p>
            ))
        : null}
    </div>
  );
}

function MinuteStepper({
  label,
  value,
  slotMinutes,
  onChange,
}: {
  label: string;
  value: number;
  slotMinutes: number;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <div className="stepper" aria-label={label}>
      <button
        type="button"
        className="btn btn--ghost btn--compact"
        aria-label={`Decrease ${label}`}
        onClick={() => {
          onChange(Math.max(0, value - slotMinutes));
        }}
      >
        −
      </button>
      <span className="stepper__value">{value} min</span>
      <button
        type="button"
        className="btn btn--ghost btn--compact"
        aria-label={`Increase ${label}`}
        onClick={() => {
          onChange(value + slotMinutes);
        }}
      >
        +
      </button>
    </div>
  );
}

function groupIssues(issues: ChainIssue[]): Map<number, ChainIssue[]> {
  const map = new Map<number, ChainIssue[]>();
  for (const issue of issues) {
    if (issue.stepIndex === undefined) continue;
    const list = map.get(issue.stepIndex) ?? [];
    list.push(issue);
    map.set(issue.stepIndex, list);
  }
  return map;
}
