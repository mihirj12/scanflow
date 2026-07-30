import type { CandidateDto, ChainStep } from '@scanflow/contracts';
import { describe, expect, it } from 'vitest';

import { candidateToGhosts, describeCandidate } from './ghost-preview';

const dayStart = '2026-08-03T02:30:00.000Z'; // 08:00 Asia/Kolkata

describe('candidateToGhosts', () => {
  it('places a service on its resource lane and a delay on patient', () => {
    const candidate: CandidateDto = {
      start: '2026-08-03T02:30:00.000Z',
      end: '2026-08-03T04:00:00.000Z',
      spanMinutes: 90,
      incidentalGapMinutes: 0,
      placements: [
        {
          seq: 1,
          kind: 'SERVICE',
          resourceId: 'res-doctor',
          patientStart: '2026-08-03T02:30:00.000Z',
          patientEnd: '2026-08-03T03:00:00.000Z',
          resourceStart: '2026-08-03T02:30:00.000Z',
          resourceEnd: '2026-08-03T03:00:00.000Z',
        },
        {
          seq: 2,
          kind: 'DELAY',
          resourceId: null,
          patientStart: '2026-08-03T03:00:00.000Z',
          patientEnd: '2026-08-03T04:00:00.000Z',
          resourceStart: null,
          resourceEnd: null,
        },
      ],
    };

    const ghosts = candidateToGhosts(
      candidate,
      [
        {
          key: 'res-doctor',
          label: 'Dr',
          kind: 'RESOURCE',
          resourceType: 'DOCTOR',
        },
        { key: 'patient', label: 'Patient', kind: 'PATIENT' },
      ],
      dayStart,
      15,
      36,
    );

    expect(ghosts).toHaveLength(2);
    expect(ghosts[0]?.laneKey).toBe('res-doctor');
    expect(ghosts[0]?.startRow).toBe(2);
    expect(ghosts[0]?.rowSpan).toBe(2);
    expect(ghosts[1]?.laneKey).toBe('patient');
    expect(ghosts[1]?.kind).toBe('DELAY');
    expect(ghosts[1]?.rowSpan).toBe(4);
  });
});

describe('describeCandidate', () => {
  it('notes when a mandatory wait is stretched', () => {
    const steps: ChainStep[] = [
      {
        seq: 1,
        serviceTypeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        durationMin: 30,
        minGapMin: 0,
        maxGapMin: 0,
        setupMin: 0,
        teardownMin: 0,
      },
      {
        seq: 2,
        serviceTypeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        durationMin: 30,
        minGapMin: 60,
        maxGapMin: 90,
        setupMin: 0,
        teardownMin: 0,
      },
    ];
    const candidate: CandidateDto = {
      start: '2026-08-03T02:30:00.000Z',
      end: '2026-08-03T05:15:00.000Z',
      spanMinutes: 165,
      incidentalGapMinutes: 15,
      placements: [
        {
          seq: 2,
          kind: 'DELAY',
          resourceId: null,
          patientStart: '2026-08-03T03:00:00.000Z',
          patientEnd: '2026-08-03T04:15:00.000Z',
          resourceStart: null,
          resourceEnd: null,
        },
      ],
    };
    const copy = describeCandidate(candidate, steps, 'Asia/Kolkata', true);
    expect(copy.badge).toBe('Tightest fit');
    expect(copy.delayNotes[0]).toMatch(/extended to 75 min/);
  });
});
