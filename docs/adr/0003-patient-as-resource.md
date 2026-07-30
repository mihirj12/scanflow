# ADR 0003 — The patient is modelled as a capacity-1 resource

- **Status:** Accepted
- **Date:** 2026-07-29
- **Phase:** M0

## Context

A scan room can hold one patient at a time. A patient can be in one room at a
time. These are the same constraint, stated from opposite ends.

The obvious modelling instinct is to treat them differently — resources have
availability and a schedule, patients are the thing being scheduled — and then to
write two conflict checks: one for resources, one that asks separately "is this
patient already booked at this time?"

Two features of this domain make that instinct expensive.

**Mandatory delays.** After the NMT injects a radiotracer the patient waits a
fixed uptake period, `[60, 90]` minutes for the reference protocol, before
imaging. During that wait the patient is on site and unavailable, but no clinical
resource is held. If patients are not schedulable entities, this interval has
nowhere to live, and the scheduler will happily book the patient a consult in the
middle of their own uptake wait.

**Chains.** One appointment writes five or six segments. A separate
patient-availability check must be re-derived for every one of them, in the
booking path, the reschedule path, and the suggestion engine.

## Decision

The patient is a capacity-1 resource, and "patient double-booked" and "scanner
double-booked" are enforced by the same mechanism.

Concretely:

- Every `appointment_segment` row carries `patient_id` and a `during` range: the
  patient interval.
- A `SERVICE` segment additionally carries `resource_id` and `resource_during`:
  the resource interval, which is the patient interval widened by setup and
  teardown, and therefore must contain it.
- A `DELAY` segment carries `during` and no resource at all. The uptake wait is
  an ordinary row, with `resource_id IS NULL`.
- Both conflict rules are exclusion constraints on the same table with the same
  shape (see ADR 0001). Neither is application logic.
- In the engine, the patient is a `busyMask` exactly like a room's, and the
  patient interval runs unbroken from the first step's start to the last step's
  end, because delays occupy it.

The patient is not a member of the `resource_type` enum and does not get a
`resource` row. Patients are not inventory the clinic owns: they have no working
hours, no modalities, and no `display_order`. The unification is about the
_conflict rule_, not about the table.

## Consequences

**Positive.**

- One rule, one code path, one database constraint. A patient double-booking is
  as impossible as a scanner double-booking, and for the same reason.
- Mandatory delays are representable with no special case. A delay is a segment
  that occupies the patient and nothing else, which is precisely what it is
  clinically.
- The schedule grid gets a patient lane for free: it is just another lane whose
  segments come from the same query as the resource lanes.
- The engine's conflict check is uniform — `mask & range`, whether the mask
  belongs to a scanner or a patient.

**Negative.**

- Patient rows appear in resource-shaped queries and in the grid's lane model,
  which reads oddly until you know why. Hence this ADR.
- The `appointment_segment` table denormalises `patient_id` and `clinic_id` from
  `appointment`. Necessary: an exclusion constraint cannot reach through a join.
  The trade is a small write-time redundancy for a constraint that cannot be
  bypassed.
- Two interval columns per row rather than one, with a `CHECK` keeping them
  consistent. `setup_min` and `teardown_min` are zero everywhere today, so the two
  ranges are currently identical — but a delay is the mirror case (patient held,
  no room held), so the abstraction is already load-bearing.

## Alternatives considered

**A separate patient-availability check in the use case.** Rejected. It
duplicates logic that already exists for resources, must be remembered by every
write path, and drifts out of step with the resource rule the first time one of
them is fixed and the other is not. It also cannot be enforced by the database,
so it is a guarantee only as strong as the code that remembers to call it.

**A `resource` row per patient.** Would unify the two rules through the table
rather than just the constraint, and superficially looks tidier. Rejected because
patients and rooms genuinely differ: rooms have working hours, modalities, and a
display order; patients have an MRN, a date of birth, and privacy requirements
that the resource table has no business carrying. Merging them would mean
patient identifiers leaking into every resource listing — directly against the
rule that patient identifiers stay out of logs and general queries.

**Modelling the delay as a property of the following step rather than a row.**
Storing `min_gap_min` on the step and leaving the wait implicit. Rejected: the
patient's unavailability during the wait would then exist nowhere in the schedule,
so nothing would stop a second appointment being booked inside it, and the grid
would have nothing to draw.
