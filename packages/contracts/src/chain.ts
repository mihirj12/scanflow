import { z } from 'zod';

import type { ResourceType } from './enums.js';

/**
 * One step of an appointment chain as the receptionist builds it — minutes, not
 * slots, and a service type rather than a bare resource type.
 *
 * The engine speaks slots and resource types. Conversion and lookup happen at
 * the API boundary; this shape is what both the wizard and the booking endpoints
 * agree on (ADR 0002).
 */
export const chainStepSchema = z.object({
  seq: z.number().int().positive(),
  serviceTypeId: z.uuid(),
  durationMin: z.number().int().positive(),
  minGapMin: z.number().int().nonnegative().default(0),
  maxGapMin: z.number().int().nonnegative().default(0),
  setupMin: z.number().int().nonnegative().default(0),
  teardownMin: z.number().int().nonnegative().default(0),
  sameResourceAsSeq: z.number().int().positive().optional(),
});

export type ChainStep = z.infer<typeof chainStepSchema>;

/** A service type looked up so the chain rules can reason about resource type. */
export interface ChainServiceType {
  id: string;
  resourceType: ResourceType;
  requiredModality: string | null;
}

/** An active resource, used only for rule 9 (modality coverage). */
export interface ChainResource {
  type: ResourceType;
  modalities: readonly string[];
  active: boolean;
}

/**
 * Clinic facts the nine chain rules need and the steps themselves do not carry.
 *
 * Rule 9 needs the clinic's inventory: a chain that can never be scheduled
 * should fail at build time, not return an empty suggestion list.
 */
export interface ChainValidationContext {
  /** Clinic slot length in minutes. Durations and gaps must be multiples of it. */
  slotMinutes: number;
  /**
   * Length of the working day in minutes (`day_end - day_start`). Rule 8 rejects
   * a chain whose minimum span cannot fit inside it.
   */
  dayMinutes: number;
  serviceTypes: readonly ChainServiceType[];
  resources: readonly ChainResource[];
}

/**
 * Validates an ad-hoc chain against the nine rules in spec 2.9.
 *
 * Shared by the wizard and the API so live feedback and server authority run
 * identical logic. Returns every problem found — naming the offending step —
 * rather than stopping at the first, so one round trip can fix them all.
 *
 * @param steps - The chain as submitted. Empty is a problem, not a vacuously
 *   valid input.
 * @param context - Clinic facts the steps do not carry.
 * @returns A successful Zod parse of the normalised steps, or a failure whose
 *   `error.issues` name every broken rule.
 */
export function parseAppointmentChain(
  steps: unknown,
  context: ChainValidationContext,
): z.ZodSafeParseResult<ChainStep[]> {
  const parsed = z.array(chainStepSchema).safeParse(steps);
  if (!parsed.success) return parsed;

  const issues: z.core.$ZodIssue[] = [];
  const chain = parsed.data;
  const serviceById = new Map(
    context.serviceTypes.map((service) => [service.id, service]),
  );

  if (chain.length === 0) {
    issues.push({
      code: 'custom',
      path: [],
      message: 'A chain needs at least one step.',
    });
  }

  chain.forEach((step, index) => {
    const expectedSeq = index + 1;
    const at = `step ${String(step.seq)}`;

    if (step.seq !== expectedSeq) {
      issues.push({
        code: 'custom',
        path: [index, 'seq'],
        message: `Steps must be numbered contiguously from 1; position ${String(index)} has seq ${String(step.seq)}, expected ${String(expectedSeq)}.`,
      });
    }

    if (index === 0 && (step.minGapMin !== 0 || step.maxGapMin !== 0)) {
      // Rule 3: there is no previous step to measure a delay from.
      issues.push({
        code: 'custom',
        path: [index, 'minGapMin'],
        message: `${at}: the first step cannot have a gap before it (minGapMin and maxGapMin must both be 0).`,
      });
    }

    if (step.durationMin % context.slotMinutes !== 0) {
      issues.push({
        code: 'custom',
        path: [index, 'durationMin'],
        message: `${at}: durationMin (${String(step.durationMin)}) must be a multiple of the clinic's ${String(context.slotMinutes)}-minute slots. Shorten or lengthen the step — durations are not rounded.`,
      });
    }
    if (step.minGapMin % context.slotMinutes !== 0) {
      issues.push({
        code: 'custom',
        path: [index, 'minGapMin'],
        message: `${at}: minGapMin (${String(step.minGapMin)}) must be a multiple of ${String(context.slotMinutes)} minutes.`,
      });
    }
    if (step.maxGapMin % context.slotMinutes !== 0) {
      issues.push({
        code: 'custom',
        path: [index, 'maxGapMin'],
        message: `${at}: maxGapMin (${String(step.maxGapMin)}) must be a multiple of ${String(context.slotMinutes)} minutes.`,
      });
    }
    if (step.setupMin % context.slotMinutes !== 0) {
      issues.push({
        code: 'custom',
        path: [index, 'setupMin'],
        message: `${at}: setupMin (${String(step.setupMin)}) must be a multiple of ${String(context.slotMinutes)} minutes.`,
      });
    }
    if (step.teardownMin % context.slotMinutes !== 0) {
      issues.push({
        code: 'custom',
        path: [index, 'teardownMin'],
        message: `${at}: teardownMin (${String(step.teardownMin)}) must be a multiple of ${String(context.slotMinutes)} minutes.`,
      });
    }

    if (step.maxGapMin < step.minGapMin) {
      issues.push({
        code: 'custom',
        path: [index, 'maxGapMin'],
        message: `${at}: maxGapMin (${String(step.maxGapMin)}) must be at least minGapMin (${String(step.minGapMin)}).`,
      });
    }

    const service = serviceById.get(step.serviceTypeId);
    if (service === undefined) {
      issues.push({
        code: 'custom',
        path: [index, 'serviceTypeId'],
        message: `${at}: unknown serviceTypeId.`,
      });
    }
  });

  // sameResourceAsSeq needs a complete type map, so it runs after the walk above.
  const typeBySeq = new Map<number, ResourceType>();
  for (const step of chain) {
    const service = serviceById.get(step.serviceTypeId);
    if (service !== undefined) typeBySeq.set(step.seq, service.resourceType);
  }

  chain.forEach((step, index) => {
    const target = step.sameResourceAsSeq;
    if (target === undefined) return;
    const at = `step ${String(step.seq)}`;

    if (target >= step.seq) {
      issues.push({
        code: 'custom',
        path: [index, 'sameResourceAsSeq'],
        message: `${at}: sameResourceAsSeq must reference an earlier step, got ${String(target)}.`,
      });
      return;
    }

    const targetType = typeBySeq.get(target);
    const ownType = typeBySeq.get(step.seq);
    if (targetType === undefined) {
      issues.push({
        code: 'custom',
        path: [index, 'sameResourceAsSeq'],
        message: `${at}: sameResourceAsSeq references step ${String(target)}, which does not exist.`,
      });
    } else if (ownType !== undefined && targetType !== ownType) {
      // Pointing a scan at a doctor is nonsense and must be rejected, not
      // silently ignored (spec 2.9 rule 7).
      issues.push({
        code: 'custom',
        path: [index, 'sameResourceAsSeq'],
        message: `${at}: sameResourceAsSeq references step ${String(target)} of type ${targetType}, but this step needs a ${ownType}.`,
      });
    }
  });

  if (chain.length > 0) {
    const minSpan = chain.reduce(
      (sum, step) => sum + step.durationMin + step.minGapMin,
      0,
    );
    if (minSpan > context.dayMinutes) {
      issues.push({
        code: 'custom',
        path: [],
        message: `This chain needs at least ${String(minSpan)} minutes and the working day is only ${String(context.dayMinutes)} minutes. Shorten a step or a mandatory delay, or split the visit across days.`,
      });
    }
  }

  // Rule 9: every step's resource type (and modality, if any) must be provided
  // by at least one active resource. A chain that can never be scheduled should
  // fail here, not return an empty suggestion list.
  const active = context.resources.filter((resource) => resource.active);
  chain.forEach((step, index) => {
    const service = serviceById.get(step.serviceTypeId);
    if (service === undefined) return;
    const matches = active.filter((resource) => {
      if (resource.type !== service.resourceType) return false;
      const modality = service.requiredModality;
      return modality === null || resource.modalities.includes(modality);
    });
    if (matches.length === 0) {
      const modalityNote =
        service.requiredModality === null
          ? ''
          : ` with modality '${service.requiredModality}'`;
      issues.push({
        code: 'custom',
        path: [index, 'serviceTypeId'],
        message: `step ${String(step.seq)}: no active ${service.resourceType} resource${modalityNote} is available. Add a resource or change the step's service type.`,
      });
    }
  });

  if (issues.length > 0) {
    return {
      success: false as const,
      error: new z.ZodError(issues) as z.ZodError<ChainStep[]>,
    };
  }

  return { success: true as const, data: chain };
}
