import type {
  ChainStep,
  ChainValidationContext,
  ServiceTypeDto,
} from '@scanflow/contracts';
import { parseAppointmentChain } from '@scanflow/contracts';

/** Default tracer uptake wait after injection before the next step may start. */
export const DEFAULT_GAP_AFTER_INJECT_MIN = 30;

export interface ChainSummary {
  stepCount: number;
  serviceMinutes: number;
  minDelayMinutes: number;
  minSpanMinutes: number;
}

export interface ChainIssue {
  path: string[];
  message: string;
  stepIndex?: number;
}

/** Live totals shown under the chain builder. */
export function summarizeChain(steps: readonly ChainStep[]): ChainSummary {
  let serviceMinutes = 0;
  let minDelayMinutes = 0;
  for (const step of steps) {
    serviceMinutes += step.durationMin;
    minDelayMinutes += step.minGapMin;
  }
  return {
    stepCount: steps.length,
    serviceMinutes,
    minDelayMinutes,
    minSpanMinutes: serviceMinutes + minDelayMinutes,
  };
}

/**
 * Reorder by moving `fromIndex` to `toIndex`, then renumber and clear any
 * same-resource link that no longer points at an earlier same-type step.
 */
export function reorderChainSteps(
  steps: readonly ChainStep[],
  fromIndex: number,
  toIndex: number,
  serviceTypes: readonly ServiceTypeDto[],
): ChainStep[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= steps.length ||
    toIndex >= steps.length ||
    fromIndex === toIndex
  ) {
    return normalizeChainSteps(steps, serviceTypes);
  }

  const next = [...steps];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return normalizeChainSteps(steps, serviceTypes);
  next.splice(toIndex, 0, moved);
  return normalizeChainSteps(next, serviceTypes);
}

/**
 * Renumber `seq` from 1 and repair or clear `sameResourceAsSeq` so it never
 * dangles, points forward, or crosses resource types.
 */
export function normalizeChainSteps(
  steps: readonly ChainStep[],
  serviceTypes: readonly ServiceTypeDto[],
): ChainStep[] {
  const typeById = new Map(
    serviceTypes.map((service) => [service.id, service.resourceType]),
  );
  const byOldSeq = new Map(steps.map((step) => [step.seq, step]));

  const renumbered = steps.map((step, index) => {
    const seq = index + 1;
    const base: ChainStep = {
      seq,
      serviceTypeId: step.serviceTypeId,
      durationMin: step.durationMin,
      minGapMin: seq === 1 ? 0 : step.minGapMin,
      maxGapMin: seq === 1 ? 0 : step.maxGapMin,
      setupMin: step.setupMin,
      teardownMin: step.teardownMin,
    };

    const oldTarget = step.sameResourceAsSeq;
    if (oldTarget === undefined) return base;

    const targetStep = byOldSeq.get(oldTarget);
    if (targetStep === undefined) return base;

    let resolved = -1;
    for (let i = 0; i < steps.length; i += 1) {
      if (steps[i] === targetStep) {
        resolved = i + 1;
        break;
      }
    }

    const ownType = typeById.get(step.serviceTypeId);
    const targetServiceId =
      resolved > 0 ? steps[resolved - 1]?.serviceTypeId : undefined;
    const targetType =
      targetServiceId === undefined ? undefined : typeById.get(targetServiceId);

    if (
      resolved <= 0 ||
      resolved >= seq ||
      ownType === undefined ||
      targetType !== ownType
    ) {
      return base;
    }

    return { ...base, sameResourceAsSeq: resolved };
  });

  return enforceGapRules(renumbered, serviceTypes);
}

export function validateChainSteps(
  steps: readonly ChainStep[],
  context: ChainValidationContext,
): { ok: true; steps: ChainStep[] } | { ok: false; issues: ChainIssue[] } {
  const result = parseAppointmentChain(steps, context);
  if (result.success) return { ok: true, steps: result.data };

  const issues = result.error.issues.map((issue) => {
    const head = issue.path[0];
    let stepIndex: number | undefined;
    if (typeof head === 'number') stepIndex = head;
    else if (typeof head === 'string' && /^\d+$/.test(head)) {
      stepIndex = Number(head);
    }
    return {
      path: issue.path.map(String),
      message: issue.message,
      ...(stepIndex === undefined ? {} : { stepIndex }),
    };
  });
  return { ok: false, issues };
}

/** True when the shared Zod chain rules accept this chain. */
export function chainIsValid(
  steps: readonly ChainStep[],
  context: ChainValidationContext,
): boolean {
  return validateChainSteps(steps, context).ok;
}

export function blankStep(
  serviceTypeId: string,
  seq: number,
  options: {
    afterStep?: ChainStep;
    serviceTypes?: readonly ServiceTypeDto[];
  } = {},
): ChainStep {
  const base: ChainStep = {
    seq,
    serviceTypeId,
    durationMin: 30,
    minGapMin: 0,
    maxGapMin: 0,
    setupMin: 0,
    teardownMin: 0,
  };
  const { afterStep, serviceTypes } = options;
  if (
    afterStep !== undefined &&
    serviceTypes !== undefined &&
    isInjectStep(afterStep, serviceTypes)
  ) {
    return defaultGapAfterInject(base);
  }
  return base;
}

/** Earlier steps of the same resource type — options for sameResourceAsSeq. */
export function sameResourceOptions(
  steps: readonly ChainStep[],
  stepIndex: number,
  serviceTypes: readonly ServiceTypeDto[],
): { seq: number; label: string }[] {
  const current = steps[stepIndex];
  if (current === undefined || stepIndex === 0) return [];
  const typeById = new Map(
    serviceTypes.map((service) => [service.id, service.resourceType]),
  );
  const ownType = typeById.get(current.serviceTypeId);
  if (ownType === undefined) return [];

  const options: { seq: number; label: string }[] = [];
  for (let i = 0; i < stepIndex; i += 1) {
    const earlier = steps[i];
    if (earlier === undefined) continue;
    if (typeById.get(earlier.serviceTypeId) !== ownType) continue;
    const service = serviceTypes.find((s) => s.id === earlier.serviceTypeId);
    options.push({
      seq: earlier.seq,
      label: `Step ${String(earlier.seq)}${service === undefined ? '' : ` (${service.name})`}`,
    });
  }
  return options;
}

/** True when the step is tracer injection (NMT room, INJECT service). */
export function isInjectStep(
  step: ChainStep,
  serviceTypes: readonly ServiceTypeDto[],
): boolean {
  const service = serviceTypes.find((s) => s.id === step.serviceTypeId);
  return service?.code === 'INJECT';
}

/**
 * Gaps are only allowed immediately after injection — stored on the following
 * step. Every other step's gap-before fields are cleared.
 */
export function enforceGapRules(
  steps: readonly ChainStep[],
  serviceTypes: readonly ServiceTypeDto[],
): ChainStep[] {
  return steps.map((step, index) => {
    if (index === 0) {
      return { ...step, minGapMin: 0, maxGapMin: 0 };
    }
    const previous = steps[index - 1];
    if (previous !== undefined && isInjectStep(previous, serviceTypes)) {
      return step;
    }
    return { ...step, minGapMin: 0, maxGapMin: 0 };
  });
}

/** Applies the default post-injection wait on `following` when gaps are unset. */
export function defaultGapAfterInject(following: ChainStep): ChainStep {
  if (following.minGapMin !== 0 || following.maxGapMin !== 0) {
    return following;
  }
  return {
    ...following,
    minGapMin: DEFAULT_GAP_AFTER_INJECT_MIN,
    maxGapMin: DEFAULT_GAP_AFTER_INJECT_MIN,
  };
}
