import type { GetScheduleResponse } from '@scanflow/contracts';
import { describe, expect, it } from 'vitest';

import { buildScheduleView, siblingsOf } from './build-schedule-view';

const baseSchedule: GetScheduleResponse = {
  date: '2026-08-03',
  scheduleVersion: 1,
  slotMinutes: 15,
  timezone: 'Asia/Kolkata',
  dayStart: '2026-08-03T02:30:00.000Z',
  dayEnd: '2026-08-03T11:30:00.000Z',
  resources: [
    {
      id: '11111111-1111-4111-8111-111111111101',
      type: 'DOCTOR',
      name: 'Dr. Ada',
      modalities: [],
      displayOrder: 1,
    },
    {
      id: '11111111-1111-4111-8111-111111111102',
      type: 'NMT_ROOM',
      name: 'NMT Room 1',
      modalities: [],
      displayOrder: 2,
    },
    {
      id: '11111111-1111-4111-8111-111111111103',
      type: 'SCAN_ROOM',
      name: 'Scanner 1',
      modalities: ['SPECT'],
      displayOrder: 3,
    },
  ],
  lanes: [],
  appointments: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      patientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      status: 'SCHEDULED',
      templateId: null,
      templateNameAtBooking: 'Uptake study',
      notes: null,
      segments: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
          appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          seq: 1,
          kind: 'SERVICE',
          resourceId: '11111111-1111-4111-8111-111111111101',
          patientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          patientStart: '2026-08-03T02:30:00.000Z',
          patientEnd: '2026-08-03T03:15:00.000Z',
          resourceStart: '2026-08-03T02:30:00.000Z',
          resourceEnd: '2026-08-03T03:15:00.000Z',
          status: 'ACTIVE',
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
          appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          seq: 2,
          kind: 'DELAY',
          resourceId: null,
          patientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          patientStart: '2026-08-03T03:15:00.000Z',
          patientEnd: '2026-08-03T04:15:00.000Z',
          resourceStart: null,
          resourceEnd: null,
          status: 'ACTIVE',
        },
      ],
    },
  ],
};

describe('buildScheduleView', () => {
  it('builds resource lanes plus a single patient lane', () => {
    const view = buildScheduleView(baseSchedule);
    expect(view.lanes.map((l) => l.label)).toEqual([
      'Dr. Ada',
      'NMT Room 1',
      'Scanner 1',
      'Patient',
    ]);
    expect(view.totalSlots).toBe(36);
    expect(view.timeLabels[0]).toBe('08:00');
  });

  it('places delays on the patient lane and services on their resource', () => {
    const view = buildScheduleView(baseSchedule);
    const service = view.segments.find((s) => s.kind === 'SERVICE');
    const delay = view.segments.find((s) => s.kind === 'DELAY');
    expect(service?.laneKey).toBe('11111111-1111-4111-8111-111111111101');
    expect(delay?.laneKey).toBe('patient');
    expect(delay?.label).toMatch(/Wait/);
  });

  it('collects sibling segment ids for an appointment', () => {
    const view = buildScheduleView(baseSchedule);
    const ids = siblingsOf(
      view.segments,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    );
    expect(ids.size).toBe(2);
  });
});
