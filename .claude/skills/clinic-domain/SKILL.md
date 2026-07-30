---
name: clinic-domain
description: Vocabulary and domain rules for the radiology clinic scheduler. Use whenever writing or reviewing code that touches appointments, segments, resources, templates, gaps, or scheduling. Read this before naming anything.
---

# Clinic domain

## Vocabulary — use these exact terms

- **Appointment** — the whole visit. A header row. Never a single time block.
- **Segment** — one time block within an appointment. An appointment has several.
- **Step** — a segment's definition in a chain, before it is placed in time.
- **Resource** — a doctor, NMT room, or scan room. Capacity 1 per 15-minute slot.
- **Patient** — modelled as a capacity-1 resource. Same conflict rule as a room.
- **Mandatory delay** — a required wait between steps, e.g. radiotracer uptake.
  Clinical, not logistical. Expressed as min_gap_min / max_gap_min.
- **Incidental gap** — slack caused by a busy resource. This is what we minimise.
- **Chain** — the ordered list of steps making up one appointment. The primitive.
- **Template / preset** — a saved chain, copied when used. Never referenced by a
  booked appointment. Editing a preset does not change past appointments.
- **Candidate** — a proposed placement of the whole chain. The engine returns
  several; a human always chooses.
- **Slot** — one 15-minute unit. 36 per day, indexed 0–35 from 08:00.
- **NMT** — nuclear medicine technologist. Injects the tracer.
- **Modality** — the imaging capability a scan requires and a room provides.

## Rules that are easy to get wrong

- Never compress a mandatory delay to save time. It is a clinical requirement.
- Never say "gap" without qualifying which kind.
- A resource is never double-booked, and that is enforced by Postgres exclusion
  constraints, not application code.
- The engine proposes. It never books.
- Two intervals per step: the resource interval includes setup and teardown, the
  patient interval does not.
- During a mandatory delay the patient **is** occupied — waiting on site — even
  though no clinical resource is held.
- Appointments are composed, not chosen. Any chain the receptionist can build is
  valid if it passes the nine validation rules. Do not hardcode template shapes.
- Steps are snapshotted into appointment_step at booking. Never join a booked
  appointment back to template_step to work out what it consists of.
- Never put a patient identifier — name, MRN, phone, date of birth — in a log
  line, an error message, or an audit payload.

## Clinic configuration

- Operating hours 08:00–17:00, Monday to Friday.
- Slot granularity 15 minutes, so 36 slots per day.
- Capacity 1 per resource per slot.
- Seeded: 1 doctor, 1 NMT room, 1 scan room. The schema supports N of each, and
  property tests generate multi-instance clinics so resource selection stays
  covered.
- One clinic seeded, but `clinic_id` is on every tenant-scoped table from day one.
- One IANA timezone per clinic; all timestamps are `timestamptz`.

## The six seeded presets

They exist to cover the structural space, not to be a clinical catalog. P1 is a
single consult; P2 a single scan with no doctor; P3 three steps with tight gaps;
P4 the uptake study with a 60–90 minute mandatory delay, two adjacent scan
sessions on one scanner, and a doctor bookending the visit; P5 a two-phase study
with a 120–180 minute delay and a 3h45 minimum span; P6 a chain starting on a
non-doctor resource. Nothing about them is special-cased in code — they are
ordinary chains stored as rows with `is_preset = true`.
