---
name: ui-component
description: Conventions for React components in apps/web. Use when creating or modifying any component, hook, or form in the scheduler UI.
---

# UI components

## Structure

- Components render. Derived state and data fetching live in hooks.
- Server state uses TanStack Query. Local UI state uses useState. Zustand only
  when two distant components need the same flag.
- Forms use React Hook Form with the Zod schema imported from
  `packages/contracts`. Never redeclare a shape on the client.
- No business logic in a component. If there is a conditional about clinical
  rules, it belongs in a hook or a shared helper.

## This product

A dense operational tool used all day by one interrupted person. Optimise for
scan-speed, not whitespace. Flat surfaces, hairline borders, colour used only to
encode meaning. Avoid the default card-with-shadow-and-violet-accent look.

Segment colours mirror the clinic's existing spreadsheet so the receptionist
recognises them: doctor warm orange-red, NMT blue, scan deep green, patient lane
neutral grey. Confirmed bookings full saturation; held bookings at
`--held-opacity` with a dashed border. One accent colour for interaction,
deliberately outside the segment palette so a focus ring can never be misread as
a booking.

All of these are already declared as custom properties in
`src/styles/tokens.css`. Use the tokens; do not introduce a new hex value in a
component.

## Density is a constraint, not a preference

36 rows at `--slot-height` (28px) plus the grid header must fit on a 1080p screen
without vertical scrolling. That single requirement drives every other spacing
decision. If something does not fit, the answer is not a smaller row height — it
is less chrome around the grid.

Use CSS Grid for the schedule, not a calendar library. Lanes are generated from
`GET /resources`, never hardcoded, so a second scanner adds a column with no code
change.

## Non-negotiable

- Every interactive element is keyboard-operable with a visible focus ring.
- Loading states are skeletons, never a full-screen spinner.
- Empty states say what to do next, not just that nothing is here:
  "No appointments. Press N to book one."
- Errors explain what happened and how to fix it. No apologies, no vagueness.
- Sentence case. Labels name what the user controls, never internal concepts.
- An action keeps the same verb through the whole flow: a "Book" button produces
  a "Booked" confirmation.
- Tabular figures in the time gutter so digits align.
- Never render a patient identifier into a `title` attribute, a URL, or anything
  that ends up in a log.
