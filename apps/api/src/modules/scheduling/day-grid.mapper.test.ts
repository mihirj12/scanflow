import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import {
  buildBusyMask,
  clinicDayMinutes,
  clinicDayWindow,
  instantToSlot,
  maskOutsidePatientWindow,
  openSlotsForResource,
  slotToInstant,
  wallClockToInstant,
  wallClockToLatestEndSlot,
  type ClinicDayGrid,
} from './day-grid.mapper.js';

const clinic: ClinicDayGrid = {
  timezone: 'Asia/Kolkata',
  dayStart: '08:00',
  dayEnd: '17:00',
  slotMinutes: 15,
};

/** 2026-08-03 is a Monday. */
const DATE = '2026-08-03';

describe('day-grid.mapper', () => {
  it('counts 36 slots in a nine-hour day', () => {
    const { totalSlots } = clinicDayWindow(clinic, DATE);
    expect(totalSlots).toBe(36);
    expect(clinicDayMinutes(clinic, DATE)).toBe(540);
  });

  it('maps slot 0 to 08:00 local and slot 4 to 09:00 local', () => {
    const eight = slotToInstant(clinic, DATE, 0);
    const nine = slotToInstant(clinic, DATE, 4);

    expect(
      DateTime.fromJSDate(eight, { zone: 'utc' })
        .setZone(clinic.timezone)
        .toFormat('HH:mm'),
    ).toBe('08:00');
    expect(
      DateTime.fromJSDate(nine, { zone: 'utc' })
        .setZone(clinic.timezone)
        .toFormat('HH:mm'),
    ).toBe('09:00');
  });

  it('round-trips every slot in the day', () => {
    for (let slot = 0; slot < 36; slot++) {
      const instant = slotToInstant(clinic, DATE, slot);
      expect(instantToSlot(clinic, DATE, instant)).toBe(slot);
    }
  });

  it('rejects an instant exactly at dayEnd', () => {
    const end = slotToInstant(clinic, DATE, 36);
    expect(() => instantToSlot(clinic, DATE, end)).toThrow(
      /outside the clinic day/,
    );
  });

  it('rejects a misaligned instant', () => {
    const eight = DateTime.fromISO(`${DATE}T08:00:00`, {
      zone: clinic.timezone,
    });
    const odd = eight.plus({ minutes: 7 }).toJSDate();
    expect(() => instantToSlot(clinic, DATE, odd)).toThrow(/not aligned/);
  });

  it('builds an empty mask when the day is fully open and empty', () => {
    const open = new Set(Array.from({ length: 36 }, (_, i) => i));
    expect(buildBusyMask(clinic, DATE, [], open)).toBe(0n);
  });

  it('marks closed hours busy when openSlots is a proper subset', () => {
    // Only the morning is open: slots 0..15 (08:00-12:00).
    const open = new Set(Array.from({ length: 16 }, (_, i) => i));
    const mask = buildBusyMask(clinic, DATE, [], open);
    for (let slot = 0; slot < 16; slot++) {
      expect((mask & (1n << BigInt(slot))) === 0n).toBe(true);
    }
    for (let slot = 16; slot < 36; slot++) {
      expect((mask & (1n << BigInt(slot))) !== 0n).toBe(true);
    }
  });

  it('ORs a booking into the mask without disturbing neighbouring slots', () => {
    const open = new Set(Array.from({ length: 36 }, (_, i) => i));
    // 10:00-10:30 local = slots 8 and 9.
    const start = DateTime.fromISO(`${DATE}T10:00:00`, {
      zone: clinic.timezone,
    }).toJSDate();
    const end = DateTime.fromISO(`${DATE}T10:30:00`, {
      zone: clinic.timezone,
    }).toJSDate();
    const mask = buildBusyMask(clinic, DATE, [{ start, end }], open);
    expect(mask).toBe((1n << 8n) | (1n << 9n));
  });

  it('clips an interval that overhangs the day', () => {
    const open = new Set(Array.from({ length: 36 }, (_, i) => i));
    const start = DateTime.fromISO(`${DATE}T16:30:00`, {
      zone: clinic.timezone,
    }).toJSDate();
    const end = DateTime.fromISO(`${DATE}T18:00:00`, {
      zone: clinic.timezone,
    }).toJSDate();
    const mask = buildBusyMask(clinic, DATE, [{ start, end }], open);
    // 16:30-17:00 = slots 34 and 35.
    expect(mask).toBe((1n << 34n) | (1n << 35n));
  });

  it('applies weekly hours and a closure exception', () => {
    const open = openSlotsForResource(
      clinic,
      DATE,
      [{ weekday: 1, startsAt: '08:00', endsAt: '17:00' }],
      [{ startsAt: '12:00', endsAt: '13:00', available: false }],
    );
    expect(open.has(0)).toBe(true); // 08:00
    expect(open.has(16)).toBe(false); // 12:00
    expect(open.has(19)).toBe(false); // 12:45
    expect(open.has(20)).toBe(true); // 13:00
    expect(open.size).toBe(32); // 36 - 4 closed slots
  });

  it('uses date-specific windows exclusively when present', () => {
    const open = openSlotsForResource(
      clinic,
      DATE,
      [{ weekday: 1, startsAt: '08:00', endsAt: '17:00' }],
      [
        { startsAt: '08:00', endsAt: '08:45', available: true },
        { startsAt: '09:00', endsAt: '09:15', available: true },
        { startsAt: '09:30', endsAt: '10:15', available: true },
        { startsAt: '12:00', endsAt: '13:15', available: true },
      ],
    );
    expect(open.has(0)).toBe(true); // 08:00
    expect(open.has(2)).toBe(true); // 08:30
    expect(open.has(3)).toBe(false); // 08:45 gap
    expect(open.has(4)).toBe(true); // 09:00
    expect(open.has(5)).toBe(false); // 09:15 gap start
    expect(open.has(6)).toBe(true); // 09:30
    expect(open.has(12)).toBe(false); // 11:00 closed
    expect(open.has(16)).toBe(true); // 12:00
    expect(open.size).toBe(12);
  });

  it('maps wall clock to the correct slot', () => {
    const eight = wallClockToInstant(clinic, DATE, '08:00');
    expect(instantToSlot(clinic, DATE, eight)).toBe(0);
    const noon = wallClockToInstant(clinic, DATE, '12:00');
    expect(instantToSlot(clinic, DATE, noon)).toBe(16);
  });

  it('maps clinic closing time to totalSlots for patient window end', () => {
    expect(wallClockToLatestEndSlot(clinic, DATE, '17:00')).toBe(36);
    expect(wallClockToLatestEndSlot(clinic, DATE, '16:00')).toBe(32);
  });

  it('masks slots outside a patient availability window', () => {
    // 12:00–17:00 = slots [16, 36).
    const mask = maskOutsidePatientWindow(36, 16, 36);
    expect((mask & (1n << 15n)) === 0n).toBe(false); // 11:45 blocked
    expect((mask & (1n << 16n)) === 0n).toBe(true); // 12:00 open
    expect((mask & (1n << 35n)) === 0n).toBe(true); // 16:45 open
  });

  it('handles a DST spring-forward day without inventing slots', () => {
    // America/New_York spring forward 2026-03-08: 02:00 → 03:00.
    const ny: ClinicDayGrid = {
      timezone: 'America/New_York',
      dayStart: '08:00',
      dayEnd: '17:00',
      slotMinutes: 15,
    };
    const { totalSlots, start, end } = clinicDayWindow(ny, '2026-03-08');
    expect(totalSlots).toBe(36);
    expect(end.diff(start, 'minutes').minutes).toBe(540);
    expect(
      instantToSlot(ny, '2026-03-08', slotToInstant(ny, '2026-03-08', 0)),
    ).toBe(0);
  });
});
