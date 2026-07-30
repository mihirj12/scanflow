#!/usr/bin/env node
/**
 * Benchmarks `suggestPlacements` on the worst case the spec cares about: six
 * steps, four resources per type, wide gap windows, and a day that is half
 * booked (spec 4.7).
 *
 * A stated performance bound is only worth something if it is measured on the
 * hard case, so nothing here is tuned to flatter the engine. The gap windows
 * are as wide as the clinic would ever use, which is what makes the search
 * space large; the occupancy is dense enough that the tightest layout is
 * usually unavailable, which is what stops the bound from ending the search
 * early.
 *
 * The occupancy is pseudo-random from a fixed seed rather than `Math.random`,
 * so a regression is a real regression and not a bad roll.
 */
import { suggestPlacements } from '../dist/index.js';

const TOTAL_SLOTS = 36;
const OCCUPANCY = 0.5;
const RESOURCES_PER_TYPE = 4;
const WARMUP_RUNS = 50;
const MEASURED_RUNS = 300;
const BUDGET_MS = 50;

/**
 * Six steps with wide gap windows: a doctor bookending the visit, an injection,
 * two scan sessions on one scanner, and a late processing step. Minimum span is
 * 17 of the day's 36 slots, leaving plenty of room for the search to explore.
 */
const STEPS = [
  {
    seq: 1,
    resourceType: 'DOCTOR',
    durationSlots: 3,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 0,
  },
  {
    seq: 2,
    resourceType: 'NMT_ROOM',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 4,
  },
  {
    seq: 3,
    resourceType: 'SCAN_ROOM',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 4,
    maxGapSlots: 10,
  },
  {
    seq: 4,
    resourceType: 'SCAN_ROOM',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 6,
    sameResourceAsSeq: 3,
  },
  {
    seq: 5,
    resourceType: 'DOCTOR',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 8,
    sameResourceAsSeq: 1,
  },
  {
    seq: 6,
    resourceType: 'NMT_ROOM',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 8,
  },
];

/** Small deterministic PRNG, so every run measures the same days. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = state;
    drawn = Math.imul(drawn ^ (drawn >>> 15), drawn | 1);
    drawn ^= drawn + Math.imul(drawn ^ (drawn >>> 7), drawn | 61);
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The chain above, but the final step needs a modality only one scarce resource
 * provides. Steps 1 to 5 then explore freely and the search fails at full
 * depth, which is the shape a branch-and-bound handles worst: no good candidate
 * ever arrives to tighten the bound with.
 */
const STEPS_WITH_SCARCE_TAIL = STEPS.map((step) =>
  step.seq === STEPS.length ? { ...step, requiredModality: 'HOT_LAB' } : step,
);

function randomMask(random, density) {
  let mask = 0n;
  for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
    if (random() < density) mask |= 1n << BigInt(slot);
  }
  return mask;
}

function buildRequest(seed, scenario) {
  const random = mulberry32(seed);
  const resources = [];

  for (const type of ['DOCTOR', 'NMT_ROOM', 'SCAN_ROOM']) {
    for (let index = 0; index < RESOURCES_PER_TYPE; index++) {
      resources.push({
        id: `${type}-${index}`,
        type,
        modalities: [],
        busyMask: randomMask(random, OCCUPANCY),
      });
    }
  }

  if (scenario.scarceTail) {
    resources.push({
      id: 'NMT_ROOM-hot-lab',
      type: 'NMT_ROOM',
      modalities: ['HOT_LAB'],
      busyMask: randomMask(random, 0.95),
    });
  }

  return {
    totalSlots: TOTAL_SLOTS,
    steps: scenario.scarceTail ? STEPS_WITH_SCARCE_TAIL : STEPS,
    resources,
    // A patient being booked is free; a half-booked patient would make the
    // chain unschedulable and the measurement meaningless.
    patientBusyMask: 0n,
    maxCandidates: 5,
  };
}

function percentile(sorted, fraction) {
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

const format = (value) => `${value.toFixed(2)} ms`;

function measure(name, description, scenario) {
  const requests = [];
  for (let seed = 0; seed < WARMUP_RUNS + MEASURED_RUNS; seed++) {
    requests.push(buildRequest(seed, scenario));
  }

  for (let run = 0; run < WARMUP_RUNS; run++) {
    suggestPlacements(requests[run]);
  }

  const durations = [];
  let solved = 0;
  let candidates = 0;
  for (let run = 0; run < MEASURED_RUNS; run++) {
    const request = requests[WARMUP_RUNS + run];
    const started = performance.now();
    const result = suggestPlacements(request);
    durations.push(performance.now() - started);
    if (result.length > 0) solved++;
    candidates += result.length;
  }

  durations.sort((left, right) => left - right);
  const p95 = percentile(durations, 0.95);
  const mean =
    durations.reduce((sum, value) => sum + value, 0) / durations.length;

  process.stdout.write(
    [
      `${name}`,
      `  case          ${description}`,
      `  runs          ${String(MEASURED_RUNS)} days (after ${String(WARMUP_RUNS)} warmup)`,
      `  schedulable   ${String(solved)}/${String(MEASURED_RUNS)} days, ${(candidates / MEASURED_RUNS).toFixed(1)} candidates each`,
      `  mean          ${format(mean)}`,
      `  p50           ${format(percentile(durations, 0.5))}`,
      `  p95           ${format(p95)}`,
      `  p99           ${format(percentile(durations, 0.99))}`,
      `  max           ${format(durations[durations.length - 1])}`,
      '',
    ].join('\n'),
  );

  return p95;
}

process.stdout.write('suggestPlacements benchmark\n\n');

const results = [
  {
    name: 'spec worst case',
    p95: measure(
      'spec worst case',
      `6 steps, ${String(RESOURCES_PER_TYPE)} per type, wide gaps, ${String(OCCUPANCY * 100)}% occupancy`,
      { scarceTail: false },
    ),
  },
  {
    name: 'deep dead ends',
    p95: measure(
      'deep dead ends',
      'same chain, final step needs a modality only one 95%-booked resource has',
      { scarceTail: true },
    ),
  },
];

const worst = results.reduce((left, right) =>
  right.p95 > left.p95 ? right : left,
);

if (worst.p95 >= BUDGET_MS) {
  process.stderr.write(
    `benchmark failed: p95 of ${format(worst.p95)} on '${worst.name}' exceeds the ${format(BUDGET_MS)} budget\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `worst p95 across cases: ${format(worst.p95)} on '${worst.name}', within the ${format(BUDGET_MS)} budget\n`,
);
