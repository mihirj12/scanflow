import type {
  ChainStep,
  ChainValidationContext,
  ServiceTypeDto,
} from '@scanflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactElement } from 'react';

import { fetchTemplate, fetchTemplateSummaries } from '../api/client';

import {
  blankStep,
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
                  const next = steps.map((s, i) =>
                    i === index
                      ? { ...s, serviceTypeId: event.target.value }
                      : s,
                  );
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

            {index > 0 ? (
              <div className="field field--row">
                <span className="field__label">Gap before (min / max)</span>
                <div className="stepper">
                  <MinuteStepper
                    label="Minimum gap"
                    value={step.minGapMin}
                    slotMinutes={validationContext.slotMinutes}
                    onChange={(minGapMin) => {
                      const next = steps.map((s, i) =>
                        i === index
                          ? {
                              ...s,
                              minGapMin,
                              maxGapMin: Math.max(s.maxGapMin, minGapMin),
                            }
                          : s,
                      );
                      emit(next, { markModified: true });
                    }}
                  />
                  <MinuteStepper
                    label="Maximum gap"
                    value={step.maxGapMin}
                    slotMinutes={validationContext.slotMinutes}
                    onChange={(maxGapMin) => {
                      const next = steps.map((s, i) =>
                        i === index
                          ? {
                              ...s,
                              maxGapMin,
                              minGapMin: Math.min(s.minGapMin, maxGapMin),
                            }
                          : s,
                      );
                      emit(next, { markModified: true });
                    }}
                  />
                </div>
              </div>
            ) : null}

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
          emit([...steps, blankStep(first.id, steps.length + 1)], {
            markModified: true,
          });
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
