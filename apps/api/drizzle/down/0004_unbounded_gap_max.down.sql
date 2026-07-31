ALTER TABLE appointment_step DROP CONSTRAINT appointment_step_gap_bounds_check;
ALTER TABLE appointment_step ADD CONSTRAINT appointment_step_check CHECK (
  max_gap_min >= min_gap_min
);

ALTER TABLE template_step DROP CONSTRAINT template_step_gap_bounds_check;
ALTER TABLE template_step ADD CONSTRAINT template_step_check CHECK (
  max_gap_min >= min_gap_min
);
