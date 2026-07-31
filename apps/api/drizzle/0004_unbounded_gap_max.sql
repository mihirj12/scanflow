-- Allow max_gap_min = 0 with min_gap_min > 0 to mean "minimum wait only, no
-- upper cap". Both zero still means no gap is required.
ALTER TABLE template_step DROP CONSTRAINT template_step_check;
--> statement-breakpoint
ALTER TABLE template_step ADD CONSTRAINT template_step_gap_bounds_check CHECK (
  max_gap_min >= min_gap_min OR (max_gap_min = 0 AND min_gap_min > 0)
);
--> statement-breakpoint
ALTER TABLE appointment_step DROP CONSTRAINT appointment_step_check;
--> statement-breakpoint
ALTER TABLE appointment_step ADD CONSTRAINT appointment_step_gap_bounds_check CHECK (
  max_gap_min >= min_gap_min OR (max_gap_min = 0 AND min_gap_min > 0)
);
